/**
 * /velpari-rtm handler.
 *
 * Phase B: data-driven via STAGE_REGISTRY. See STAGE_REGISTRY.rtm.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage } from "./registry.js";

export async function handleRtm(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	await runStage("rtm", ctx, pi, cwd);
}
