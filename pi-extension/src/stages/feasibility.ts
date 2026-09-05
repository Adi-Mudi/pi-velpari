/**
 * /velpari-feasibility handler.
 *
 * Phase B: data-driven via STAGE_REGISTRY. See STAGE_REGISTRY.feasibility.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage } from "./registry.js";

export async function handleFeasibility(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	await runStage("feasibility", ctx, pi, cwd);
}
