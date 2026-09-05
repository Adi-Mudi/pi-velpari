/**
 * /velpari-atomic-function handler.
 *
 * Optional post-pipeline stage. Reads all published artifacts (discussion +
 * PRD + RTM + feasibility + design + pseudocode + test plan + test cases)
 * and spawns 4 subagents in parallel to propose atomic function splits.
 *
 * Phase B: data-driven via STAGE_REGISTRY. The 8 inputs and their
 * discussion-optional handling live in STAGE_REGISTRY["atomic-function"].inputs.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage } from "./registry.js";

export async function handleAtomicFunction(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	await runStage("atomic-function", ctx, pi, cwd);
}
