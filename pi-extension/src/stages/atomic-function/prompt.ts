/**
 * PHASE 2 — prompt assembly for /velpari-atomic-function (dedicated layer).
 *
 * Thin wrapper around `core/prompt.ts:buildStagePrompt` with an
 * atomic-function-specific input shape. The wrapper:
 *
 *   1. pre-fills `answers: []` (atomic-function has no interview answers)
 *   2. pre-fills `webSearchAllowed: false` (community scan is brainstorm-only)
 *   3. forwards `atomicProfile` so `buildStagePrompt` renders the
 *      `## Atomic Profile` block (tier label + field set)
 *   4. forwards `updateMode` so `buildStagePrompt` renders the
 *      `## Update Mode` block (5 revision rules + fenced baseline)
 *   5. forwards `profileMetadata` for the `## Profile (compact)` block
 *   6. forwards `paths.{scouts,inputArtifact,inputArtifactContent,
 *      workingCopy,scoutsDir}` for the artifact-paths block
 *
 * The wrapper also exposes `renderTierFields` for callers (Phase 4
 * scout prompts, parent-LLM merge, tests) that need the full field list
 * for a tier — `buildStagePrompt`'s `## Atomic Profile` block only
 * summarises ("Base-core only (8 fields)").
 *
 * Layer 1 — imports core/ only.
 */

import {
	buildStagePrompt,
	type BuildStagePromptInput,
	type ScoutSlot,
} from "../../core/prompt.js";
import {
	requiredFieldsFor,
	type AtomicProfile,
} from "../../core/atomic-tier.js";
import type { Stage } from "../../core/constants.js";
import type { CompactProfileMetadata } from "../../core/profile.js";

/** Inputs to `buildAtomicFunctionPrompt`. Strict subset of
 *  `BuildStagePromptInput` limited to what atomic-function needs. */
interface AtomicPromptInput {
	stage: "analyzing-atomic-functions" | "analyzed-atomic-functions";
	mission: string;
	framework: string | undefined;
	runId: string | undefined;
	atomicProfile: AtomicProfile;
	scouts: readonly ScoutSlot[];
	inputArtifact: string;
	inputArtifactContent?: string;
	workingCopy: string;
	scoutsDir: string;
	updateMode?: { baselinePath: string; baselineContent: string } | null;
	profileMetadata?: CompactProfileMetadata | null;
}

/**
 * Build the full prompt the parent LLM receives for atomic-function.
 *
 * Behaviour is identical to calling `buildStagePrompt` directly with
 * the same arguments + `answers: []` and `webSearchAllowed: false`.
 */
export function buildAtomicFunctionPrompt(input: AtomicPromptInput): string {
	return buildStagePrompt(toBuildStagePromptInput(input));
}

/** Convert the atomic-function-specific input into the generic shape
 *  `buildStagePrompt` expects. Exported for tests. */
export function toBuildStagePromptInput(
	input: AtomicPromptInput,
): BuildStagePromptInput {
	return {
		stage: input.stage as Stage,
		mission: input.mission,
		framework: input.framework,
		runId: input.runId,
		answers: [],
		webSearchAllowed: false,
		paths: {
			scouts: [...input.scouts],
			inputArtifact: input.inputArtifact,
			inputArtifactContent: input.inputArtifactContent,
			workingCopy: input.workingCopy,
			scoutsDir: input.scoutsDir,
		},
		atomicProfile: input.atomicProfile,
		updateMode: input.updateMode ?? null,
		profileMetadata: input.profileMetadata ?? null,
	};
}

/**
 * Render the full list of required field names for a tier as a
 * comma-separated string. Useful for parent-LLM merge logic and test
 * fixtures.
 *
 * Cumulative: `entry ⊂ basic ⊂ intermediate ⊂ advanced`. The list
 * always starts with the 8 base-core fields.
 */
export function renderTierFields(tier: AtomicProfile["tier"]): string {
	return requiredFieldsFor(tier).join(", ");
}