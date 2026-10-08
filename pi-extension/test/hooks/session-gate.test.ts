// Tests — session-start worktree gate integration (Phase A, N18/G2–G4).
// Drives the REGISTERED before_agent_start + tool_call handlers against real
// git fixtures: status line on match, <velpari_session_gate> stop block on
// mismatch (plan-only, no run), byte-identical prompt when nothing binds,
// once-per-session verdict cache (reference identity), fail-open non-git,
// edit/write deny with the exact N18 reason, allow on match with the existing
// guard chain intact (precedence), conflict naming both declarations, and
// cold-cache laziness (tool_call before any agent start).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerBeforeAgentStartHook } from "../../src/hooks/before-agent-start.js";
import { registerToolCallHook } from "../../src/hooks/tool-call.js";
import { resetSessionGateCache, sessionGateVerdict, type SessionGateVerdict } from "../../src/core/plan-binding.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";
import { writeRunBinding, type RunBinding } from "../../src/core/run-binding.js";
import { PATHS } from "../../src/core/constants.js";

const IDENT = ["-c", "user.email=velpari@test.local", "-c", "user.name=Velpari Test"];
const N18_SUFFIX = "Restart the session there. No changes were made.";

type AgentHook = (event: { systemPrompt: string }, ctx: { cwd: string }) => { systemPrompt: string } | undefined;
type ToolHook = (
	event: { toolName: string; toolCall?: { args?: { command?: string } } },
	ctx: { cwd: string },
) => { block: true; reason: string } | undefined;

/** Register before_agent_start on a mock API and return its handler. */
function agentHandler(): AgentHook {
	let registered: AgentHook | undefined;
	const pi = {
		on: (name: string, fn: AgentHook) => {
			if (name === "before_agent_start") registered = fn;
		},
	} as unknown as ExtensionAPI;
	registerBeforeAgentStartHook(pi);
	assert.ok(registered, "before_agent_start must register");
	return registered!;
}

/** Register tool_call on a mock API and return its handler. */
function toolHandler(): ToolHook {
	let registered: ToolHook | undefined;
	const pi = {
		on: (name: string, fn: ToolHook) => {
			if (name === "tool_call") registered = fn;
		},
	} as unknown as ExtensionAPI;
	registerToolCallHook(pi);
	assert.ok(registered, "tool_call must register");
	return registered!;
}

let dirs: string[] = [];

/**
 * Create a fresh temp fixture directory, tracked for cleanup.
 * @param {string} prefix - Temp-dir name prefix (default "velpari-session-gate-").
 * @returns {string} Absolute path of the new directory.
 */
function freshDir(prefix = "velpari-session-gate-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

/**
 * Initialise a git repo with one empty commit on the given branch.
 * @param {string} dir - Directory to `git init` (becomes the worktree root).
 * @param {string} branch - Branch name to create and check out.
 * @returns {void}
 */
function initRepo(dir: string, branch = "main"): void {
	execFileSync("git", ["init", "-q", "-b", branch], { cwd: dir });
	execFileSync("git", [...IDENT, "commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

/**
 * Write a timestamped plan file declaring a worktree/branch with one PENDING item.
 * @param {string} dir - Project root (plan goes under .IDE_Plans/).
 * @param {string} worktree - Declared worktree path.
 * @param {string} branch - Declared branch ("" omits the header line).
 * @param {string} stamp - Filename stamp YYYYMMDD_HHMM.
 * @returns {string} Absolute plan path.
 */
function writePlan(dir: string, worktree: string, branch: string, stamp = "20260928_0100"): string {
	mkdirSync(join(dir, ".IDE_Plans"), { recursive: true });
	const full = join(dir, ".IDE_Plans", `gate_plan_${stamp}_v1.0.md`);
	writeFileSync(
		full,
		[`**Worktree:** \`${worktree}\``, ...(branch ? [`**Branch:** \`${branch}\``] : ""), "- **Status:** PENDING"].join(
			"\n",
		),
		"utf8",
	);
	return full;
}

/**
 * Seed state.json + a run-binding.json for `dir` (close-out covered by status).
 * @param {string} dir - Project root.
 * @param {string} worktree - Bound worktree path.
 * @param {string} branch - Bound branch.
 * @param {string} status - Binding status ("active" binds, "closed" does not).
 * @returns {void}
 */
function seedRunBinding(dir: string, worktree: string, branch: string, status: "active" | "closed" = "active"): void {
	const state = createRun("session-gate mission", dir);
	const binding: RunBinding = {
		runId: state.runId,
		branch,
		worktree,
		startedAt: "2026-09-28T00:00:00.000Z",
		status,
		...(status === "closed" ? { closedAt: "2026-09-28T01:00:00.000Z", closedBy: "reset" as const } : {}),
	};
	mkdirSync(join(dir, PATHS.RUNS_DIR, state.runId), { recursive: true });
	writeRunBinding(dir, binding);
	saveState({ ...state, runBranch: branch, runWorktree: worktree }, dir);
}

beforeEach(() => {
	resetSessionGateCache();
});

afterEach(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs = [];
	resetSessionGateCache();
});

describe("before_agent_start session gate (G2)", () => {
	test("matching plan → one session-gate status line inside the block", () => {
		const dir = freshDir();
		initRepo(dir, "pi-velpari-wt-x");
		writePlan(dir, dir, "pi-velpari-wt-x");
		const out = agentHandler()({ systemPrompt: "BASE" }, { cwd: dir });
		assert.ok(out);
		assert.ok(out!.systemPrompt.includes("<velpari_status>"));
		assert.ok(out!.systemPrompt.includes("session-gate: ok — plan"));
		assert.ok(out!.systemPrompt.includes("matches this session"));
	});

	test("plan declaring another worktree → session_gate stop block, before the no-run early return", () => {
		const dir = freshDir();
		initRepo(dir, "main");
		writePlan(dir, "/the-right-worktree", "the-right-branch");
		const out = agentHandler()({ systemPrompt: "BASE" }, { cwd: dir });
		assert.ok(out);
		assert.ok(out!.systemPrompt.includes("<velpari_session_gate>"));
		assert.ok(
			out!.systemPrompt.includes("This work belongs in worktree /the-right-worktree on branch the-right-branch."),
		);
		assert.ok(out!.systemPrompt.endsWith(`</velpari_session_gate>`));
		// No run in this fixture: the block must still appear (probe runs FIRST).
		assert.ok(!out!.systemPrompt.includes("<velpari_status>"));
	});

	test("no run, no plan → prompt unchanged byte-for-byte", () => {
		const dir = freshDir();
		const out = agentHandler()({ systemPrompt: "BASE" }, { cwd: dir });
		assert.equal(out!.systemPrompt, "BASE");
	});

	test("verdict is computed once per session (reference identity across turns)", () => {
		const dir = freshDir();
		initRepo(dir, "main");
		writePlan(dir, dir, "main");
		const first: SessionGateVerdict = sessionGateVerdict(dir);
		const handler = agentHandler();
		handler({ systemPrompt: "BASE" }, { cwd: dir });
		handler({ systemPrompt: "BASE" }, { cwd: dir });
		const afterTurns = sessionGateVerdict(dir);
		assert.equal(first, afterTurns, "hook turns must reuse the cached verdict");
		resetSessionGateCache();
		assert.notEqual(first, sessionGateVerdict(dir), "reset must recompute");
	});

	test("non-git folder → prompt untouched (fail-open R4)", () => {
		const dir = freshDir();
		writePlan(dir, "/elsewhere", "b");
		const out = agentHandler()({ systemPrompt: "BASE" }, { cwd: dir });
		assert.equal(out!.systemPrompt, "BASE");
	});
});

describe("tool_call session gate (G3)", () => {
	test("mismatch: edit + write blocked with the exact N18 reason; bash untouched", () => {
		const dir = freshDir();
		initRepo(dir, "main");
		writePlan(dir, "/the-right-worktree", "the-right-branch");
		const fire = toolHandler();
		const edit = fire({ toolName: "edit" }, { cwd: dir });
		assert.ok(edit?.block);
		assert.equal(
			edit!.reason,
			"This work belongs in worktree /the-right-worktree on branch the-right-branch. " +
				`You are in ${dir} on branch main. ` +
				N18_SUFFIX,
		);
		const write = fire({ toolName: "write" }, { cwd: dir });
		assert.ok(write?.block);
		assert.equal(fire({ toolName: "bash", toolCall: { args: { command: "ls" } } }, { cwd: dir }), undefined);
	});

	test("match: edit/write allowed and the brainstorm/stage guards still fire (precedence)", () => {
		const dir = freshDir();
		initRepo(dir, "main");
		writePlan(dir, dir, "main");
		const fire = toolHandler();
		assert.equal(fire({ toolName: "edit" }, { cwd: dir }), undefined);
		// Guard #1 must NOT be masked by the session gate: an open brainstorm
		// still blocks writes outside the run folder.
		const state = createRun("gate mission", dir);
		saveState({ ...state, currentStage: "brainstorming" }, dir);
		const blocked = fire({ toolName: "edit" }, { cwd: dir });
		assert.ok(blocked?.block, "the brainstorm guard must still fire after a passing session gate");
	});

	test("conflict: run binding wt-A vs plan declaring wt-B → blocked naming both", () => {
		const dir = freshDir();
		initRepo(dir, "main");
		seedRunBinding(dir, "/wt-a", "main");
		writePlan(dir, "/wt-b", "main");
		const fire = toolHandler();
		const hit = fire({ toolName: "write" }, { cwd: dir });
		assert.ok(hit?.block);
		assert.ok(hit!.reason.includes("run binding"));
		assert.ok(hit!.reason.includes("plan directive"));
		assert.ok(hit!.reason.includes("/wt-a"));
		assert.ok(hit!.reason.includes("/wt-b"));
		assert.ok(hit!.reason.includes("ask the user"));
	});

	test("close-out: closed run binding + matching plan → allowed", () => {
		const dir = freshDir();
		initRepo(dir, "main");
		seedRunBinding(dir, "/old-worktree", "main", "closed");
		// Move the run OUT of "brainstorming" (so guard #1/D4 is not the one
		// under test) and align the state worktree stamp with the real folder
		// (so guard #6/N6 is not either). The point: a CLOSED binding must not
		// bind the session gate — only the matching plan directive does.
		const state = loadState(dir);
		saveState({ ...state, currentStage: "brainstormed", runWorktree: dir }, dir);
		writePlan(dir, dir, "main");
		const fire = toolHandler();
		assert.equal(fire({ toolName: "edit" }, { cwd: dir }), undefined);
	});

	test("cold cache: tool_call before any agent start still computes lazily and blocks", () => {
		const dir = freshDir();
		initRepo(dir, "main");
		writePlan(dir, "/not-this-one", "main");
		const hit = toolHandler()({ toolName: "edit" }, { cwd: dir });
		assert.ok(hit?.block);
		assert.ok(hit!.reason.includes("This work belongs in worktree /not-this-one"));
	});

	test("non-git folder → all tools allowed (fail-open R4)", () => {
		const dir = freshDir();
		writePlan(dir, "/elsewhere", "b");
		const fire = toolHandler();
		assert.equal(fire({ toolName: "edit" }, { cwd: dir }), undefined);
		assert.equal(fire({ toolName: "write" }, { cwd: dir }), undefined);
	});
});
