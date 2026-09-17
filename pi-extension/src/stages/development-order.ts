/**
 * /velpari-development-order handler (Stage 9 — required post-testplan).
 *
 * Reads the full pre-build artifact set (design + PRD + RTM + feasibility +
 * atomic-functions + pseudocode + test-plan + test-cases) and spawns 4
 * subagents in parallel to produce 4 rankings (topology, risk,
 * test-coverage, value); the parent LLM merges them into a single final
 * order.
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
