/**
 * /velpari-pseudocode handler (Stage 7 — required post-atomic-functions).
 *
 * Reads the design + atomic-functions and spawns 4 subagents in parallel
 * to produce module-level pseudocode that references atomic units.
 *
 * Phase B: data-driven via STAGE_REGISTRY. See STAGE_REGISTRY.pseudocode.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage } from "./registry.js";

export async function handlePseudocode(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	await runStage("pseudocode", ctx, pi, cwd);
}
