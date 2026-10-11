/**
 * Derived "Action items" callout (Doctor optimization P0 — the lazy callout).
 *
 * The callout is a presentation-only view built on demand at render time
 * (see `report.ts`'s `--quiet` path); it is never stored in
 * `report.sections`, so the summary counts each real check exactly once.
 *
 * Layer rule: L1 `doctor/` — imports `_types.ts` only. Kept in its own
 * module (not `index.ts`) so `report.ts` can use it without creating an
 * `index.ts` ⇄ `report.ts` import cycle.
 */

import type { DiagnosticItem, DiagnosticSection } from "./_types.js";

/**
 * Build a top-of-report "Action items" callout listing every error
 * and warning item with its suggestion. Useful when the full report
 * is truncated by the TUI notify (8000-char cap).
 */
export function buildActionItemsSection(sections: DiagnosticSection[]): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	for (const section of sections) {
		for (const item of section.items) {
			if (item.status !== "error" && item.status !== "warning") continue;
			const fix = item.suggestion ? ` → Fix: ${item.suggestion}` : "";
			items.push({
				status: item.status,
				message: `${section.title}: ${item.message}${fix}`,
			});
		}
	}
	if (items.length === 0) {
		return {
			title: "Action items",
			items: [
				{
					status: "ok",
					message: "No errors or warnings — nothing to fix.",
				},
			],
		};
	}
	return { title: "Action items", items };
}
