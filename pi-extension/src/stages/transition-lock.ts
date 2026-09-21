/**
 * Transition lock (A1) — ONE legal-command function for the whole pipeline.
 *
 * Before this module, legality was decided independently by STAGE_GATE
 * (registry.runStage), nextCommandsFor (status surfaces), the publish-tool
 * whitelist, and the approve refusal — five places that could disagree.
 * Now every surface delegates to computeLegalCommands:
 *
 *   (a) Brainstorm open (currentStage === "brainstorming") — the pipeline
 *       collapses to the session actions: /velpari-approve-brainstorm is
 *       the only legal stage command; the two doors (continue the paused
 *       stage / restart at the PRD) are chosen AT approve time. Every
 *       other stage command is blocked with a guide message naming the
 *       doors. (spec 04 brainstorm-open state; D3)
 *   (b) Stale set non-empty — a stage command whose declared inputs are
 *       stale is blocked, and earliestStale() names the earliest stale
 *       stage's republish command (self-healing routing, spec 04). A stage
 *       whose OWN published artifact is stale may always re-run (the
 *       update-mode self-loop) — that run is the remedy.
 *   (c) Otherwise the forward table (nextCommandsFor) plus the STAGE_GATE
 *       redraft self-loops, exactly as before.
 *
 * Deterministic: the legal set is a pure function of (state, stale set,
 * specs). No LLM judgment. Specs are passed in by callers that hold the
 * stage registry, keeping this module free of a registry import cycle.
 *
 * Layer 1 (stages/): imports L0 only.
 */

import { nextCommandsFor, PATHS, type Stage } from "../core/constants.js";
import { loadFilesConfig } from "../core/config.js";
import {
	computeStaleSet,
	manifestKey,
	resolveDeclaredInputs,
	type DeclaredInput,
	type StaleItem,
} from "../core/freshness.js";
import { hasPublishedFeasibility, slugify } from "../core/paths.js";
import { loadState, type RunState } from "../core/state.js";

const BRAINSTORM_COMMAND = "/velpari-brainstorm";
const APPROVE_BRAINSTORM_COMMAND = "/velpari-approve-brainstorm";

/**
 * Static per-stage metadata the lock reasons over. Mirrors one
 * STAGE_REGISTRY row + one STAGE_GATE row; the registry builds these
 * (see STAGE_LOCK_SPECS) so stage data has exactly one home.
 */
export interface StageLockSpec {
	/** Registry key ("prd", "rtm", ...). */
	key: string;
	/** Slash command that starts/redrafts the stage ("/velpari-prd"). */
	command: string;
	/** STAGE_GATE row: stages from which the command may start. The LAST
	 *  entry is the stage's own in-progress value (redraft self-loop). */
	gate: readonly Stage[];
	/** Published artifact key ("PRD", "feasibility-study", ...). */
	workingCopyArtifact: string;
	/** Declared inputs (structural mirror of the registry's StageInputDoc). */
	inputs: readonly DeclaredInput[];
}

interface EarliestStale {
	/** Registry key of the earliest stale stage, or "brainstorm". */
	stage: string;
	/** Command whose run republishes it ("/velpari-prd" / "/velpari-brainstorm"). */
	command: string;
	/** The offending manifest item (reason + changed inputs). */
	item: StaleItem;
}

export interface LegalCommands {
	/** Stage/approve slash commands legal right now. Discipline, view, and
	 *  configure commands are ungoverned and never listed here. */
	allowed: string[];
	/** null when `cmd` is legal or ungoverned; otherwise the block reason,
	 *  always naming the correct command (self-healing routing). */
	reasonFor(cmd: string): string | null;
	/** The earliest stale stage's republish target, or null when fresh. */
	earliestStale(): EarliestStale | null;
	/** True while a brainstorm session is open. */
	brainstormOpen: boolean;
	/** The stage paused by the open brainstorm session, when any. */
	pausedStage?: Stage;
	/** Routing hint for status surfaces: ["/velpari-approve-brainstorm"]
	 *  while a brainstorm is open, the earliest-stale remedy when stale,
	 *  else the forward table. */
	nextCommands: string[];
}

/** Inputs for the pure core (tests + callers that already hold state). */
interface LegalCommandsFromInput {
	state: RunState;
	specs: readonly StageLockSpec[];
	/** Precomputed stale set; defaults to []. no-stamp items are ignored. */
	staleSet?: StaleItem[];
	/** Project root — required for stale declared-input resolution. */
	cwd?: string;
	projectName?: string;
	feasibilitySkip?: boolean;
}

/**
 * Load everything and compute the legal-command set for a project root.
 * `specs` must be in pipeline execution order (the registry's STAGE_KEYS
 * order is NOT execution order — build via STAGE_LOCK_SPECS).
 */
export function computeLegalCommands(
	cwd: string,
	specs: readonly StageLockSpec[],
): LegalCommands {
	const state = loadState(cwd);
	const config = loadFilesConfig(cwd);
	const projectName = config.projectName ?? "";
	const feasibilitySkip =
		projectName !== "" && hasPublishedFeasibility(cwd, projectName);
	const staleSet = state.runId ? computeStaleSet(cwd) : [];
	return computeLegalCommandsFrom({
		state,
		specs,
		staleSet,
		cwd,
		projectName,
		feasibilitySkip,
	});
}

/** Pure core — no I/O beyond what the caller already performed. */
export function computeLegalCommandsFrom(
	input: LegalCommandsFromInput,
): LegalCommands {
	const { state, specs } = input;
	const staleSet = input.staleSet ?? [];
	const cwd = input.cwd;
	const projectName = input.projectName ?? "";
	const feasibilitySkip = input.feasibilitySkip === true;
	const topicSlug = slugify(state.mission || "");
	const brainstormOpen = state.currentStage === "brainstorming";
	const pausedStage = state.pausedStage;

	// ── Stale set → owning stages, in pipeline order ────────────────────
	const actionable = staleSet.filter((s) => s.reason !== "no-stamp");
	const staleByKey = new Map(actionable.map((s) => [s.key, s]));
	const staleStages: EarliestStale[] = [];
	for (const item of actionable) {
		if (item.artifact === "brainstorm") {
			staleStages.push({ stage: "brainstorm", command: BRAINSTORM_COMMAND, item });
			continue;
		}
		const spec = specs.find(
			(s) => s.workingCopyArtifact.toLowerCase() === item.artifact,
		);
		if (spec) staleStages.push({ stage: spec.key, command: spec.command, item });
	}
	const orderOf = (e: EarliestStale): number =>
		e.stage === "brainstorm" ? -1 : specs.findIndex((s) => s.key === e.stage);
	staleStages.sort((a, b) => orderOf(a) - orderOf(b));
	const earliest = staleStages[0] ?? null;

	// ── Gate helpers ─────────────────────────────────────────────────────

	/** Base gate + the conditional built-rtm → designing feasibility skip. */
	const gateAllows = (spec: StageLockSpec): boolean => {
		if ((spec.gate as readonly Stage[]).includes(state.currentStage)) return true;
		return (
			spec.key === "architecture-generator" &&
			state.currentStage === "built-rtm" &&
			feasibilitySkip
		);
	};

	/** Update-mode self-loop: a stage whose own published artifact is stale
	 *  may always re-run — that run IS the republish remedy. */
	const ownOutputStale = (spec: StageLockSpec): boolean =>
		projectName !== "" &&
		staleByKey.has(manifestKey(spec.workingCopyArtifact, projectName));

	/** The stage's in-progress value (its redraft self-loop stage). */
	const inProgressStageOf = (spec: StageLockSpec): Stage =>
		spec.gate[spec.gate.length - 1]!;

	/** Declared inputs of `spec` that are stale (hard-block inputs only). */
	const staleInputsFor = (spec: StageLockSpec): StaleItem[] => {
		if (staleByKey.size === 0 || !cwd || projectName === "") return [];
		const declared = resolveDeclaredInputs(cwd, spec.inputs, {
			projectName,
			topicSlug,
		});
		const out: StaleItem[] = [];
		for (const d of declared) {
			const item = staleByKey.get(d.id);
			if (item) out.push(item);
		}
		return out;
	};

	const remedyFor = (item: StaleItem): string => {
		// A5/D4: input-changed items may also be re-confirmed (reviewed — no
		// impact); input-missing / no-stamp stay republish-only.
		const republish = (() => {
			if (item.artifact === "brainstorm") {
				return `${BRAINSTORM_COMMAND}, then ${APPROVE_BRAINSTORM_COMMAND}`;
			}
			const spec = specs.find(
				(s) => s.workingCopyArtifact.toLowerCase() === item.artifact,
			);
			return spec
				? `${spec.command}, then ${spec.command}-approve`
				: `republish ${item.key}`;
		})();
		return item.reason === "input-changed"
			? `${republish}, or /velpari-reconfirm if the change has no impact on this artifact`
			: republish;
	};

	/** The single correct next step named in every block message. */
	const routingText = (): string => {
		if (earliest) return earliest.command;
		if (!state.runId || state.currentStage === "none") return BRAINSTORM_COMMAND;
		return nextCommandsFor(state.currentStage, { feasibilitySkip }).join(" or ");
	};

	/** Guide message while a brainstorm session is open (the two doors). */
	const brainstormOpenGuide = (cmd: string): string =>
		`Cannot run ${cmd}: brainstorm session open — the pipeline is paused` +
		`${pausedStage ? ` at "${pausedStage}"` : ""}. ` +
		`Run ${APPROVE_BRAINSTORM_COMMAND} to publish and continue` +
		`${pausedStage ? ` "${pausedStage}"` : ""} or restart at /velpari-prd ` +
		`(or close it without an artifact via velpari_brainstorm_session({ action: "discard" })).`;

	// ── reasonFor ────────────────────────────────────────────────────────

	const reasonFor = (cmd: string): string | null => {
		if (cmd === BRAINSTORM_COMMAND) {
			return brainstormOpen
				? "A brainstorm is already open — approve or discard it before starting a new one."
				: null;
		}
		if (cmd === APPROVE_BRAINSTORM_COMMAND) {
			return brainstormOpen ? null : "No open brainstorm session to approve.";
		}

		const stageSpec = specs.find((s) => s.command === cmd);
		const approveSpec = specs.find((s) => `${s.command}-approve` === cmd);

		if (brainstormOpen && (stageSpec || approveSpec)) {
			return brainstormOpenGuide(cmd);
		}

		if (approveSpec) {
			if (state.currentStage === inProgressStageOf(approveSpec)) return null;
			return (
				`Cannot run ${cmd} at stage "${state.currentStage}". ` +
				`Run ${routingText()} first.`
			);
		}

		if (stageSpec) {
			if (!gateAllows(stageSpec) && !ownOutputStale(stageSpec)) {
				return (
					`Cannot run ${cmd} at stage "${state.currentStage}". ` +
					`Run ${routingText()} first.`
				);
			}
			const staleInputs = staleInputsFor(stageSpec);
			if (staleInputs.length > 0) {
				const lines = staleInputs.map(
					(item) =>
						`  - ${item.key} is stale (${item.reason}: ${item.changedInputs.join(", ")}) — ` +
						(item.reason === "input-changed"
							? remedyFor(item) + "."
							: `republish via ${remedyFor(item)}.`),
				);
				return (
					`Cannot run ${cmd}: declared inputs are stale per ${PATHS.FRESHNESS_FILE}.\n` +
					lines.join("\n") +
					`\nRepublish the stale stage(s) — or /velpari-reconfirm the input-changed ones — then re-run ${cmd}.`
				);
			}
			return null;
		}

		// Ungoverned (discipline / view / configure / ops commands).
		return null;
	};

	// ── allowed + nextCommands ───────────────────────────────────────────

	const allowed: string[] = [];
	if (!state.runId || state.currentStage === "none") {
		allowed.push(BRAINSTORM_COMMAND);
	} else if (brainstormOpen) {
		allowed.push(APPROVE_BRAINSTORM_COMMAND);
	} else {
		allowed.push(BRAINSTORM_COMMAND); // brainstorm-anytime: opens a paused session
		for (const spec of specs) {
			if (
				(gateAllows(spec) || ownOutputStale(spec)) &&
				staleInputsFor(spec).length === 0
			) {
				allowed.push(spec.command);
			}
		}
		const inProgress = specs.find(
			(s) => inProgressStageOf(s) === state.currentStage,
		);
		if (inProgress) allowed.push(`${inProgress.command}-approve`);
	}

	const nextCommands: string[] = brainstormOpen
		? [APPROVE_BRAINSTORM_COMMAND]
		: earliest
			? [earliest.command]
			: !state.runId || state.currentStage === "none"
				? [BRAINSTORM_COMMAND]
				: nextCommandsFor(state.currentStage, { feasibilitySkip });

	return {
		allowed,
		reasonFor,
		earliestStale: () => earliest,
		brainstormOpen,
		pausedStage,
		nextCommands,
	};
}
