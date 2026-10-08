// Unit tests — core/agents-md.ts (Phase B, G4/N21 L2).
// Covers: creation with exactly one marked section, idempotent second run
// (byte-identical), exact preservation of surrounding user content, in-place
// replacement of an old section body, and the never-throws error contract
// (corrupt target → {changed:false, error}).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ensureProtectedAssetsSection,
	renderProtectedAssetsSection,
	PROTECTED_ASSETS_START,
	PROTECTED_ASSETS_END,
} from "../../src/core/agents-md.js";

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-agents-md-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Current fixture dir (last created by beforeEach). */
function cwd(): string {
	return dirs[dirs.length - 1]!;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

describe("core/agents-md — ensureProtectedAssetsSection", () => {
	test("(a) absent file → created with exactly one marked section", () => {
		const result = ensureProtectedAssetsSection(cwd());
		assert.equal(result.changed, true);
		assert.equal(result.path, join(cwd(), "AGENTS.md"));
		const content = readFileSync(join(cwd(), "AGENTS.md"), "utf8");
		assert.equal(count(content, PROTECTED_ASSETS_START), 1, "exactly one start marker");
		assert.equal(count(content, PROTECTED_ASSETS_END), 1, "exactly one end marker");
		assert.ok(content.includes("managed by Velpari"), "store rule present");
		assert.ok(content.includes("content-frozen") && content.includes("status changes are allowed"), "N20 rule present");
		assert.ok(content.includes("commit-msg hook rejects"), "hook rule present");
	});

	test("(b) run twice → changed:false the second time, byte-identical file", () => {
		const first = ensureProtectedAssetsSection(cwd());
		assert.equal(first.changed, true);
		const before = readFileSync(join(cwd(), "AGENTS.md"), "utf8");
		const second = ensureProtectedAssetsSection(cwd());
		assert.equal(second.changed, false, "second run is a no-op");
		assert.ok(second.skipped !== undefined, "result explains why nothing changed");
		const after = readFileSync(join(cwd(), "AGENTS.md"), "utf8");
		assert.equal(after, before, "file is byte-identical after the second run");
	});

	test("(c) existing AGENTS.md content preserved exactly around the section", () => {
		const original = "# My rules\n\nDo things well.\n\n- custom bullet\n";
		writeFileSync(join(cwd(), "AGENTS.md"), original, "utf8");
		const result = ensureProtectedAssetsSection(cwd());
		assert.equal(result.changed, true);
		const content = readFileSync(join(cwd(), "AGENTS.md"), "utf8");
		assert.ok(content.startsWith(original), "every original byte stays as the prefix");
		assert.equal(count(content, PROTECTED_ASSETS_START), 1, "section appended once");
	});

	test("(d) old section body → replaced in place once, sentinels kept", () => {
		const header = "# Repo agents\n\nIntro paragraph.\n";
		const footer = "\nFooter stays.\n";
		writeFileSync(
			join(cwd(), "AGENTS.md"),
			`${header}${PROTECTED_ASSETS_START}\nOLD STALE BODY\n${PROTECTED_ASSETS_END}${footer}`,
			"utf8",
		);
		const result = ensureProtectedAssetsSection(cwd());
		assert.equal(result.changed, true, "stale body is rewritten");
		const content = readFileSync(join(cwd(), "AGENTS.md"), "utf8");
		assert.ok(content.startsWith(header), "header preserved");
		assert.ok(content.endsWith(footer), "footer preserved");
		assert.ok(!content.includes("OLD STALE BODY"), "old body gone");
		assert.ok(content.includes("managed by Velpari"), "current body present");
		assert.equal(count(content, PROTECTED_ASSETS_START), 1, "still exactly one section");
		const second = ensureProtectedAssetsSection(cwd());
		assert.equal(second.changed, false, "replacement converges (idempotent)");
	});

	test("(e) corrupt target (AGENTS.md is a directory) → {changed:false, error}, never throws", () => {
		mkdirSync(join(cwd(), "AGENTS.md"));
		const result = ensureProtectedAssetsSection(cwd());
		assert.equal(result.changed, false);
		assert.ok(typeof result.error === "string" && result.error.length > 0, "error is reported, not thrown");
		assert.ok(existsSync(result.path), "result still names the path");
	});
});
