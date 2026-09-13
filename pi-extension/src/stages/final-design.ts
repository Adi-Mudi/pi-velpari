/**
 * /velpari-design handler.
 *
 * Optional post-pipeline stage. Reads the approved design + pseudocode +
 * test plan + test cases and spawns 4 subagents in parallel
 * (consistency / coverage / contract / finalizer) to produce the
 * consolidated final-design markdown.
 *
 * Phase 3 (plan 3): data-driven via STAGE_REGISTRY. See
 * STAGE_REGISTRY["final-design"].
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage } from "./registry.js";

export async function handleFinalDesign(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	await runStage("final-design", ctx, pi, cwd);
}
