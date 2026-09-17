/**
 * PHASE 1 — pre-condition for /velpari-atomic-function (dedicated layer).
 *
 * Runs every check that must succeed BEFORE the parent LLM can spawn
 * scouts. Returns a discriminated-union result — the composer in
 * `index.ts` either proceeds (kind: "ok") or notifies the user and bails
 * (kind: "error"). No work is done in the error branch.
 *
 * Steps (mirror `stages/registry.ts:runStage` steps 1–4a):
 *   1. loadState() — refuse if no run id
 *   2. STAGE_GATE check — refuse if current stage is not designed (or
 *      analyzing-atomic-functions for redraft)
 *   3. loadFilesConfig() — refuse if no project name
 *   4. resolveStageInputs() — refuse if any required input is missing
 *   5. deriveAtomicProfile() — from files.json:atomic
 *   6. shouldRunReviewer() — tier + overlay + reviewerMode gate
 *
 * The function does NOT:
 *   - notify the user (the composer does that on kind: "error")
 *   - mutate state.json (advance is the `velpari_stage_publish` tool's
 *     job, which calls `the publish tool` internally)
 *   - spawn scouts (Phase 3's job)
 *   - build the prompt (Phase 2's job)
 *
 * Layer 1 — imports core/, same-layer stages/registry.
 */

import type { AtomicProfile } from "../../core/atomic-tier.js";
import { deriveAtomicProfile, shouldRunReviewer } from "../../core/atomic-tier.js";
import {
	STAGE_GATE,
	STAGE_REGISTRY,
	overlayRequiresReviewerFor,
	resolveStageInputs,
	type StageKey,
} from "../registry.js";
import type { RunState } from "../../core/state.js";
import { loadState } from "../../core/state.js";
import { loadFilesConfig } from "../../core/config.js";
import { hasPublishedFeasibility } from "../../core/paths.js";
import { nextCommandsFor, type Stage } from "../../core/constants.js";
import type { ResolveInputsResult } from "../registry.js";

/** Inputs to `runPreCondition`. `cwd` is the project root. */
export interface PreConditionDeps {
	cwd: string;
	stageKey: StageKey;
}

/** Successful pre-condition — every check passed; proceed to Phase 2/3. */
export interface PreConditionOk {
	kind: "ok";
	state: RunState;
	projectName: string;
	inputs: Extract<ResolveInputsResult, { ok: true }>;
	atomicProfile: AtomicProfile;
	reviewerRequired: boolean;
	/** Resolved overlay requiresReviewer (false when no overlay or unknown id). */
	overlayRequiresReviewer: boolean;
}

/** Failed pre-condition — the composer should notify and bail. */
export interface PreConditionError {
	kind: "error";
	message: string;
}

export type PreConditionResult = PreConditionOk | PreConditionError;

/**
 * Run every pre-condition for an atomic-function stage iteration.
 *
 * Today this function is atomic-function specific (only `stageKey: "atomic-function"`
 * exercises the atomic profile + reviewer gate path). It accepts a
 * `stageKey` for future generalization to other stages, but only
 * `atomic-function` produces a populated `atomicProfile` /
 * `reviewerRequired`.
 */
export function runPreCondition(deps: PreConditionDeps): PreConditionResult {
	const { cwd, stageKey } = deps;

	// 1. State load.
	const state = loadState(cwd);
	if (!state?.runId) {
		return {
			kind: "error",
			message: "No active run. Run /velpari-brainstorm first.",
		};
	}

	// 2. Hard stage gate (sequence hardening).
	const allowed = STAGE_GATE[stageKey] as readonly Stage[];
	let gated = !allowed.includes(state.currentStage);
	if (gated && stageKey === "architecture-generator" && state.currentStage === "built-rtm") {
		// Feasibility skip — see stages/registry.ts:runStage.
		const gateConfig = loadFilesConfig(cwd);
		if (gateConfig.projectName && hasPublishedFeasibility(cwd, gateConfig.projectName)) {
			gated = false;
		}
	}
	if (gated) {
		const gateConfig = loadFilesConfig(cwd);
		const skip = gateConfig.projectName
			? hasPublishedFeasibility(cwd, gateConfig.projectName)
			: false;
		const next = nextCommandsFor(state.currentStage, { feasibilitySkip: skip }).join(" or ");
		return {
			kind: "error",
			message: `Cannot run /velpari-${stageKey} at stage "${state.currentStage}". Run ${next} first.`,
		};
	}

	// 3. Project name must be configured.
	const config = loadFilesConfig(cwd);
	if (!config.projectName) {
		return {
			kind: "error",
			message: "Project name not set. Run /velpari-configure-inputs first.",
		};
	}
	const projectName = config.projectName;

	// 4. Resolve inputs (PRD, RTM, feasibility, design — brainstorm optional).
	const stageSpec = STAGE_REGISTRY[stageKey];
	const inputs = resolveStageInputs(stageSpec, {
		cwd,
		projectName,
		mission: state.mission,
	});
	if (!inputs.ok) {
		return { kind: "error", message: inputs.error };
	}

	// 5. Atomic profile — only populated for atomic-function.
	const atomicProfile: AtomicProfile =
		stageKey === "atomic-function"
			? deriveAtomicProfile(config)
			: { tier: "basic", safetyClass: "A", sil: "none", overlayId: null };

	// 6. Reviewer gate (tier + overlay + reviewerMode).
	let reviewerRequired = false;
	let overlayRequiresReviewer = false;
	if (stageKey === "atomic-function") {
		overlayRequiresReviewer = state.standardsProfile
			? overlayRequiresReviewerFor(cwd, state.standardsProfile.id)
			: false;
		reviewerRequired = shouldRunReviewer({
			profile: atomicProfile,
			overlayRequiresReviewer,
			reviewerMode: atomicProfile.reviewerMode,
		});
	}

	return {
		kind: "ok",
		state,
		projectName,
		inputs,
		atomicProfile,
		reviewerRequired,
		overlayRequiresReviewer,
	};
}