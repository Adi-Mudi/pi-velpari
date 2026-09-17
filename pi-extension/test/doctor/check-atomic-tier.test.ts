/**
 * Atomic-tier verdict loader tests (Phase 4 of reviewer plan).
 *
 * Covers:
 *   - Missing verdict file → clear error with "Reviewer did not run" message
 *   - Invalid JSON → clear error
 *   - Invalid shape → clear error
 *   - Valid verdict with 1 error → error surfaces in section
 *   - Valid verdict with 1 warning → warning surfaces
 *   - Valid verdict with verdict=approve → ok status
 *   - Valid verdict with verdict=block → error summary line
 *   - Per-issue location + rule + suggestion appear in messages
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadReviewerVerdict } from "../../src/doctor/checks/atomic-tier.js";
import { DEFAULT_ATOMIC_PROFILE } from "../../src/core/atomic-tier.js";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-verdict-"));
}

function writeVerdict(cwd: string, verdict: object): string {
	const runId = "2026-09-16-1200-test";
	const dir = join(cwd, ".IDE_Plans", "velpari", "runs", runId, "atomic-function", "scouts");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "reviewer-report.json");
	writeFileSync(path, JSON.stringify(verdict));
	return path;
}

describe("loadReviewerVerdict — missing file", () => {
	it("returns a clear error when no runs directory exists", () => {
		const cwd = tmp();
		const section = loadReviewerVerdict(cwd, DEFAULT_ATOMIC_PROFILE);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "error");
		assert.match(section.items[0]!.message, /Reviewer verdict not found/);
		assert.match(section.items[0]!.message, /reviewer-report\.json/);
	});
});

describe("loadReviewerVerdict — invalid file", () => {
	it("returns a clear error when the verdict file is not valid JSON", () => {
		const cwd = tmp();
		const runId = "2026-09-16-1200-test";
		const dir = join(cwd, ".IDE_Plans", "velpari", "runs", runId, "atomic-function", "scouts");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "reviewer-report.json"), "this is not json {");

		const section = loadReviewerVerdict(cwd, DEFAULT_ATOMIC_PROFILE);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "error");
		assert.match(section.items[0]!.message, /not valid JSON/);
	});

	it("returns a clear error when verdict shape is invalid", () => {
		const cwd = tmp();
		writeVerdict(cwd, {
			verdict: "approve",
			// missing issues/summary/timestamp
		});

		const section = loadReviewerVerdict(cwd, DEFAULT_ATOMIC_PROFILE);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "error");
		assert.match(section.items[0]!.message, /invalid shape/);
	});
});

describe("loadReviewerVerdict — valid verdicts", () => {
	it("approve verdict with 0 issues → ok status", () => {
		const cwd = tmp();
		writeVerdict(cwd, {
			verdict: "approve",
			issues: [],
			summary: "Reviewed 4 scouts; 0 issues found.",
			timestamp: "2026-09-16T12:00:00Z",
		});

		const section = loadReviewerVerdict(cwd, DEFAULT_ATOMIC_PROFILE);
		// 1 summary item + 0 issue items
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "ok");
		assert.match(section.items[0]!.message, /: approve;/);
	});

	it("verdict with 1 error surfaces as error item", () => {
		const cwd = tmp();
		writeVerdict(cwd, {
			verdict: "needs-fix",
			issues: [
				{
					severity: "error",
					rule: "base-core-missing",
					location: "AF-3",
					message: "cohesion field is empty",
					suggestion: "Fill the missing base-core field.",
				},
			],
			summary: "1 error found.",
			timestamp: "2026-09-16T12:00:00Z",
		});

		const section = loadReviewerVerdict(cwd, DEFAULT_ATOMIC_PROFILE);
		// 1 summary + 1 issue = 2 items
		assert.equal(section.items.length, 2);
		assert.equal(section.items[0]!.status, "error"); // summary
		assert.equal(section.items[1]!.status, "error"); // issue
		assert.match(section.items[1]!.message, /base-core-missing/);
		assert.match(section.items[1]!.message, /AF-3/);
		assert.match(section.items[1]!.message, /cohesion field is empty/);
		assert.match(section.items[1]!.message, /Fill the missing base-core field/);
	});

	it("verdict with 1 warning surfaces as warning item", () => {
		const cwd = tmp();
		writeVerdict(cwd, {
			verdict: "needs-fix",
			issues: [
				{
					severity: "warning",
					rule: "arg-count-high",
					message: "argCount=4 (Clean Code prefers 0-2)",
				},
			],
			summary: "1 warning found.",
			timestamp: "2026-09-16T12:00:00Z",
		});

		const section = loadReviewerVerdict(cwd, DEFAULT_ATOMIC_PROFILE);
		assert.equal(section.items.length, 2);
		assert.equal(section.items[0]!.status, "warning"); // summary because >0 warnings, 0 errors
		assert.equal(section.items[1]!.status, "warning"); // issue
		assert.match(section.items[1]!.message, /arg-count-high/);
	});

	it("verdict=block surfaces the verdict summary as an error", () => {
		const cwd = tmp();
		writeVerdict(cwd, {
			verdict: "block",
			issues: [
				{
					severity: "error",
					rule: "cross-scout-contradiction",
					message: "af-source-rtm and af-source-prd propose different signatures for AF-3",
				},
			],
			summary: "1 error found. Block.",
			timestamp: "2026-09-16T12:00:00Z",
		});

		const section = loadReviewerVerdict(cwd, DEFAULT_ATOMIC_PROFILE);
		assert.equal(section.items[0]!.status, "error");
		assert.match(section.items[0]!.message, /: block;/);
	});

	it("verdict with mixed severities surfaces each correctly", () => {
		const cwd = tmp();
		writeVerdict(cwd, {
			verdict: "needs-fix",
			issues: [
				{ severity: "error", rule: "r1", message: "err1" },
				{ severity: "warning", rule: "r2", message: "warn1" },
				{ severity: "info", rule: "r3", message: "info1" },
			],
			summary: "mixed",
			timestamp: "2026-09-16T12:00:00Z",
		});

		const section = loadReviewerVerdict(cwd, DEFAULT_ATOMIC_PROFILE);
		const severities = section.items.map((i) => i.status);
		assert.deepEqual(severities, ["error", "error", "warning", "info"]);
	});

	it("uses the latest run's verdict when multiple runs exist", () => {
		const cwd = tmp();
		const dir1 = join(cwd, ".IDE_Plans", "velpari", "runs", "2026-09-15-1200-old", "atomic-function", "scouts");
		mkdirSync(dir1, { recursive: true });
		writeFileSync(
			join(dir1, "reviewer-report.json"),
			JSON.stringify({
				verdict: "approve",
				issues: [{ severity: "info", rule: "old", message: "old run" }],
				summary: "old",
				timestamp: "2026-09-15T12:00:00Z",
			}),
		);
		writeVerdict(cwd, {
			verdict: "approve",
			issues: [{ severity: "info", rule: "new", message: "new run" }],
			summary: "new",
			timestamp: "2026-09-16T12:00:00Z",
		});

		const section = loadReviewerVerdict(cwd, DEFAULT_ATOMIC_PROFILE);
		const issueItem = section.items[1]!;
		assert.match(issueItem.message, /new run/);
		assert.doesNotMatch(issueItem.message, /old run/);
	});
});

// suppress unused-import warning when bundled
void rmSync;
