/**
 * /velpari-development-order handler.
 *
 * Optional post-pipeline stage. Reads design + RTM + feasibility + PRD +
 * test plan and spawns 4 subagents in parallel to produce 4 rankings
 * (topology, risk, test-coverage, value); the parent LLM merges them into
 * a single final order.
 *
 * Phase B: data-driven via STAGE_REGISTRY. See STAGE_REGISTRY["development-order"].
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage } from "./registry.js";

export async function handleDevelopmentOrder(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	await runStage("development-order", ctx, pi, cwd);
}
