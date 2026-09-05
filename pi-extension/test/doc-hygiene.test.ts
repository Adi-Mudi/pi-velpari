/**
 * Doc-hygiene doctest (v0.5.0 Phase I.3).
 *
 * Scans every `Doc/*.md` for the five source-module names that the
 * v0.4.0 architecture upgrade deleted. Each match must be inside one
 * of the explicit allowlist ranges (the v0.4.0 / v0.5.0 callout boxes,
 * the §18 "removed modules" stub in pseudocode.md, and the v0.5.0
 * historical footnote in design.md).
 *
 * Locked-in module names (any of these found OUTSIDE an allowlist
 * range is a regression):
 *   - doctor.ts                 (Phase D: split into discipline/doctor/)
 *   - requirements-profile.ts   (Phase C: split into core/profile.ts + core/profiles-library.ts)
 *   - configure-requirements.ts (Phase C: split into discipline/configure-requirements/)
 *   - scout.ts                  (v2.0: removed, in-process runner)
 *   - contracts.ts              (v2.0: removed, shared ScoutContract types)
 *
 * Algorithm: for each Doc file, find every (path, offset) hit; if the
 * hit is outside an allowed range for that file, fail with a clear
 * error message naming the file, the stale path, and the offset so
 * the contributor can find it quickly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STALE_MODULES = [
	"doctor.ts",
	"requirements-profile.ts",
	"configure-requirements.ts",
	"scout.ts",
	"contracts.ts",
] as const;

/**
 * Allowlist: a Doc/ file may reference a stale module name only inside
 * these text ranges. Each range is bounded by a start + end marker so
 * the test does not depend on byte offsets (which would drift).
 *
 * Why these exist: the v0.4.0 and v0.5.0 callout boxes describe the
 * path migration (old name → new name) by listing the old names; the
 * §18 stub in pseudocode.md documents the removed v1.5 modules; the
 * v0.5.0 historical footnote in design.md announces §2.20/§2.21 removal.
 */
type Allowlist = ReadonlyArray<{
	file: string;
	startMarker: string;
	endMarker: string;
}>;

const ALLOWLIST: Allowlist = [
	// design.md — the v0.4.0 callout box at the top of the file.
	// Note: the startMarker includes the leading ">" (the blockquote
	// marker); the endMarker does NOT (the "> " is the blockquote prefix
	// and the body text is the rest). This works because both markers
	// are unambiguous substrings of the file.
	{
		file: "Doc/design.md",
		startMarker: "v0.4.0 architecture update (2026-09-05):",
		endMarker: "function signatures and contracts documented below are unchanged.",
	},
	// design.md — the v0.5.0 Phase I.3 historical footnote about §2.20/§2.21 removal.
	{
		file: "Doc/design.md",
		startMarker: "(§2.20 `contracts.ts` and §2.21 `scout.ts` were both removed in v0.5.0",
		endMarker: "removals are also documented in the v2.0 callout box at the top of this file.)",
	},
	// design.md — the v2.0 update callout (mentions `scout.ts`, `contracts.ts`,
	// `scouts/*.ts`, `skills/discuss-subagents/*.md`, etc. as removed). The
	// endMarker picks up after the doc-sweep note.
	{
		file: "Doc/design.md",
		startMarker: "**v2.0 update (2026-09-03):** the discussion stage now uses",
		endMarker: "Doc sweep for prior versions is a follow-up",
	},
	// pseudocode.md — the v0.4.0 Update callout at the top of the file.
	{
		file: "Doc/pseudocode.md",
		startMarker: "> **v0.4.0 Update (2026-09-05):** source layout reorganized",
		endMarker: "Algorithmic pseudocode below is unchanged.",
	},
	// pseudocode.md — the §8 v0.4.0 callout for the doctor split.
	{
		file: "Doc/pseudocode.md",
		startMarker: "> Phase A: this module was the `doctor.ts` monolith;",
		endMarker: "where applicable.",
	},
	// pseudocode.md — §18 (intentionally documents removed v1.5 modules).
	{
		file: "Doc/pseudocode.md",
		startMarker: "## 18. Module: `contracts.ts` and `scout.ts` (v1.5)",
		endMarker: "## 19. Module: `discuss-approve.ts` (v1.6)",
	},
	// RTM_Pi-Velpari.md — the FR-54 + NFR-13 rows (both have a "history" call
	// referencing the v1.5 module names that were removed in v2.0; the
	// "Planned" status is the shared endMarker).
	{
		file: "Doc/RTM_Pi-Velpari.md",
		startMarker: "All 36 scout agents follow the same `stages/registry.ts:runStageWithScouts`",
		endMarker: "all 12 scouts follow the `ScoutContract`",
	},
	// PRD.md — the v0.5.0 transition callout (the only place in PRD.md where
	// the v1.5 module name `contracts.ts` is allowed to appear).
	{
		file: "Doc/PRD.md",
		startMarker: "> **v0.5.0 architecture update (2026-09-05):**",
		endMarker:
			"This callout is the allowlist anchor for the doc-hygiene regression test (the only place in this file where `contracts.ts` may appear).",
	},
];

/** Compute the byte ranges covered by all allowlist entries for `file`. */
function computeAllowedRanges(
	file: string,
	text: string,
): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (const entry of ALLOWLIST) {
		if (entry.file !== file) continue;
		const start = text.indexOf(entry.startMarker);
		if (start < 0) continue;
		const end = text.indexOf(entry.endMarker, start);
		if (end < 0) continue;
		out.push([start, end + entry.endMarker.length]);
	}
	return out;
}

function inAnyRange(idx: number, ranges: Array<[number, number]>): boolean {
	return ranges.some(([s, e]) => idx >= s && idx < e);
}

test("Doc/ files do not reference deleted source modules outside the v0.4.0 / v0.5.0 callout boxes", () => {
	const docsDir = "Doc";
	const docFiles = readdirSync(docsDir)
		.filter((f) => f.endsWith(".md"))
		.sort();

	for (const doc of docFiles) {
		const fullPath = join(docsDir, doc);
		const text = readFileSync(fullPath, "utf8");
		const allowed = computeAllowedRanges(fullPath, text);

		for (const stale of STALE_MODULES) {
			let from = 0;
			while (true) {
				const hit = text.indexOf(stale, from);
				if (hit < 0) break;
				if (!inAnyRange(hit, allowed)) {
					throw new Error(
						`${doc} references deleted source module "${stale}" at offset ${hit} ` +
							`outside the v0.4.0 / v0.5.0 callout allowlist. ` +
							`Either update the reference to the new path or extend the allowlist ` +
							`in pi-extension/test/doc-hygiene.test.ts with a matching startMarker/endMarker.`,
					);
				}
				from = hit + stale.length;
			}
		}
	}
});

test("allowlist markers all resolve in their target files (sanity check)", () => {
	// Catches typos in startMarker/endMarker before the assertion above
	// would mis-report a "stale reference" for a missing marker.
	for (const entry of ALLOWLIST) {
		const text = readFileSync(entry.file, "utf8");
		assert.ok(
			text.includes(entry.startMarker),
			`${entry.file} does not contain startMarker: ${entry.startMarker.slice(0, 40)}…`,
		);
		assert.ok(
			text.includes(entry.endMarker),
			`${entry.file} does not contain endMarker: ${entry.endMarker.slice(0, 40)}…`,
		);
	}
});
