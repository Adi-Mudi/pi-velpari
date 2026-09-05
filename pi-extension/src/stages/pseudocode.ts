/**
 * /velpari-pseudocode handler.
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
