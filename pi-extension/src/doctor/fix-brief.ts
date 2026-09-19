/**
 * Structured fix brief emitter (Phase 3, Level C).
 *
 * For content-semantic items (`FixLevel === "agentic"`), the doctor
 * hands off to the parent LLM via `pi.sendUserMessage` with a
 * structured brief rather than the free-form prompt used in Phase 1.
 * The brief carries:
 *
 *   - `fingerprint` — the canonical fix-fingerprint key
 *   - `diagnosis` — what the doctor observed (the original item message)
 *   - `suggestedCommand` — the /velpari-* command that usually resolves
 *     the issue (the parent LLM may pick another, but this is the
 *     starting point)
 *   - `contextBlock` — the section / status / message / suggestion
 *     text the parent LLM needs to understand the brief
 *   - `successCriterion` — what "fixed" looks like (always phrased as
 *     a re-/velpari-doctor check)
 *
 * `buildFixBrief` returns `null` for items that are not agentic —
 * the dispatcher falls back to the Phase 1 generic prompt in that case.
 * The lookup goes by suggestion text (reverse scan over `SUGGESTIONS`
 * values), which is the only signal currently attached to actionable
 * items (Phase 1 was fingerprint-blind by design).
 */

import type { ActionableItem } from "./fix-dispatch.js";
import { SUGGESTIONS, levelFor, type SuggestionKey } from "./checks/fix-suggestions.js";

export interface FixBrief {
	/** Canonical fingerprint key (e.g. "fingerprint-suspect"). */
	fingerprint: string;
	/** What the doctor observed (echoes the original item message). */
	diagnosis: string;
	/**
	 * Suggested /velpari-* command. The parent LLM may pick another, but
	 * this is the natural starting point for the fix.
	 */
	suggestedCommand: string;
	/**
	 * Compact context block — section / status / message / suggestion
	 * — for the parent LLM to read alongside the report.
	 */
	contextBlock: string;
	/**
	 * What "fixed" looks like — always phrased as a re-audit outcome
	 * so the parent LLM's loop is self-terminating.
	 */
	successCriterion: string;
}

/**
 * Suggested /velpari-* command per agentic fingerprint. The parent LLM
 * may override; this is the starting point.
 */
const AGENTIC_COMMANDS: Readonly<Record<string, string>> = {
	"fingerprint-suspect": "/velpari-rtm",
	"phase-mismatch": "/velpari-rtm",
	"mvp-incomplete": "/velpari-rtm",
	"rtm-unknown-id": "/velpari-prd",
};

/**
 * Reverse-lookup: scan `SUGGESTIONS` values for an exact match against
 * the actionable item's `suggestion` text and return the matching
 * fingerprint key. Returns `undefined` when no match exists.
 *
 * This is the only signal Phase 1 actionable items carry; Phase 3
 * does not yet extend `DiagnosticItem` with a `fingerprint` field
 * (would require per-check updates outside this ladder).
 */
export function findFingerprintFromSuggestion(suggestion: string): string | undefined {
	for (const [fp, text] of Object.entries(SUGGESTIONS)) {
		if (text === suggestion) return fp;
	}
	return undefined;
}

/**
 * Build a structured brief for an agentic actionable item. Returns
 * `null` when:
 *   - the suggestion text doesn't match any `SUGGESTIONS` key (Phase 1
 *     items where the fingerprint isn't yet on the actionable item);
 *   - the resolved fingerprint's level is not `"agentic"` (the item
 *     should fall through to Phase 1's generic prompt or Phase 2's
 *     auto-remediate path).
 */
export function buildFixBrief(item: ActionableItem): FixBrief | null {
	const fp = findFingerprintFromSuggestion(item.suggestion);
	if (!fp) return null;
	if (levelFor(fp as SuggestionKey) !== "agentic") return null;

	return {
		fingerprint: fp,
		diagnosis: item.message,
		suggestedCommand: AGENTIC_COMMANDS[fp] ?? "/velpari-doctor",
		contextBlock: [
			`Section: ${item.section}`,
			`Status: ${item.status}`,
			`Message: ${item.message}`,
			`Suggestion: ${item.suggestion}`,
		].join("\n"),
		successCriterion: `After running ${AGENTIC_COMMANDS[fp] ?? "/velpari-doctor"}, re-run /velpari-doctor — the "${fp}" fingerprint should be gone.`,
	};
}

/**
 * Render a fix brief as a markdown block for inclusion in the parent
 * LLM prompt. The opening line tells the LLM what kind of brief this
 * is; the rest is structured keys for grep-ability.
 */
export function renderFixBrief(brief: FixBrief): string {
	return [
		`## Doctor Agentic Fix Brief`,
		``,
		`- **Fingerprint**: \`${brief.fingerprint}\``,
		`- **Suggested Command**: \`${brief.suggestedCommand}\``,
		``,
		`**Diagnosis**: ${brief.diagnosis}`,
		``,
		`**Context**:`,
		"```",
		brief.contextBlock,
		"```",
		``,
		`**Success Criterion**: ${brief.successCriterion}`,
	].join("\n");
}
