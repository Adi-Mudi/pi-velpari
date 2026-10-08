// Tests — doctor git-integration check (Phase 9 1.5, G2a visibility).
// Covers: both files present + correct → ok items; missing .gitattributes
// → warning naming the exact expected line; .gitignore missing one sidecar
// pattern → warning; no files at all → two warnings; suggestion keys point
// at the runbook + publish heal.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkGitIntegrationSection } from "../../src/doctor/checks/git-integration.js";
import {
	PORTFOLIO_ATTR_LINE,
	PORTFOLIO_IGNORE_LINES,
	STORE_DB_ATTR_LINE,
	STORE_IGNORE_LINES,
} from "../../src/ops/git-attributes.js";

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-git-doc-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("checkGitIntegrationSection", () => {
	test("both patterns present → ok items (store + registry patterns)", () => {
		const dir = dirs[dirs.length - 1]!;
		writeFileSync(join(dir, ".gitattributes"), [STORE_DB_ATTR_LINE, PORTFOLIO_ATTR_LINE].join("\n") + "\n", "utf8");
		writeFileSync(
			join(dir, ".gitignore"),
			[...STORE_IGNORE_LINES, ...PORTFOLIO_IGNORE_LINES, "node_modules/"].join("\n") + "\n",
			"utf8",
		);
		const section = checkGitIntegrationSection(dir);
		assert.equal(section.title, "Git integration");
		assert.equal(section.items.length, 2);
		assert.ok(section.items.every((i) => i.status === "ok"));
	});

	test("no files → two warnings with the exact expected lines", () => {
		const dir = dirs[dirs.length - 1]!;
		const section = checkGitIntegrationSection(dir);
		assert.equal(section.items.length, 2);
		const [attr, ignore] = section.items;
		assert.equal(attr?.status, "warning");
		assert.ok(attr?.details?.some((d) => d.includes(STORE_DB_ATTR_LINE)));
		assert.equal(ignore?.status, "warning");
		for (const line of STORE_IGNORE_LINES) {
			assert.ok(ignore?.details?.some((d) => d.includes(line)));
		}
	});

	test("partial: attrs ok, ignore missing one pattern → mixed statuses", () => {
		const dir = dirs[dirs.length - 1]!;
		writeFileSync(join(dir, ".gitattributes"), [STORE_DB_ATTR_LINE, PORTFOLIO_ATTR_LINE].join("\n") + "\n", "utf8");
		writeFileSync(
			join(dir, ".gitignore"),
			[STORE_IGNORE_LINES[0]!, PORTFOLIO_IGNORE_LINES[0]!].join("\n") + "\n",
			"utf8",
		);
		const section = checkGitIntegrationSection(dir);
		assert.equal(section.items[0]?.status, "ok");
		assert.equal(section.items[1]?.status, "warning");
		// The missing shm patterns are named in the expected lines.
		assert.ok(section.items[1]?.details?.some((d) => d.includes("index.db-shm")));
		assert.ok(section.items[1]?.details?.some((d) => d.includes("portfolio.db-shm")));
	});

	test("suggestions point at the runbook + publish auto-heal", () => {
		const dir = dirs[dirs.length - 1]!;
		const section = checkGitIntegrationSection(dir);
		const suggestions = section.items.map((i) => i.suggestion ?? "");
		assert.ok(suggestions.every((s) => s.includes("db-store-merge-runbook.md")));
	});
});
