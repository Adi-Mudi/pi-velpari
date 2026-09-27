/**
 * Run-start worktree enforcement for /velpari-brainstorm (Phase 5, N5).
 *
 * Drives the real `handleBrainstorm` with the mock-ctx harness from
 * `test/ops/brainstorm-stage-guard.test.ts`, on REAL git fixtures:
 *   - non-git folder: run starts, no binding file, no binding notice (fail-open);
 *   - git folder: run starts, `run-binding.json` written, state stamped
 *     (`runBranch`/`runWorktree`) — via Foundation's `setRunWorktreeBranch`;
 *   - a live sibling run line in the same folder: hard-blocked with the N5
 *     wording + `git worktree add`, and the sibling's state.json is untouched;
 *   - that same sibling after its history reaches `handoff-ready`: allowed.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleBrainstorm } from "../../src/stages/brainstorm/index.js";
import { loadState, saveState } from "../../src/core/state.js";
import { appendHistory } from "../../src/core/history.js";
import { bindingPath, writeRunBinding } from "../../src/core/run-binding.js";

const IDENT = ["-c", "user.email=velpari@test.local", "-c", "user.name=Velpari Test"];

interface Notice {
	message: string;
	level: string;
}

function makeHarness(): { notices: Notice[]; ctx: ExtensionCommandContext; pi: ExtensionAPI } {
	const notices: Notice[] = [];
	const ctx = {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
			setStatus: () => {},
			select: async () => "",
			confirm: async () => true,
			input: async () => "",
		},
	} as unknown as ExtensionCommandContext;
	const pi = { sendUserMessage: () => {}, appendEntry: () => {} } as unknown as ExtensionAPI;
	return { notices, ctx, pi };
}

/** Satisfy the multiplexer gate (the same trick the existing suites use). */
function setMux(): void {
	delete process.env.TMUX;
	process.env.PI_SUBAGENT_MUX = "zellij";
}

function initRepo(dir: string, branch = "velpari/line-A"): void {
	execFileSync("git", ["init", "-b", branch], { cwd: dir });
	execFileSync("git", [...IDENT, "commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

/** A live sibling: state.json + history + an active binding, all for run-A. */
function seedSiblingRun(dir: string, lastStage = "brainstorming"): void {
	saveState({ version: 1, runId: "run-A", mission: "old mission", currentStage: "building-rtm", updatedAt: "t0" }, dir);
	appendHistory(dir, "run-A", { stage: "brainstorming", command: "/velpari-brainstorm", timestamp: "t0" });
	if (lastStage !== "brainstorming") {
		appendHistory(dir, "run-A", { stage: lastStage as never, command: "/velpari-handoff", timestamp: "t1" });
	}
	writeRunBinding(dir, {
		runId: "run-A",
		branch: "velpari/line-A",
		worktree: dir,
		startedAt: "t0",
		status: "active",
	});
}

let dirs: string[] = [];
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
	dirs = [];
	savedEnv = { ...process.env };
});

afterEach(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
	Object.assign(process.env, savedEnv);
});

function freshDir(prefix = "velpari-runstart-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

describe("/velpari-brainstorm — run binding (N5)", () => {
	it("non-git folder: run starts, no binding file, no binding notice (fail-open)", async () => {
		const dir = freshDir();
		setMux();
		const { notices, ctx, pi } = makeHarness();

		await handleBrainstorm("non-git mission", ctx, pi, dir);

		const state = loadState(dir);
		assert.equal(state.currentStage, "brainstorming");
		assert.equal(state.runBranch, undefined);
		assert.equal(existsSync(bindingPath(dir, state.runId)), false);
		assert.equal(notices.some((n) => /Run bound to worktree/.test(n.message)), false);
	});

	it("git folder: binding written + state stamped with branch and worktree", async () => {
		const dir = freshDir();
		initRepo(dir, "velpari/line-A");
		setMux();
		const { notices, ctx, pi } = makeHarness();

		await handleBrainstorm("git mission", ctx, pi, dir);

		const state = loadState(dir);
		assert.equal(state.runBranch, "velpari/line-A");
		assert.ok(state.runWorktree && state.runWorktree.length > 0);
		assert.ok(existsSync(bindingPath(dir, state.runId)), "run-binding.json written");
		assert.ok(
			notices.some((n) => /Run bound to worktree .* on branch velpari\/line-A/.test(n.message)),
			"binding notice emitted",
		);
	});

	it("state carried into ANOTHER worktree (folder copy / rename): blocked with the fix", async () => {
		// The honest model of the user's watch item: run A is created in worktree
		// A, then its `.pi/velpari` + run folder travel to worktree B of the same
		// repo (copy / rename / branch checkout) — the state.json is per-folder,
		// so this is how "the same run driven from a second folder" happens.
		const dirA = freshDir();
		initRepo(dirA, "velpari/line-A");
		setMux();
		const first = makeHarness();
		await handleBrainstorm("line A mission", first.ctx, first.pi, dirA);
		const runA = loadState(dirA);
		assert.ok(runA.runWorktree);

		const dirB = join(freshDir(), "line-b");
		execFileSync("git", ["worktree", "add", dirB, "-b", "velpari/line-B"], { cwd: dirA });
		cpSync(join(dirA, ".pi"), join(dirB, ".pi"), { recursive: true });
		cpSync(join(dirA, ".IDE_Plans"), join(dirB, ".IDE_Plans"), { recursive: true });

		const second = makeHarness();
		await handleBrainstorm("line B mission", second.ctx, second.pi, dirB);

		const error = second.notices.find((n) => n.level === "error");
		assert.ok(error, "an error notice was emitted");
		assert.match(error!.message, /Worktree mismatch \(N6\)/);
		assert.match(error!.message, /git worktree add \.\.\//);
		assert.equal(loadState(dirB).runId, runA.runId, "the carried-over run is not replaced");
	});

	it("a displaced live line claiming this folder: blocked with the N5 wording", async () => {
		// Two live bindings for this folder = the N5 violation (a hand-copied
		// `.pi/velpari`, or a state that was replaced by another line).
		const dir = freshDir();
		initRepo(dir, "velpari/line-A");
		seedSiblingRun(dir);
		saveState({ version: 1, runId: "run-B", mission: "newer mission", currentStage: "building-rtm", updatedAt: "t1" }, dir);
		appendHistory(dir, "run-B", { stage: "brainstorming", command: "/velpari-brainstorm", timestamp: "t1" });

		setMux();
		const { notices, ctx, pi } = makeHarness();
		await handleBrainstorm("third mission", ctx, pi, dir);

		const error = notices.find((n) => n.level === "error");
		assert.ok(error, "an error notice was emitted");
		assert.match(error!.message, /Run run-A is parallel to active run run-B/);
		assert.match(error!.message, /git worktree add \.\.\//);
		assert.equal(loadState(dir).runId, "run-B", "state untouched");
	});

	it("a finished sibling (history at handoff-ready): allowed, session opens on the same run", async () => {
		const dir = freshDir();
		initRepo(dir, "velpari/line-A");
		seedSiblingRun(dir, "handoff-ready");
		setMux();
		const { notices, ctx, pi } = makeHarness();

		await handleBrainstorm("amend the mission", ctx, pi, dir);

		const state = loadState(dir);
		assert.equal(state.runId, "run-A", "brainstorm-anytime keeps the same run line");
		assert.equal(state.pausedStage, "building-rtm", "the stage is paused, not replaced");
		assert.equal(notices.some((n) => n.level === "error"), false);
	});
});

