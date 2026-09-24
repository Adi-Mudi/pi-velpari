// Tests — ops/git-attributes.ts (Phase 9 1.1, review gap 1).
// Covers: append-if-missing into existing files (never rewrites existing
// lines — plan risk R5), creation when absent, idempotence (second call is
// a no-op), partial heals (one pattern missing → only that file changes),
// and a REAL `git check-attr binary` probe in a temp repo (review nit 8 —
// the attribute must be recognized by git itself, not just present as text).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import {
	ensureStoreGitIntegration,
	STORE_DB_ATTR_LINE,
	STORE_IGNORE_LINES,
	PORTFOLIO_ATTR_LINE,
	PORTFOLIO_IGNORE_LINES,
} from "../../src/ops/git-attributes.js";

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-git-attrs-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("ensureStoreGitIntegration", () => {
	test("no files → creates both with exactly the expected lines (store + registry)", () => {
		const dir = dirs[dirs.length - 1]!;
		const result = ensureStoreGitIntegration(dir);
		assert.equal(result.changed, true);
		assert.equal(result.appended.length, 2);
		assert.ok(result.changedPaths.some((p) => p.endsWith(".gitattributes")));
		assert.ok(result.changedPaths.some((p) => p.endsWith(".gitignore")));
		const attr = readFileSync(join(dir, ".gitattributes"), "utf8");
		const ignore = readFileSync(join(dir, ".gitignore"), "utf8");
		assert.ok(attr.includes(STORE_DB_ATTR_LINE));
		assert.ok(attr.includes(PORTFOLIO_ATTR_LINE), "registry binary attr must heal too");
		for (const line of STORE_IGNORE_LINES) assert.ok(ignore.includes(line));
		for (const line of PORTFOLIO_IGNORE_LINES) assert.ok(ignore.includes(line), `${line} must heal`);
	});

	test("existing files → appends, preserves every original line", () => {
		const dir = dirs[dirs.length - 1]!;
		writeFileSync(join(dir, ".gitattributes"), "*.png binary\n*.md text\n", "utf8");
		writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n", "utf8");
		const result = ensureStoreGitIntegration(dir);
		assert.equal(result.changed, true);
		const attr = readFileSync(join(dir, ".gitattributes"), "utf8");
		const ignore = readFileSync(join(dir, ".gitignore"), "utf8");
		// Originals intact, in order.
		const attrLines = attr.split("\n").map((l) => l.trim());
		assert.ok(attrLines.indexOf("*.png binary") < attrLines.indexOf(STORE_DB_ATTR_LINE));
		assert.ok(attrLines.includes("*.md text"));
		const ignoreLines = ignore.split("\n").map((l) => l.trim());
		assert.ok(ignoreLines.indexOf("node_modules/") < ignoreLines.indexOf(STORE_IGNORE_LINES[0]!));
		assert.ok(ignoreLines.includes("dist/"));
	});

	test("idempotent: second call appends nothing (changed:false)", () => {
		const dir = dirs[dirs.length - 1]!;
		const first = ensureStoreGitIntegration(dir);
		assert.equal(first.changed, true);
		const before = readFileSync(join(dir, ".gitattributes"), "utf8");
		const ignoreBefore = readFileSync(join(dir, ".gitignore"), "utf8");
		const second = ensureStoreGitIntegration(dir);
		assert.equal(second.changed, false);
		assert.deepEqual(second.appended, []);
		assert.deepEqual(second.changedPaths, []);
		assert.equal(readFileSync(join(dir, ".gitattributes"), "utf8"), before);
		assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), ignoreBefore);
	});

	test("partial heal: BOTH attrs present but ignores missing → only .gitignore changes", () => {
		const dir = dirs[dirs.length - 1]!;
		writeFileSync(join(dir, ".gitattributes"), `${STORE_DB_ATTR_LINE}\n${PORTFOLIO_ATTR_LINE}\n`, "utf8");
		writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
		const result = ensureStoreGitIntegration(dir);
		assert.equal(result.changed, true);
		assert.equal(result.appended.length, 1);
		assert.ok(result.appended[0]!.startsWith(".gitignore:"));
		assert.equal(result.changedPaths.length, 1);
		assert.ok(result.changedPaths[0]!.endsWith(".gitignore"));
		// Commented-out variant does NOT count as present (exact-pattern).
	});

	test("commented-out pattern still heals (exact-match detection)", () => {
		const dir = dirs[dirs.length - 1]!;
		writeFileSync(join(dir, ".gitattributes"), `# ${STORE_DB_ATTR_LINE}\n`, "utf8");
		const result = ensureStoreGitIntegration(dir);
		assert.equal(result.changed, true);
		assert.ok(result.appended.some((l) => l.startsWith(".gitattributes:")));
	});

	test("REAL git: check-attr reports binary for the store DB in a temp repo", () => {
		const dir = dirs[dirs.length - 1]!;
		mkdirSync(join(dir, "Doc", "store", "p1"), { recursive: true });
		execFileSync("git", ["init"], { cwd: dir });
		ensureStoreGitIntegration(dir);
		const out = execFileSync("git", ["check-attr", "binary", "--", join("Doc", "store", "p1", "index.db")], {
			cwd: dir,
			encoding: "utf8",
		});
		// `binary` is a macro attribute - git reports it as "set" (some
		// versions print the macro name itself).
		assert.match(out, /binary: (set|binary|specified)$/m);
		// Phase 10: the REGISTRY carries the same binary attr.
		const reg = execFileSync("git", ["check-attr", "binary", "--", join("Doc", "store", "portfolio.db")], {
			cwd: dir,
			encoding: "utf8",
		});
		assert.match(reg, /binary: (set|binary|specified)$/m);
		// And a NON-store file stays unaffected.
		const other = execFileSync("git", ["check-attr", "binary", "--", "README.md"], {
			cwd: dir,
			encoding: "utf8",
		});
		assert.match(other, /binary: unspecified$/m);
	});

	test("heal failure never throws (unwritable file → changed:false + failure note)", () => {
		const dir = dirs[dirs.length - 1]!;
		// .gitattributes as a DIRECTORY makes the write fail loudly.
		mkdirSync(join(dir, ".gitattributes"));
		const result = ensureStoreGitIntegration(dir);
		assert.equal(result.changed, false);
		assert.ok(result.appended.some((l) => /heal failed/.test(l)));
		assert.ok(!existsSync(join(dir, ".gitignore")));
	});
});
