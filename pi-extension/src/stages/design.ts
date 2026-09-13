/**
 * /velpari-architecture-generator handler.
 *
 * Phase B: data-driven via STAGE_REGISTRY. See STAGE_REGISTRY["architecture-generator"].
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage } from "./registry.js";

export async function handleDesign(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	await runStage("architecture-generator", ctx, pi, cwd);
}
