/**
 * /velpari-atomic-function handler — DEDICATED LAYER COMPOSER (Gap A).
 *
 * Runtime composition. The composer calls the 7 phase helpers from
 * the dedicated layer directly. The previous implementation
 * delegated to `runStage("atomic-function")` in `stages/registry.ts`,
 * which duplicated the same logic inline — the layer was library-only
 * and never reached runtime.
 *
 * Today (after Gap A):
 *
 *   /velpari-atomic-function
 *     │
 *     ▼
 *   handleAtomicFunction (this file)
 *     │
 *     ├── runPreCondition (Phase 1 — gate + profile + reviewer gate)
 *     ├── load files.json + profile + update-mode (registry bits)
 *     ├── dispatchScouts (Phase 3 — paths + scouts + filter)
 *     ├── buildAtomicFunctionPrompt (Phase 2 — prompt assembly)
 *     ├── pi.sendUserMessage(prompt) (hand off to parent LLM)
 *     └── notify user with stage summary
 *     │
 *     ▼
 *   parent LLM (skills/velpari-atomic-function.md)
 *     ├── spawn 4 source scouts + reviewer (gated)
 *     ├── merge into working copy (Phases 4-6 use layer helpers)
 *     ├── AskUserQuestion preview gate
 *     └── on yes → call velpari_stage_publish tool
 *
 * Layer 1 — imports same-layer stages/registry + core/.
 */

import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runPreCondition } from "./pre-condition.js";
import { dispatchScouts } from "./scout-dispatch.js";
import { buildAtomicFunctionPrompt } from "./prompt.js";
import { loadFilesConfig } from "../../core/config.js";
import { compactProfileMetadata, loadRequirementsProfile } from "../../core/profile.js";
import { resolveDocArtifact } from "../../core/paths.js";
// biome-ignore lint/correctness/noUnusedImports: advanceStage is used below (biome false positive)
import { advanceStage, loadState } from "../../core/state.js";

/**
 * Stage 6 handler — required post-design.
 *
 * Reads the published artifacts (brainstorm + PRD + RTM + feasibility +
 * design) and orchestrates 5 parallel subagents (4 source scouts +
 * reviewer when gated on) to propose atomic function splits + an
 * adversarial critique. The reviewer verdict becomes the publish gate's
 * single source of truth for tier checks.
 */
export async function handleAtomicFunction(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	// PHASE 1 — pre-condition (gate + atomic profile + reviewer gate)
	const pre = runPreCondition({ cwd, stageKey: "atomic-function" });
	if (pre.kind === "error") {
		ctx.ui.notify(pre.message, "error");
		return;
	}

	// Advance state: `designed → analyzing-atomic-functions`. The
	// runPreCondition gate allows this (and the redraft case from
	// analyzing-atomic-functions). STAGE_TRANSITIONS records the
	// mapping. handleApprove (the publish tool) expects state to be
	// `analyzing-atomic-functions` to route to the atomic-functions
	// mapping.
	if (pre.state.currentStage === "designed") {
		const advanced = advanceStage(pre.state, "/velpari-atomic-function", cwd, pi);
		pre.state = advanced;
	}

	// Files config + requirements profile (compact metadata only)
	const config = loadFilesConfig(cwd);
	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

	// Update-mode detection (living documents): when a published
	// atomic-functions artifact already exists, this run REVISES it.
	let updateMode: { baselinePath: string; baselineContent: string } | null = null;
	const baseline = resolveDocArtifact("atomic-functions", pre.projectName, cwd);
	if (baseline) {
		updateMode = {
			baselinePath: baseline.path,
			baselineContent: readFileSync(baseline.path, "utf8"),
		};
		ctx.ui.notify(
			`Update mode: published atomic-functions found at ${baseline.path}. This run revises it.`,
			"info",
		);
	}

	// PHASE 3 — scout dispatch (paths + bootstrap + slot build + reviewer filter)
	const dispatch = dispatchScouts({ ctx, cwd, pre });

	// PHASE 2 — build the stage prompt (with Atomic Profile + Update Mode + Profile compact)
	const fullPrompt = buildAtomicFunctionPrompt({
		stage: "analyzing-atomic-functions",
		mission: pre.state.mission,
		framework: config.framework?.language,
		runId: pre.state.runId,
		atomicProfile: pre.atomicProfile,
		scouts: dispatch.scouts,
		inputArtifact: pre.inputs.inputArtifactPath,
		inputArtifactContent: pre.inputs.inputArtifactContent,
		workingCopy: dispatch.paths.workingCopyPath,
		scoutsDir: dispatch.paths.scoutsDir,
		updateMode,
		profileMetadata,
	});

	// Hand off to the parent LLM via the standard channel. The parent
	// LLM follows skills/velpari-atomic-function.md: spawn scouts,
	// merge, write working copy, show preview gate, and on "yes"
	// call velpari_stage_publish (the publish tool from Plan B).
	pi.sendUserMessage(fullPrompt);
}