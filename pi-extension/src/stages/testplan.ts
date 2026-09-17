/**
 * /velpari-testplan handler (Stage 8 — required post-pseudocode).
 *
 * Reads the pseudocode + atomic-functions and spawns 4 subagents in
 * parallel (strategy / unit / integration / coverage) to produce the
 * test plan and per-requirement test cases.
 *
 * Phase B: data-driven via STAGE_REGISTRY. See STAGE_REGISTRY.testplan.
 *
 * Note: This stage produces TWO working copies (test-plan + test-cases);
 * STAGE_REGISTRY.testplan.additionalWorkingCopies = ["test-cases"] carries
 * the second path. Working-copy category is `tests` (matches the grouped
 * Doc/ layout — Phase 7).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage } from "./registry.js";

export async function handleTestplan(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	await runStage("testplan", ctx, pi, cwd);
}
