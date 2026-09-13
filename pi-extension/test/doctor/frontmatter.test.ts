/**
 * Doctor frontmatter check tests (RTM traceability upgrade, Phase 1).
 *
 * Covers:
 *   - no project name → info skip
 *   - grouped artifact with complete frontmatter → ok
 *   - grouped artifact missing fields → error
 *   - legacy-layout artifact missing fields → warning
 *   - brainstorm notes in Doc/brainstorm are scanned too
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFrontmatterSection } from "../../src/doctor/checks/frontmatter.js";

const FULL_FM = [
	"---",
	"artifact: RTM",
	"project: TestApp",
	"version: 1.0.0",
	"status: published",
	"stage: built-rtm",
	"run: run-1",
	"created: 2026-09-12T00:00:00.000Z",
	"updated: 2026-09-12T00:00:00.000Z",
	"---",
	"",
	"# RTM",
	"",
].join("\n");

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-frontmatter-"));
}

describe("checkFrontmatterSection", () => {
	it("skips with info when project name is missing", () => {
		const section = checkFrontmatterSection(tmp(), "");
		assert.equal(section.title, "Artifact frontmatter");
		assert.equal(section.items[0]!.status, "info");
	});

	it("reports ok when all published artifacts carry full frontmatter", () => {
		const cwd = tmp();
		mkdirSync(join(cwd, "Doc", "requirements"), { recursive: true });
		writeFileSync(join(cwd, "Doc", "requirements", "RTM_TestApp.md"), FULL_FM);
		const section = checkFrontmatterSection(cwd, "TestApp");
		assert.equal(section.items[0]!.status, "ok");
	});

	it("errors on a grouped artifact missing fields", () => {
		const cwd = tmp();
		mkdirSync(join(cwd, "Doc", "requirements"), { recursive: true });
		writeFileSync(join(cwd, "Doc", "requirements", "RTM_TestApp.md"), "# RTM\n");
		const section = checkFrontmatterSection(cwd, "TestApp");
		assert.equal(section.items[0]!.status, "error");
		assert.match(section.items[0]!.message, /missing frontmatter field/);
	});

	it("warns (not errors) on a legacy-layout artifact missing fields", () => {
		const cwd = tmp();
		mkdirSync(join(cwd, "Doc"), { recursive: true });
		writeFileSync(join(cwd, "Doc", "RTM_TestApp.md"), "# RTM\n");
		const section = checkFrontmatterSection(cwd, "TestApp");
		assert.equal(section.items[0]!.status, "warning");
	});

	it("scans brainstorm notes under Doc/brainstorm", () => {
		const cwd = tmp();
		mkdirSync(join(cwd, "Doc", "brainstorm"), { recursive: true });
		writeFileSync(join(cwd, "Doc", "brainstorm", "brainstorm-todo.md"), "# Notes\n");
		const section = checkFrontmatterSection(cwd, "TestApp");
		assert.equal(section.items[0]!.status, "error");
		assert.match(section.items[0]!.message, /brainstorm-todo\.md/);
	});
});
