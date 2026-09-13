/**
 * MVP coverage (MVP/phase traceability upgrade, Phase 4).
 *
 * Answers "is the MVP done?": every Phase-1 requirement in the published
 * PRD must exist in the published RTM JSON with real coverage. Shared by
 * the doctor section (checks/mvp-coverage.ts) and /velpari-handoff —
 * one computation, two consumers.
 *
 * Severity model:
 *  - no-row:     Phase-1 id has no RTM row at all          → error
 *  - uncovered:  row exists but coverage is "missing"      → error
 *  - partial:    coverage is "partial"                     → warning
 *  - no-tests:   row links no test cases                   → warning
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveDocArtifact } from "./paths.js";
import { extractRequirementPhases } from "./psrs.js";
import type { RtmData } from "./rtm-data.js";

export type MvpCoverageProblem = "no-row" | "uncovered" | "partial" | "no-tests";

export interface MvpCoverageIssue {
	id: string;
	problem: MvpCoverageProblem;
	/** "error" blocks handoff; "warning" is shown but does not block. */
	severity: "error" | "warning";
	message: string;
}

export interface MvpCoverageReport {
	/** Total Phase-1 (MVP) requirement ids in the PRD. */
	total: number;
	/** Phase-1 ids with an RTM row at coverage "covered" and ≥1 test. */
	covered: number;
	issues: MvpCoverageIssue[];
}

/**
 * Compute MVP coverage between the published PRD and the published RTM
 * JSON sidecar. Returns null when the inputs are missing/unreadable —
 * callers treat null as "nothing to check".
 */
export function checkMvpCoverage(cwd: string, projectName: string): MvpCoverageReport | null {
	if (!projectName) return null;
	const psrs = resolveDocArtifact("PRD", projectName, cwd);
	const rtm = resolveDocArtifact("RTM", projectName, cwd);
	if (!psrs || !rtm) return null;
	const jsonPath = rtm.path.replace(/\.md$/, ".json");
	if (!existsSync(jsonPath)) return null;

	let data: RtmData;
	let phases: Map<string, number>;
	try {
		data = JSON.parse(readFileSync(jsonPath, "utf8")) as RtmData;
		if (!Array.isArray(data.rows)) return null;
		phases = extractRequirementPhases(readFileSync(psrs.path, "utf8"));
	} catch {
		return null;
	}

	const mvpIds = [...phases.entries()].filter(([, p]) => p === 1).map(([id]) => id);
	if (mvpIds.length === 0) return null;

	const byId = new Map(data.rows.map((r) => [r.id, r]));
	const issues: MvpCoverageIssue[] = [];
	let covered = 0;
	for (const id of mvpIds) {
		const row = byId.get(id);
		if (!row) {
			issues.push({
				id,
				problem: "no-row",
				severity: "error",
				message: `${id}: Phase-1 (MVP) requirement has no RTM row.`,
			});
			continue;
		}
		if (row.coverage === "missing") {
			issues.push({
				id,
				problem: "uncovered",
				severity: "error",
				message: `${id}: MVP requirement coverage is "missing".`,
			});
			continue;
		}
		if (row.coverage === "partial") {
			issues.push({
				id,
				problem: "partial",
				severity: "warning",
				message: `${id}: MVP requirement coverage is "partial".`,
			});
		}
		if (row.tests.length === 0) {
			issues.push({
				id,
				problem: "no-tests",
				severity: "warning",
				message: `${id}: MVP requirement links no test cases.`,
			});
		}
		if (row.coverage === "covered" && row.tests.length > 0) covered++;
	}
	return { total: mvpIds.length, covered, issues };
}
