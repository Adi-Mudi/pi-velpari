/**
 * Worktree-removal warning tests (Phase 6 — N14).
 *
 * Covers: no state → info, active run bound to an existing path → ok,
 * bound path removed → warning naming the run (never an error),
 * unstamped run → info (pre-binding runs), sibling Phase-5 binding
 * records (dead active path → warning; corrupt/closed records →
 * silently skipped), and no-throw over a corrupt binding file.
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWorktreeRemovalSection } from "../../src/doctor/checks/worktree-removal.js";
import { summarize } from "../../src/doctor/_types.js";

let dirs: string[] = [];
let cwd = "";
let extraWorktree = "";

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-worktree-"));
	dirs.push(dir);
	cwd = dir;
	extraWorktree = join(dir, "wt-sibling");
	mkdirSync(extraWorktree, { recursive: true });
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function writeState(state: Record<string, unknown>): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "velpari", "state.json"),
		JSON.stringify({ version: 1, currentStage: "none", ...state }),
		"utf8",
	);
}

function writeBinding(runId: string, binding: unknown): void {
	const dir = join(cwd, ".IDE_Plans", "velpari", "runs", runId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "run-binding.json"), typeof binding === "string" ? binding : JSON.stringify(binding), "utf8");
}

describe("checkWorktreeRemovalSection", () => {
	test("no state file → single info item, no throw", () => {
		const section = checkWorktreeRemovalSection(cwd);
		assert.equal(section.title, "Run worktree (N14)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /No active run/);
	});

	test("active run bound to an existing worktree → ok naming the run", () => {
		writeState({
			runId: "2026-09-27-00-00-test",
			runWorktree: extraWorktree,
			runBranch: "velpari/test",
		});
		const section = checkWorktreeRemovalSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /2026-09-27-00-00-test bound to .* \(exists, branch velpari\/test\)/);
	});

	test("bound worktree removed → WARNING naming the run, never an error", () => {
		const gone = join(cwd, "wt-removed");
		writeState({
			runId: "2026-09-27-00-01-gone",
			runWorktree: gone,
			runBranch: "velpari/gone",
		});
		const section = checkWorktreeRemovalSection(cwd);
		assert.equal(section.items.length, 1);
		const item = section.items[0];
		assert.equal(item?.status, "warning");
		assert.match(item?.message ?? "", /Run 2026-09-27-00-01-gone is bound to .*wt-removed, which no longer exists/);
		assert.match(item?.message ?? "", /\(N14\)/);
		assert.match(item?.suggestion ?? "", /velpari-reset|worktree add/);
		assert.equal(summarize([section]).summary.error, 0);
	});

	test("run without a worktree stamp → info (N14 not applicable)", () => {
		writeState({ runId: "2026-09-27-00-02-nostamp" });
		const section = checkWorktreeRemovalSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /no worktree binding/);
	});

	test("sibling active binding with dead path → warning for that run", () => {
		writeState({
			runId: "2026-09-27-00-03-active",
			runWorktree: extraWorktree,
			runBranch: "velpari/active",
		});
		writeBinding("2026-09-27-00-04-sibling", {
			runId: "2026-09-27-00-04-sibling",
			branch: "velpari/sibling",
			worktree: join(cwd, "wt-dead"),
			status: "active",
		});
		const section = checkWorktreeRemovalSection(cwd);
		const warnings = section.items.filter((i) => i.status === "warning");
		assert.equal(warnings.length, 1);
		assert.match(warnings[0]?.message ?? "", /Run 2026-09-27-00-04-sibling is bound to/);
		// the healthy active run is still reported once, as ok
		assert.equal(section.items.filter((i) => i.status === "ok").length, 1);
	});

	test("closed + corrupt sibling bindings are skipped silently", () => {
		writeState({ runId: "2026-09-27-00-05-active" });
		writeBinding("closed-run", {
			runId: "closed-run",
			worktree: join(cwd, "wt-dead"),
			status: "closed",
		});
		writeBinding("broken-run", "{not json");
		const section = checkWorktreeRemovalSection(cwd);
		assert.ok(section.items.every((i) => i.status !== "warning"));
		assert.ok(section.items.every((i) => i.status !== "error"));
	});

	test("active run binding duplicated by sibling record → reported once", () => {
		const gone = join(cwd, "wt-once");
		writeState({
			runId: "2026-09-27-00-06-once",
			runWorktree: gone,
			runBranch: "velpari/once",
		});
		writeBinding("2026-09-27-00-06-once", {
			runId: "2026-09-27-00-06-once",
			worktree: gone,
			status: "active",
		});
		const section = checkWorktreeRemovalSection(cwd);
		const warnings = section.items.filter((i) => i.status === "warning");
		assert.equal(warnings.length, 1, "the same dead binding must not be reported twice");
	});
});
