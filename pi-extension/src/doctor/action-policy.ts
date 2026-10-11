/**
 * Action policy (Doctor upgrade Phase 2 — contract T4).
 *
 * ONE place that turns a doctor item into the action the repair engine
 * should take. Bridges the failure taxonomy (`failure-taxonomy.ts`:
 * `classifyItem` → `actionForFailure`) with the actual repair policy
 * (`checks/fix-suggestions.ts`: `SAFE_WHITELIST`) so the picker, the
 * fix flow and the dispatcher can never disagree about whether an item
 * is auto-repairable.
 *
 * Precedence (contract):
 *   1. The item's fingerprint is in `SAFE_WHITELIST` → `"auto-safe"`
 *      (a deterministic, low-blast-radius RemediateFn exists).
 *   2. The fingerprint is marked `"auto-safe"` in `FIX_LEVELS` →
 *      `"auto-safe"` (e.g. `git-attr-missing`/`git-ignore-missing`,
 *      healed by the single `git-integration-heal` fn).
 *   3. Otherwise `actionForFailure(classifyItem(sectionId, item))` —
 *      the taxonomy class default, with its own agentic fingerprint
 *      bridge.
 *   4. Defensive fallback → `"manual"`.
 *
 * Pure — no IO, no state. Same input always yields the same output.
 */

import type { DiagnosticItem } from "./_types.js";
import { SAFE_WHITELIST, SUGGESTIONS, levelFor, type SuggestionKey } from "./checks/fix-suggestions.js";
import { actionForFailure, classifyItem, type FixAction } from "./failure-taxonomy.js";

/**
 * Reverse-lookup a fingerprint from its `SUGGESTIONS` prose. The doctor
 * does not carry a `fingerprint` field on `DiagnosticItem` yet, so the
 * suggestion text is the only bridge (same convention as
 * `failure-taxonomy.ts` / `fix-brief.ts`).
 * @param {string | undefined} suggestion - The item's suggestion text.
 * @returns {string | undefined} The matching fingerprint, or undefined.
 */
function fingerprintFromSuggestion(suggestion: string | undefined): string | undefined {
	if (!suggestion) return undefined;
	for (const [fingerprint, text] of Object.entries(SUGGESTIONS)) {
		if (text === suggestion) return fingerprint;
	}
	return undefined;
}

/**
 * Decide how the doctor should act on one item.
 *
 * @param {string} sectionId - Stable machine section id (see `report-schema.ts:sectionId`).
 * @param {DiagnosticItem} item - The actionable item.
 * @returns {FixAction} `auto-safe` (whitelisted repair exists), `agentic`
 *   (parent-LLM brief), `escalate` (store integrity — human), or `manual`.
 */
export function decideAction(sectionId: string, item: DiagnosticItem): FixAction {
	const fingerprint = fingerprintFromSuggestion(item.suggestion);
	if (fingerprint !== undefined) {
		// Whitelisted (runnable) and declaratively auto-safe both win over the
		// class default — the repair policy is the single source of truth.
		if (SAFE_WHITELIST.has(fingerprint)) return "auto-safe";
		if (levelFor(fingerprint as SuggestionKey) === "auto-safe") return "auto-safe";
	}
	// Taxonomy bridge: class default + its own agentic fingerprint check.
	const action = actionForFailure(classifyItem(item, sectionId), item);
	return action ?? "manual";
}
