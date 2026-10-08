/**
 * SUGGESTIONS coverage guard (Phase I, subphase I11.4).
 *
 * Every fingerprint in `SUGGESTIONS` must be referenced by at least one
 * doctor check under `src/doctor/checks/**` (any quoted occurrence — the
 * `suggestionFor("…")` literal, a ternary branch, or the remediate
 * registry's `fingerprint` const) **or** sit in the explicit allowlist
 * below: keys consumed by commands/hooks rather than a check (the plan's
 * stated escape hatch). A key that is neither is dead and must be
 * deleted — the guard fails with the key name.
 *
 * This guard is what caught the 12 dead keys removed in I11.4
 * (`stale-run-lock`, `psrs-invalid`, and the 11 pre-gate `atomic-*`
 * suggestions) — user-approved scope add 2026-09-27.
 *
 * Reads source text only; writes nothing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUGGESTIONS } from "../../../src/doctor/checks/fix-suggestions.js";

/** Compiled sibling: `dist/pi-extension/src/doctor/checks` (tests run from dist). */
const CHECKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "doctor", "checks");

/**
 * Keys consumed outside the checks folder (commands/hooks), exempt from
 * the "referenced by a check" rule — the plan's explicit allowlist.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
	"no-active-run",
	"config-missing",
	"config-invalid",
	"doc-dir-missing",
	"unknown-multiplexer",
	"zellij-close-pane",
]);

/**
 * Recursively collect the text of every source file under `dir`
 * except `fix-suggestions.ts` itself.
 * @param {string} dir - Directory to walk (absolute).
 * @returns {string[]} File contents.
 */
function collectCheckSources(dir: string): string[] {
	const texts: string[] = [];
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) {
			texts.push(...collectCheckSources(p));
		} else if (/\.(ts|js)$/.test(entry) && entry !== "fix-suggestions.ts" && !entry.endsWith(".d.ts")) {
			texts.push(readFileSync(p, "utf8"));
		}
	}
	return texts;
}

describe("SUGGESTIONS coverage guard (I11.4)", () => {
	test("every key is referenced by a check or allowlisted", () => {
		const texts = collectCheckSources(CHECKS_DIR);
		const orphans = Object.keys(SUGGESTIONS).filter(
			(key) => !ALLOWLIST.has(key) && !texts.some((t) => t.includes(`"${key}"`) || t.includes(`'${key}'`)),
		);
		assert.deepEqual(orphans, [], `dead suggestion key(s) — delete from SUGGESTIONS or allowlist: ${orphans.join(", ")}`);
	});

	test("allowlist only holds keys that exist in SUGGESTIONS", () => {
		for (const key of ALLOWLIST) {
			assert.ok(key in SUGGESTIONS, `allowlist key "${key}" no longer exists — drop it from the allowlist`);
		}
	});
});
