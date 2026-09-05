/**
 * Recommend-side helpers — labelled pickers and the no-match fallback path.
 *
 * Phase C split: pulled out of configure-requirements.ts.
 *
 * `runFallbackActions` is the only entry point the orchestrator (index.ts)
 * calls when no exact built-in profile matches. It surfaces the four
 * documented actions — use common core, use closest built-in, update
 * Velpari, stop — and never invents a profile.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { askSelect, FALLBACK_OPTIONS } from "./interview.js";
import type { ProfileRecommendation } from "../../core/profile.js";

/**
 * Render one recommendation as multi-line text:
 *   [score] profileId (kind)
 *   + reason 1
 *   + reason 2
 *   ~ tradeoff 1
 */
export function renderRecommendation(r: ProfileRecommendation): string {
	const head = `[${r.score}] ${r.profileId} (${r.kind})`;
	const reasons = r.reasons.map((x) => `+ ${x}`).join("\n");
	const tradeoffs = r.tradeoffs.map((x) => `~ ${x}`).join("\n");
	return `${head}\n${reasons}\n${tradeoffs}`.trim();
}

/** Render the full recommendation list as a single string block. */
export function renderRecommendationsBlock(recs: ReadonlyArray<ProfileRecommendation>): string {
	if (recs.length === 0) return "(no recommendations)";
	return recs.map((r) => renderRecommendation(r)).join("\n\n");
}

/**
 * Build the recommendation labels shown in the select prompt, with
 * an explicit "Stop — cancel" option at the end. Returns the labels;
 * matching back to ProfileRecommendation entries is via `pickRecommendation`.
 */
export function buildRecommendationLabels(recs: ReadonlyArray<ProfileRecommendation>): string[] {
	const labels: string[] = [];
	for (const r of recs) {
		labels.push(`${r.label} (score ${r.score})`);
	}
	labels.push("Stop — cancel without saving");
	return labels;
}

/**
 * Map a picked label back to a ProfileRecommendation entry. Returns
 * undefined when the user picked the trailing "Stop" option or when the
 * label does not match any entry (defensive).
 */
export function pickRecommendation(
	recs: ReadonlyArray<ProfileRecommendation>,
	pickedLabel: string,
): ProfileRecommendation | undefined {
	if (pickedLabel.startsWith("Stop — cancel")) return undefined;
	for (const r of recs) {
		if (pickedLabel.startsWith(r.label)) return r;
	}
	return undefined;
}

/** Type of the user's fallback choice in the no-match flow. */
export type FallbackChoice = "core" | "closest" | "stop";

/**
 * Ask the user to pick a fallback action when no exact built-in profile
 * matches. The action list is shown via `ctx.ui.select`. Common PSRS
 * core and closest built-in are real, valid choices — there is no
 * fake custom-profile action.
 */
export async function runFallbackActions(
	ctx: ExtensionCommandContext,
	_cwd: string = process.cwd(),
): Promise<FallbackChoice | undefined> {
	const picked = await askSelect<string>(ctx, "No exact profile match — choose a fallback action", [...FALLBACK_OPTIONS]);
	if (picked === undefined) return undefined;
	if (picked === FALLBACK_OPTIONS[0]) return "core";
	if (picked === FALLBACK_OPTIONS[1]) return "closest";
	if (picked === FALLBACK_OPTIONS[2]) return "stop"; // Update Velpari is treated as "stop" in this scope.
	if (picked === FALLBACK_OPTIONS[3]) return "stop";
	return undefined;
}
