// Tests — stages/worktree-lock.ts (Phase 5, N5/N6/N8).
// Real git fixtures for the worktree/branch verdicts; a literal ChangeReport for
// the N8-B message; asserts every block names the fix (git worktree add),
// fail-open on non-git / unstamped runs, and the branch-moved case.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import {
	boundPairOf,
	shouldLazilyStamp,
	verifyRunStartLine,
	verifyRunWorktree,
	verifyUpstreamMoves,
	worktreeBlockMessage,
} from "../../src/stages/worktree-lock.js";
import { writeRunBinding } from "../../src/core/run-binding.js";
import { appendHistory } from "../../src/core/history.js";
import { saveState, type RunState } from "../../src/core/state.js";
import type { ChangeReport } from "../../src/core/change-report.js";

const IDENT = ["-c", "user.email=velpari@test.local", "-c", "user.name=Velpari Test"];

let dirs: string[] = [];

function freshDir(prefix = "velpari-wtlock-"): string {
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

function stateFor(dir: string, extra: Partial<RunState> = {}): RunState {
	return {
		version: 1,
		runId: "run-A",
		mission: "mission",
		currentStage: "building-rtm",
		updatedAt: "2026-09-27T00:00:00.000Z",
		runWorktree: dir,
		runBranch: "main",
		...extra,
	};
}

/** Literal report helper — the N8-B message does not need a real store. */
function reportWith(classification: "foreign-run" | "own-run" | "unknown"): ChangeReport {
	return {
		runId: "run-A",
		stage: "building-rtm",
		generatedAt: "2026-09-27T00:00:00.000Z",
		worktree: {
			bound: "/wt-a",
			current: "/wt-a",
			boundBranch: "velpari/line-A",
			currentBranch: "velpari/line-A",
			mismatch: false,
			upstream: null,
			behind: 0,
		},
		foreignLines: [],
		entries: [
			{
				artifact: "rtm",
				kind: "rtm",
				reason: "input-changed",
				changedInputs: ["prd:TestApp"],
				move:
					classification === "foreign-run"
						? {
								kind: "prd",
								move: "foreign-run",
								publishedHead: {
									kind: "prd",
									revisionId: 9,
									revisionNumber: 7,
									runId: "run-B",
									publishedAt: "2026-09-27T01:00:00.000Z",
									fingerprint: "f",
									version: 2,
								},
								myRevisionNumber: 5,
								storeLastCommit: "abc1234",
								otherRuns: ["run-B"],
							}
						: null,
				classification,
				detail: classification === "foreign-run" ? "STOP" : "review",
			},
		],
		text: "",
	};
}

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("verifyRunWorktree — N6 per-command check", () => {
	let dir: string;
	beforeEach(() => {
		dir = freshDir();
		initRepo(dir, "main");
	});

	test("matching worktree + branch → ok, no notes", () => {
		const verdict = verifyRunWorktree(stateFor(dir), dir);
		assert.equal(verdict.ok, true);
		assert.deepEqual(verdict.ok ? verdict.notes : [], []);
	});

	test("different worktree → worktree-mismatch naming both folders + the fix", () => {
		// Honest fixture: a REAL second worktree of the same repo (not a bare
		// temp folder, which would fail open as "not a git worktree").
		const second = join(freshDir(), "line-b");
		execFileSync("git", ["worktree", "add", second, "-b", "velpari/line-B"], { cwd: dir });

		const verdict = verifyRunWorktree(stateFor(dir), second);
		assert.equal(verdict.ok ? "" : verdict.kind, "worktree-mismatch");
		const reason = verdict.ok ? "" : verdict.reason;
		assert.ok(reason.includes(dir), "names the bound worktree");
		assert.ok(reason.includes(second), "names the current folder");
		assert.match(reason, /git worktree add \.\.\//);
	});

	test("different branch (not checked out elsewhere) → branch-mismatch", () => {
		const verdict = verifyRunWorktree(stateFor(dir, { runBranch: "velpari/line-Z" }), dir);
		assert.equal(verdict.ok ? "" : verdict.kind, "branch-mismatch");
		assert.match(verdict.ok ? "" : verdict.reason, /git checkout velpari\/line-Z/);
	});

	test("run's branch lives in ANOTHER worktree → branch-moved", () => {
		const second = join(freshDir(), "line-b");
		execFileSync("git", ["worktree", "add", second, "-b", "velpari/line-B"], { cwd: dir });
		const verdict = verifyRunWorktree(stateFor(dir, { runBranch: "velpari/line-B" }), dir);
		assert.equal(verdict.ok ? "" : verdict.kind, "branch-moved");
		assert.match(verdict.ok ? "" : verdict.reason, /checked out in another worktree/);
	});

	test("non-git folder → ok + note (fail-open, R4)", () => {
		const plain = freshDir("velpari-wtlock-plain-");
		const verdict = verifyRunWorktree(stateFor(plain), plain);
		assert.equal(verdict.ok, true);
		assert.match(verdict.ok ? verdict.notes.join(" ") : "", /not a git worktree/);
	});

	test("unstamped run → ok + note (lazy stamp path)", () => {
		const state = stateFor(dir, { runWorktree: undefined, runBranch: undefined });
		assert.equal(shouldLazilyStamp(state), true);
		const verdict = verifyRunWorktree(state, dir);
		assert.equal(verdict.ok, true);
		assert.match(verdict.ok ? verdict.notes.join(" ") : "", /no worktree stamp yet/);
	});

	test("no active run → ok silently", () => {
		const verdict = verifyRunWorktree(stateFor(dir, { runId: "" }), dir);
		assert.equal(verdict.ok, true);
		assert.deepEqual(verdict.ok ? verdict.notes : [], []);
	});

	test("boundPairOf prefers the state stamp, falls back to the binding record", () => {
		const stamped = stateFor(dir, { runWorktree: "/stamped", runBranch: "stamped-branch" });
		assert.deepEqual(boundPairOf(dir, stamped), { worktree: "/stamped", branch: "stamped-branch" });

		writeRunBinding(dir, {
			runId: "run-B",
			branch: "velpari/line-B",
			worktree: dir,
			startedAt: "t0",
			status: "active",
		});
		const unstamped = stateFor(dir, { runId: "run-B", runWorktree: undefined, runBranch: undefined });
		assert.deepEqual(boundPairOf(dir, unstamped), { worktree: dir, branch: "velpari/line-B" });
	});
});


describe("verifyRunStartLine — N5 second-line block", () => {
	let dir: string;
	beforeEach(() => {
		dir = freshDir();
		initRepo(dir, "velpari/line-A");
	});

	test("no foreign line → ok", () => {
		assert.equal(verifyRunStartLine(stateFor(dir, { runId: "run-B" }), dir).ok, true);
	});

	test("a live sibling line in this folder → blocked with the N5 wording", () => {
		saveState({ version: 1, runId: "run-A", mission: "m", currentStage: "building-rtm", updatedAt: "t0" }, dir);
		appendHistory(dir, "run-A", { stage: "brainstorming", command: "/velpari-brainstorm", timestamp: "t0" });
		writeRunBinding(dir, {
			runId: "run-A",
			branch: "velpari/line-A",
			worktree: dir,
			startedAt: "t0",
			status: "active",
		});

		const verdict = verifyRunStartLine(stateFor(dir, { runId: "run-B" }), dir);
		assert.equal(verdict.ok ? "" : verdict.kind, "foreign-line");
		const reason = verdict.ok ? "" : verdict.reason;
		assert.match(reason, /Run run-A is parallel to active run run-B in this working folder/);
		assert.match(reason, /git worktree add \.\.\//);
	});

	test("non-git folder → ok (fail-open)", () => {
		const plain = freshDir("velpari-wtlock-plain2-");
		assert.equal(verifyRunStartLine(stateFor(plain, { runId: "run-B" }), plain).ok, true);
	});
});

describe("verifyUpstreamMoves — N8-B", () => {
	test("a foreign-run entry blocks with artifact/revision/run/commit + the fix", () => {
		const verdict = verifyUpstreamMoves(stateFor("/wt-a", { runId: "run-A" }), "/wt-a", {
			report: reportWith("foreign-run"),
		});
		assert.equal(verdict.ok ? "" : verdict.kind, "upstream-moved");
		const reason = verdict.ok ? "" : verdict.reason;
		assert.match(reason, /prd rev 7 published by run run-B \(commit abc1234\)/);
		assert.match(reason, /your line is at rev 5/);
		assert.match(reason, /git worktree add \.\.\//);
	});

	test("own-run / unknown entries never block", () => {
		assert.equal(verifyUpstreamMoves(stateFor("/wt-a"), "/wt-a", { report: reportWith("own-run") }).ok, true);
		assert.equal(verifyUpstreamMoves(stateFor("/wt-a"), "/wt-a", { report: reportWith("unknown") }).ok, true);
	});

	test("no active run → ok", () => {
		assert.equal(verifyUpstreamMoves(stateFor("/wt-a", { runId: "" }), "/wt-a").ok, true);
	});
});

describe("worktreeBlockMessage — every block names a fix", () => {
	test("all five kinds include actionable guidance", () => {
		const info = {
			runId: "run-A",
			worktree: "/wt-a",
			branch: "velpari/line-A",
			currentWorktree: "/wt-b",
			currentBranch: "velpari/line-B",
			otherRunId: "run-B",
			otherWorktree: "/wt-c",
		};
		assert.match(worktreeBlockMessage("foreign-line", info), /git worktree add \.\.\//);
		assert.match(worktreeBlockMessage("worktree-mismatch", info), /cd \/wt-a/);
		assert.match(worktreeBlockMessage("branch-mismatch", info), /git checkout velpari\/line-A/);
		assert.match(worktreeBlockMessage("branch-moved", info), /\/wt-c/);
		assert.match(worktreeBlockMessage("upstream-moved", info), /STOP — upstream moved by another run line/);
	});
});

