/**
 * PHASE 3 — scout dispatch for /velpari-atomic-function (dedicated layer).
 *
 * Owns every artifact-path computation, agent-bootstrap call, scout-slot
 * build, and reviewer-tier-gate filter for atomic-function.
 *
 * Steps (mirror `stages/registry.ts:runStage` steps 3, 4b, 4c, 4d):
 *   1. buildRunDir + buildWorkingGroupedPath — compute runDir, working
 *      copy dir, scouts dir, working-copy target
 *   2. ensureStageAgents — bootstrap the 4 source scouts (+ reviewer
 *      when gated on) into `.pi/agents/`
 *   3. buildScoutSlots — construct ScoutSlot[] from spec.scouts
 *   4. filterReviewerSlot — apply tier + overlay gate (keep or remove
 *      the reviewer slot)
 *   5. notify user — installed / missing agents + final scout list
 *
 * Returns both the configured ScoutSlot[] and the paths so the
 * composer (Phase 8) can hand the same paths to Phase 2's prompt
 * builder without recomputing.
 *
 * Layer 1 — imports core/, io/, same-layer stages/registry.
 */

import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ScoutSlot } from "../../core/prompt.js";
import {
	buildRunDir,
	buildWorkingGroupedPath,
} from "../../core/paths.js";
import { STAGE_REGISTRY, buildScoutSlots, filterReviewerSlot } from "../registry.js";
import { ensureStageAgents } from "../../io/agents-install.js";
import { loadAgentConfig } from "../../core/agents-config.js";
import type { PreConditionOk } from "./pre-condition.js";

/** Result of `dispatchScouts`. The composer hands `paths` to Phase 2's
 *  prompt builder and `slots` to the parent LLM via the metadata block. */
export interface DispatchResult {
	scouts: readonly ScoutSlot[];
	paths: {
		runDir: string;
		workingCopyDir: string;
		scoutsDir: string;
		workingCopyPath: string;
	};
	/** Outcome of ensureStageAgents — exposed for tests + the run log. */
	bootstrap: {
		installed: string[];
		alreadyPresent: string[];
		missing: string[];
	};
}

/** Inputs to `dispatchScouts`. */
export interface DispatchDeps {
	ctx: ExtensionCommandContext;
	cwd: string;
	pre: PreConditionOk;
}

/**
 * Dispatch scouts for an atomic-function stage iteration.
 *
 * Today's stage is hard-coded to `atomic-function`. The Phase 8 composer
 * calls this function once after `runPreCondition` returns ok.
 */
export function dispatchScouts(deps: DispatchDeps): DispatchResult {
	const { ctx, cwd, pre } = deps;
	const stageKey = "atomic-function" as const;
	const spec = STAGE_REGISTRY[stageKey];

	// 1. Path computation.
	const runDir = buildRunDir(pre.state.runId, cwd);
	const workingCopyDir = join(runDir, spec.workingCopyCategory);
	const scoutsDir = join(workingCopyDir, "scouts");
	const workingCopyPath = buildWorkingGroupedPath(
		cwd,
		pre.state.runId,
		spec.workingCopyArtifact,
		pre.projectName,
	);

	// 2. Agent bootstrap (4 source scouts + reviewer when gated on).
	const agentConfig = loadAgentConfig(cwd);
	const allSlotCount = spec.scouts.length; // 5 (4 source + reviewer)
	// Resolve every scout name (incl. reviewer when gated on) so the
	// bootstrap call installs the full set; the gate filter runs after.
	const allScoutIds = [...spec.scouts];
	const bootstrap = ensureStageAgents(allScoutIds, cwd, agentConfig);

	if (bootstrap.installed.length > 0) {
		ctx.ui.notify(
			`Installed ${bootstrap.installed.length} agent(s): ${bootstrap.installed.join(", ")}.`,
			"info",
		);
	}
	if (bootstrap.missing.length > 0) {
		ctx.ui.notify(
			`⚠ Bundled agent file(s) missing for: ${bootstrap.missing.join(", ")}. ` +
				`/velpari-${stageKey} will fail until you add them.`,
			"error",
		);
	}
	void allSlotCount;

	// 3. Scout slot build.
	const allSlots = buildScoutSlots(spec, scoutsDir, cwd);

	// 4. Reviewer gate.
	const filtered = filterReviewerSlot(
		allSlots,
		stageKey,
		pre.atomicProfile,
		pre.overlayRequiresReviewer,
	);

	// 5. Notify the final scout list + paths.
	const scoutList = filtered.map((s) => s.name).join(", ");
	ctx.ui.notify(
		`Stage "atomic-function" started for: ${pre.state.mission}\n` +
			`Scouts: ${scoutList}\n` +
			`Scout reports: ${scoutsDir}\n` +
			`Working copy target: ${workingCopyPath}\n` +
			`The parent LLM is now orchestrating the ${filtered.length} subagents ` +
			`(visible panes). When the working copy is ready, the parent LLM calls the ` +
			`\`velpari_stage_publish\` tool to publish and advance the stage. ` +
			`\`the publish tool\` remains as the manual fallback.`,
		"info",
	);

	return {
		scouts: filtered,
		paths: {
			runDir,
			workingCopyDir,
			scoutsDir,
			workingCopyPath,
		},
		bootstrap,
	};
}