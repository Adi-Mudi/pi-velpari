/**
 * Execution-lane integrity check (Phase 7 / 7.7).
 *
 * Reads the newest PUBLISHED development-order rows from the store and
 * proves the lane map the doctor (and the embedded post-publish audit)
 * will hand to Senai:
 *  1. every `dev_step` sits in EXACTLY one `dev_lane` row (missing /
 *     duplicated are errors naming the step and the lanes);
 *  2. the lane graph itself is valid — `verifyLaneProposal` re-runs the
 *     same graph validation the publish gate used (acyclicity with the
 *     cycle path, per-lane topology, lane cap, worktree/branch
 *     name-match, recorded boundary levels);
 *  3. every cross-lane `step_dep` edge carries a `dev_lane_xdep` row —
 *     an integration point that the merge order depends on;
 *  4. `status` is inside the 4-state domain set (belt-and-braces — the
 *     DDL CHECK already enforces it).
 *
 * Legacy tolerance: a published artifact with zero `dev_lane` rows is
 * `not-checkable` (info), never an error — pre-Phase-7 artifacts carry no
 * lane data and must not be pressured into a republish.
 */

import { devLaneConfig } from "../../core/config.js";
import {
	DEFAULT_MAX_LANES,
	laneViewFromRows,
	type LaneDepInput,
	type LaneProposal,
	LANE_STATUSES,
	type LaneStepInput,
	type LaneXdep,
	verifyLaneProposal,
} from "../../core/dev-lanes.js";
import { readLatestPublishedRows } from "../../io/store.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";

/** Raw store shapes (`readRows` camelCases; everything else stays `unknown`). */
interface DevStepRow {
	id?: unknown;
	module?: unknown;
}
interface StepDepRow {
	stepId?: unknown;
	dependsOnId?: unknown;
}
interface DevLaneRow {
	laneId?: unknown;
	stepId?: unknown;
	position?: unknown;
	worktree?: unknown;
	branch?: unknown;
	status?: unknown;
}
interface DevLaneXdepRow {
	stepId?: unknown;
	dependsOnId?: unknown;
	boundaryLevel?: unknown;
}

/**
 * Lane-integrity section for the doctor report.
 * @param cwd - Project root (store + files.json lookup).
 * @param projectName - Project whose published development-order to audit.
 * @returns The section: one `ok` item when sound, error items per
 *   violation, `not-checkable` info for missing/legacy artifacts.
 */
export function checkDevLanesSection(cwd: string, projectName: string): DiagnosticSection {
	const title = "Execution lanes";
	const items: DiagnosticItem[] = [];

	const notCheckable = (reason: string): DiagnosticSection => {
		items.push({ status: "info", message: `lanes: not-checkable — ${reason}` });
		return { title, items };
	};

	if (!projectName) return notCheckable("no published development-order");

	const fromDb = readLatestPublishedRows(cwd, projectName, "development-order");
	if (!fromDb) return notCheckable("no published development-order");

	const laneRowsRaw = (fromDb.rows.devLane as DevLaneRow[] | undefined) ?? [];
	if (laneRowsRaw.length === 0) {
		return notCheckable("legacy artifact carries no lane data (pre-Phase-7 format)");
	}

	const storeDetails = [
		`Store: Doc/store/${projectName}/index.db (run ${fromDb.envelope.runId} v${fromDb.envelope.version})`,
	];

	// Lane cap: same config source as the publish gate (default 4 on a
	// missing/invalid value — the config section owns that error).
	let maxLanes = DEFAULT_MAX_LANES;
	try {
		maxLanes = devLaneConfig(cwd).maxLanes;
	} catch {
		items.push({
			status: "warning",
			message: `lanes: files.json velpari.maxLanes is invalid — checking against the default ${DEFAULT_MAX_LANES}.`,
		});
	}

	const steps: LaneStepInput[] = ((fromDb.rows.devStep as DevStepRow[] | undefined) ?? [])
		.filter((s): s is DevStepRow & { id: string } => typeof s.id === "string" && s.id !== "")
		.map((s) => ({ stepId: s.id, ...(typeof s.module === "string" ? { module: s.module } : {}) }));
	const deps: LaneDepInput[] = ((fromDb.rows.stepDep as StepDepRow[] | undefined) ?? [])
		.filter(
			(d): d is StepDepRow & { stepId: string; dependsOnId: string } =>
				typeof d.stepId === "string" && d.stepId !== "" && typeof d.dependsOnId === "string" && d.dependsOnId !== "",
		)
		.map((d) => ({ stepId: d.stepId, dependsOnStepId: d.dependsOnId }));

	// --- dev_lane rows: parse + malformed detection --------------------------
	const proposal: LaneProposal[] = [];
	let malformedLanes = 0;
	for (const raw of laneRowsRaw) {
		if (
			typeof raw.laneId === "string" &&
			typeof raw.stepId === "string" &&
			typeof raw.position === "number" &&
			typeof raw.worktree === "string" &&
			typeof raw.branch === "string"
		) {
			proposal.push({
				laneId: raw.laneId,
				stepId: raw.stepId,
				position: raw.position,
				worktree: raw.worktree,
				branch: raw.branch,
				...(typeof raw.status === "string" ? { status: raw.status as LaneProposal["status"] } : {}),
			});
		} else {
			malformedLanes++;
		}
	}
	if (malformedLanes > 0) {
		items.push({
			status: "error",
			message: `lanes: ${malformedLanes} malformed dev_lane row(s) — expected laneId/stepId/position/worktree/branch.`,
			details: storeDetails,
		});
	}

	// --- dev_lane_xdep rows --------------------------------------------------
	const xdeps: LaneXdep[] = [];
	let malformedXdeps = 0;
	for (const raw of (fromDb.rows.devLaneXdep as DevLaneXdepRow[] | undefined) ?? []) {
		if (
			typeof raw.stepId === "string" &&
			typeof raw.dependsOnId === "string" &&
			typeof raw.boundaryLevel === "number"
		) {
			xdeps.push({ stepId: raw.stepId, dependsOnStepId: raw.dependsOnId, boundaryLevel: raw.boundaryLevel });
		} else {
			malformedXdeps++;
		}
	}
	if (malformedXdeps > 0) {
		items.push({
			status: "error",
			message: `lanes: ${malformedXdeps} malformed dev_lane_xdep row(s) — expected stepId/dependsOnId/boundaryLevel.`,
			details: storeDetails,
		});
	}

	// --- lane count ≥ 1 ------------------------------------------------------
	const laneIds = [...new Set(proposal.map((r) => r.laneId))].sort();
	if (laneIds.length === 0) {
		items.push({
			status: "error",
			message: `lanes: no lanes recorded for ${steps.length} step(s) — every dev_lane row is malformed.`,
			details: storeDetails,
		});
	}

	// --- coverage: every step in EXACTLY ONE lane (codes from the plan) ------
	const lanesOfStep = new Map<string, string[]>();
	for (const row of proposal) {
		const list = lanesOfStep.get(row.stepId) ?? [];
		list.push(row.laneId);
		lanesOfStep.set(row.stepId, list);
	}
	let coverageClean = true;
	for (const step of steps) {
		const lanes = [...new Set(lanesOfStep.get(step.stepId) ?? [])].sort();
		if (lanes.length === 0) {
			coverageClean = false;
			items.push({
				status: "error",
				message: `step-missing-from-lane: step "${step.stepId}" is in no lane`,
				details: storeDetails,
			});
		} else if (lanes.length > 1) {
			coverageClean = false;
			items.push({
				status: "error",
				message: `step-in-two-lanes: step "${step.stepId}" is assigned to ${lanes.length} lanes: ${lanes.join(", ")}`,
				details: storeDetails,
			});
		}
	}

	// --- status domain set (belt-and-braces over the DDL CHECK) --------------
	for (const row of proposal) {
		if (row.status !== undefined && !LANE_STATUSES.includes(row.status)) {
			items.push({
				status: "error",
				message: `lanes: dev_lane row (${row.laneId}/${row.stepId}) has invalid status "${row.status}" — expected ${LANE_STATUSES.join("|")}.`,
				details: storeDetails,
			});
		}
	}

	// --- graph validation (the same verify the publish gate ran) -------------
	// Coverage problems are reported above with lane names, so verify's two
	// coverage codes are filtered to keep one finding per violation.
	const problems = verifyLaneProposal(proposal, steps, deps, { maxLanes, projectSlug: projectName, xdeps });
	for (const problem of problems) {
		if (problem.code === "step-missing-from-lane" || problem.code === "step-in-two-lanes") continue;
		const detail = problem.detail?.length ? ` [${problem.detail.join(", ")}]` : "";
		items.push({
			status: "error",
			message: `${problem.code}: ${problem.message}${detail}`,
			details: storeDetails,
		});
	}

	// --- every cross-lane step_dep edge must have an integration point -------
	if (coverageClean) {
		const laneOf = new Map(proposal.map((row) => [row.stepId, row.laneId]));
		const recorded = new Set(xdeps.map((x) => `${x.stepId}<- ${x.dependsOnStepId}`));
		for (const dep of deps) {
			const here = laneOf.get(dep.stepId);
			const there = laneOf.get(dep.dependsOnStepId);
			if (here === undefined || there === undefined || here === there) continue;
			if (recorded.has(`${dep.stepId}<- ${dep.dependsOnStepId}`)) continue;
			items.push({
				status: "error",
				message: `cross-lane dependency ${dep.stepId} → ${dep.dependsOnStepId} has no recorded integration point`,
				details: storeDetails,
			});
		}
	}

	// --- sound ⇒ one ok item with the derived shape --------------------------
	if (!items.some((i) => i.status === "error")) {
		const view = laneViewFromRows(proposal, steps, deps);
		const shape = view ? view.shape.join("→") : "unknown";
		items.push({
			status: "ok",
			message: `${laneIds.length} lane(s), ${steps.length} step(s), shape ${shape}`,
			details: storeDetails,
		});
	}
	return { title, items };
}
