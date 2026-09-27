// Tests — core/run-binding.ts (Phase 5, N5).
// Real git fixtures in temp dirs. Covers: fail-open outside a git worktree
// (nothing written), stamp round-trip, idempotent ensure (existing record is
// returned untouched), a closed record never reopening, closeRunBinding
// (idempotent, closedBy recorded), tolerant listRunBindings (loose files,
// malformed JSON), and foreignLinesInWorktree's liveness rule (active +
// different run + same folder + history not at handoff-ready; empty history =
// abandoned).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import {
	RUN_BINDING_FILE,
	bindingPath,
	closeRunBinding,
	ensureRunBinding,
	foreignLinesInWorktree,
	listRunBindings,
	readRunBinding,
	writeRunBinding,
	type RunBinding,
} from "../../src/core/run-binding.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";
import { appendHistory } from "../../src/core/history.js";
import { PATHS } from "../../src/core/constants.js";

const IDENT = ["-c", "user.email=velpari@test.local", "-c", "user.name=Velpari Test"];

let dirs: string[] = [];

function freshDir(prefix = "velpari-binding-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function initRepo(dir: string, branch = "main"): void {
	execFileSync("git", ["init", "-b", branch], { cwd: dir });
	writeFileSync(join(dir, "README.md"), "# fixture\n", "utf8");
	execFileSync("git", ["add", "-A"], { cwd: dir });
	execFileSync("git", [...IDENT, "commit", "-m", "init"], { cwd: dir });
}

/** A run whose state + run folder + history already exist (started earlier). */
function seedRun(dir: string, runId: string, lastStage = "brainstorming"): void {
	appendHistory(dir, runId, {
		stage: "brainstorming",
		command: "/velpari-brainstorm",
		timestamp: "t0",
	});
	if (lastStage !== "brainstorming") {
		appendHistory(dir, runId, { stage: lastStage as never, command: "/velpari-handoff", timestamp: "t1" });
	}
	saveState(
		{
			version: 1,
			runId,
			mission: `mission ${runId}`,
			currentStage: "brainstorming",
			updatedAt: "t0",
		},
		dir,
	);
}

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("ensureRunBinding (N5 stamp)", () => {
	beforeEach(() => {
		dirs.push(mkdtempSync(join(tmpdir(), "velpari-binding-")));
	});

	test("outside a git worktree: nothing written, fail-open", () => {
		const dir = dirs[dirs.length - 1]!;
		const state = createRun("non-git mission", dir);
		const result = ensureRunBinding(dir, state);
		assert.equal(result.created, false);
		assert.equal(result.binding, null);
		assert.equal(existsSync(bindingPath(dir, state.runId)), false);
	});

	test("git worktree: stamps branch + worktree, writes the record once", () => {
		const dir = dirs[dirs.length - 1]!;
		initRepo(dir, "velpari/line-A");
		const state = createRun("git mission", dir);

		const first = ensureRunBinding(dir, state);
		assert.equal(first.created, true);
		assert.equal(first.binding!.runId, state.runId);
		assert.equal(first.binding!.branch, "velpari/line-A");
		assert.equal(first.binding!.status, "active");
		assert.ok(first.binding!.worktree.length > 0);

		const onDisk = JSON.parse(readFileSync(bindingPath(dir, state.runId), "utf8")) as RunBinding;
		assert.deepEqual(onDisk, first.binding);

		// Second call returns the SAME record (startedAt untouched, no rewrite).
		const second = ensureRunBinding(dir, loadState(dir));
		assert.equal(second.created, false);
		assert.equal(second.binding!.startedAt, first.binding!.startedAt);
	});

	test("a closed record is never silently reopened", () => {
		const dir = dirs[dirs.length - 1]!;
		initRepo(dir);
		const state = createRun("close mission", dir);
		ensureRunBinding(dir, state);
		assert.equal(closeRunBinding(dir, state.runId, "reset"), true);

		const again = ensureRunBinding(dir, loadState(dir));
		assert.equal(again.created, false);
		assert.equal(again.binding!.status, "closed");
	});

	test("no runId → no record", () => {
		const dir = dirs[dirs.length - 1]!;
		initRepo(dir);
		const result = ensureRunBinding(dir, { ...loadState(dir), runId: "" });
		assert.equal(result.created, false);
		assert.equal(result.binding, null);
	});
});

describe("closeRunBinding + tolerant reads", () => {
	beforeEach(() => {
		dirs.push(mkdtempSync(join(tmpdir(), "velpari-binding-")));
	});

	test("close records closedAt/closedBy and is idempotent", () => {
		const dir = dirs[dirs.length - 1]!;
		writeRunBinding(dir, {
			runId: "run-1",
			branch: "main",
			worktree: dir,
			startedAt: "t0",
			status: "active",
		});
		assert.equal(closeRunBinding(dir, "run-1", "handoff"), true);
		const closed = readRunBinding(dir, "run-1")!;
		assert.equal(closed.status, "closed");
		assert.equal(closed.closedBy, "handoff");
		assert.ok(closed.closedAt);
		assert.equal(closeRunBinding(dir, "run-1", "reset"), false); // already closed
		assert.equal(closeRunBinding(dir, "missing-run", "reset"), false);
	});

	test("malformed or partial files read as null; listRunBindings skips them", () => {
		const dir = dirs[dirs.length - 1]!;
		const runsDir = join(dir, PATHS.RUNS_DIR);
		mkdirSync(join(runsDir, "bad-json"), { recursive: true });
		writeFileSync(join(runsDir, "bad-json", RUN_BINDING_FILE), "{not json", "utf8");
		mkdirSync(join(runsDir, "partial"), { recursive: true });
		writeFileSync(join(runsDir, "partial", RUN_BINDING_FILE), JSON.stringify({ runId: "x" }), "utf8");
		mkdirSync(join(runsDir, "no-binding"), { recursive: true });
		writeFileSync(join(runsDir, "loose.txt"), "not a run\n", "utf8");

		assert.equal(readRunBinding(dir, "bad-json"), null);
		assert.equal(readRunBinding(dir, "partial"), null);
		assert.equal(readRunBinding(dir, "no-binding"), null);
		assert.deepEqual(listRunBindings(dir), []);

		writeRunBinding(dir, { runId: "good", branch: "main", worktree: dir, startedAt: "t", status: "active" });
		assert.equal(listRunBindings(dir).length, 1);
	});
});


describe("foreignLinesInWorktree (N5 second-line detection)", () => {
	let dir: string;
	beforeEach(() => {
		dir = freshDir();
		initRepo(dir, "velpari/line-A");
	});

	test("own binding is ignored", () => {
		assert.deepEqual(foreignLinesInWorktree(dir, "run-A", { worktree: dir }), []);
	});

	test("live sibling detected; terminal / abandoned / elsewhere / closed are not", () => {
		seedRun(dir, "run-live");
		writeRunBinding(dir, {
			runId: "run-live",
			branch: "velpari/line-B",
			worktree: dir,
			startedAt: "t0",
			status: "active",
		});

		seedRun(dir, "run-finished", "handoff-ready");
		writeRunBinding(dir, {
			runId: "run-finished",
			branch: "velpari/line-C",
			worktree: dir,
			startedAt: "t0",
			status: "active",
		});

		// Active binding but NO history → abandoned (e.g. cleared by reset).
		mkdirSync(join(dir, PATHS.RUNS_DIR, "run-abandoned"), { recursive: true });
		writeRunBinding(dir, {
			runId: "run-abandoned",
			branch: "velpari/line-D",
			worktree: dir,
			startedAt: "t0",
			status: "active",
		});

		// Active + live, but bound to ANOTHER worktree.
		seedRun(dir, "run-elsewhere");
		writeRunBinding(dir, {
			runId: "run-elsewhere",
			branch: "velpari/line-E",
			worktree: "/somewhere/else",
			startedAt: "t0",
			status: "active",
		});

		// Closed sibling with history → not a live line.
		seedRun(dir, "run-closed");
		writeRunBinding(dir, {
			runId: "run-closed",
			branch: "velpari/line-F",
			worktree: dir,
			startedAt: "t0",
			status: "closed",
			closedBy: "reset",
			closedAt: "t1",
		});

		const lines = foreignLinesInWorktree(dir, "run-current", { worktree: dir });
		assert.deepEqual(
			lines.map((l) => l.runId),
			["run-live"],
		);
	});

	test("non-git folder returns [] (fail-open)", () => {
		const plain = freshDir("velpari-binding-plain-");
		assert.deepEqual(foreignLinesInWorktree(plain, "run-A"), []);
	});
});

