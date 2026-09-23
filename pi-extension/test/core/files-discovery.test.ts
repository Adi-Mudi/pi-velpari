/**
 * files-discovery tests (port of Senai's discoverProjectFiles).
 *
 * Covers:
 *   - folder classification: name sets, test regex, content heuristics
 *     (project marker, >50% code, >50% docs)
 *   - document folder recursion for .md/.txt/.rst/.adoc
 *   - exclusion matching (exact and prefix/) and dotfile skipping
 *   - top-level file classification and sorted output
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverProjectFiles, formatSuggestion, looksLikeTestPath } from "../../src/core/files-discovery.js";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-files-discovery-"));
}

function touch(cwd: string, rel: string): void {
	const full = join(cwd, rel);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, "", "utf8");
}

describe("discoverProjectFiles folder classification", () => {
	it("classifies src/ as a code folder with trailing slash", () => {
		const cwd = tmp();
		touch(cwd, "src/index.ts");
		const r = discoverProjectFiles(cwd, []);
		assert.deepEqual(r.codeFolders, [{ path: "src/", reason: "common code folder" }]);
	});

	it("classifies tests/ as a test folder and does not recurse", () => {
		const cwd = tmp();
		touch(cwd, "tests/foo.test.ts");
		const r = discoverProjectFiles(cwd, []);
		assert.deepEqual(r.testFolders, [{ path: "tests/", reason: "test folder" }]);
		assert.deepEqual(r.testFiles, []);
		assert.deepEqual(r.codeFiles, []);
	});

	it("classifies docs/ as a document folder and collects nested docs", () => {
		const cwd = tmp();
		touch(cwd, "docs/guide.md");
		touch(cwd, "docs/deep/nested/spec.md");
		touch(cwd, "docs/deep/notes.txt");
		touch(cwd, "docs/deep/code.ts");
		const r = discoverProjectFiles(cwd, []);
		assert.deepEqual(r.documentFolders, [{ path: "docs/", reason: "document folder" }]);
		assert.deepEqual(r.documentFiles, ["docs/deep/nested/spec.md", "docs/deep/notes.txt", "docs/guide.md"]);
	});

	it("classifies an unknown folder with package.json as code (project marker)", () => {
		const cwd = tmp();
		touch(cwd, "widget/package.json");
		const r = discoverProjectFiles(cwd, []);
		assert.deepEqual(r.codeFolders, [{ path: "widget/", reason: "project root marker found" }]);
	});

	it("classifies an unknown folder with >50% .ts files as code", () => {
		const cwd = tmp();
		touch(cwd, "custom/a.ts");
		touch(cwd, "custom/b.ts");
		touch(cwd, "custom/notes.md");
		const r = discoverProjectFiles(cwd, []);
		assert.deepEqual(r.codeFolders, [{ path: "custom/", reason: "2 code files found" }]);
	});

	it("classifies an unknown folder with >50% .md files as document", () => {
		const cwd = tmp();
		touch(cwd, "stuff/a.md");
		touch(cwd, "stuff/b.md");
		touch(cwd, "stuff/main.py");
		const r = discoverProjectFiles(cwd, []);
		assert.deepEqual(r.documentFolders, [{ path: "stuff/", reason: "2 document files found" }]);
		assert.deepEqual(r.documentFiles, ["stuff/a.md", "stuff/b.md"]);
	});

	it("ignores an unknown folder with no clear majority", () => {
		const cwd = tmp();
		touch(cwd, "mixed/a.ts");
		touch(cwd, "mixed/b.md");
		touch(cwd, "mixed/logo.png");
		const r = discoverProjectFiles(cwd, []);
		assert.deepEqual(r.codeFolders, []);
		assert.deepEqual(r.documentFolders, []);
	});
});

describe("exclusions and dotfiles", () => {
	it("excludes node_modules/ via prefix match", () => {
		const cwd = tmp();
		touch(cwd, "node_modules/dep/index.js");
		const r = discoverProjectFiles(cwd, ["node_modules/"]);
		assert.deepEqual(r.codeFolders, []);
		assert.deepEqual(r.codeFiles, []);
	});

	it("excludes an exact file match", () => {
		const cwd = tmp();
		touch(cwd, "secret.ts");
		touch(cwd, "main.ts");
		const r = discoverProjectFiles(cwd, ["secret.ts"]);
		assert.deepEqual(r.codeFiles, ["main.ts"]);
	});

	it("skips dotfiles and dot-folders except .github", () => {
		const cwd = tmp();
		touch(cwd, ".pi/config.json");
		touch(cwd, ".gitignore");
		touch(cwd, ".github/workflows/ci.yml");
		const r = discoverProjectFiles(cwd, []);
		assert.deepEqual(r.codeFiles, []);
		assert.deepEqual(r.codeFolders, []);
		assert.deepEqual(r.testFiles, []);
		// .github is an unknown-name folder with no files in known sets → ignored,
		// but it must not throw and must not be silently treated as a dotfile skip
		// of a real folder like .pi.
		assert.deepEqual(r.documentFiles, []);
	});
});

describe("top-level files and sorting", () => {
	it("routes foo.test.ts to testFiles, README.md to documentFiles, main.py to codeFiles", () => {
		const cwd = tmp();
		touch(cwd, "foo.test.ts");
		touch(cwd, "README.md");
		touch(cwd, "main.py");
		const r = discoverProjectFiles(cwd, []);
		assert.deepEqual(r.testFiles, ["foo.test.ts"]);
		assert.deepEqual(r.documentFiles, ["README.md"]);
		assert.deepEqual(r.codeFiles, ["main.py"]);
	});

	it("sorts all six lists alphabetically", () => {
		const cwd = tmp();
		touch(cwd, "b.ts");
		touch(cwd, "a.ts");
		touch(cwd, "z.md");
		touch(cwd, "m.md");
		mkdirSync(join(cwd, "src"), { recursive: true });
		mkdirSync(join(cwd, "lib"), { recursive: true });
		mkdirSync(join(cwd, "tests"), { recursive: true });
		mkdirSync(join(cwd, "e2e"), { recursive: true });
		const r = discoverProjectFiles(cwd, []);
		assert.deepEqual(r.codeFiles, ["a.ts", "b.ts"]);
		assert.deepEqual(r.documentFiles, ["m.md", "z.md"]);
		assert.deepEqual(
			r.codeFolders.map((f) => f.path),
			["lib/", "src/"],
		);
		assert.deepEqual(
			r.testFolders.map((f) => f.path),
			["e2e/", "tests/"],
		);
	});
});

describe("helpers", () => {
	it("looksLikeTestPath matches segments, not substrings", () => {
		assert.ok(looksLikeTestPath("foo.test.ts"));
		assert.ok(looksLikeTestPath("src/__tests__/x.ts"));
		assert.equal(looksLikeTestPath("latest.ts"), false);
		assert.equal(looksLikeTestPath("protest.ts"), false);
	});

	it("formatSuggestion renders label plus reason", () => {
		assert.equal(formatSuggestion("src/", "common code folder"), "src/ (common code folder)");
	});
});
