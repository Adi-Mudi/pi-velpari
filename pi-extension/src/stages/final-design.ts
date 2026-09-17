/**
 * /velpari-final-design handler (Stage 10 — required post-development-order).
 *
 * Renamed from /velpari-html-design on 2026-09-14; /velpari-html-design was
 * itself renamed from /velpari-design per plan §Phase 1.
 *
 * Reads the approved design + atomic functions + pseudocode + test plan +
 * test cases + development order and spawns 4 subagents in parallel
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
