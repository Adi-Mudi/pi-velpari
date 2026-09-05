/**
 * /velpari-prd handler.
 *
 * Phase B: data-driven via STAGE_REGISTRY. All per-stage behaviour lives in
 * stages/registry.ts. To read the inputs, scout list, working-copy layout,
 * profile metadata, etc. for PRD, look up STAGE_REGISTRY.prd.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage } from "./registry.js";

export async function handlePrd(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	await runStage("prd", ctx, pi, cwd);
}
