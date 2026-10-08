/**
 * Worktree write guard tests (Phase 5, N5/N6) — hooks/tool-call.ts.
 *
 * Drives the registered tool_call handler (mock ExtensionAPI, same pattern as
 * test/hooks/tool-call.test.ts) on REAL git fixtures: an edit/write from a
 * folder that is not the run's bound worktree (state carried into a second
 * worktree) is blocked with the self-healing fix; a matching folder passes;
 * an unstamped run and a non-git folder fail open.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { guardWorktreeMutation, registerToolCallHook } from "../../src/hooks/tool-call.js";
import { loadState, saveState } from "../../src/core/state.js";

type ToolCallHandler = (
	event: { toolName: string; input?: Record<string, unknown> },
	ctx: { cwd: string },
) => { block: true; reason: string } | undefined;

const IDENT = ["-c", "user.email=velpari@test.local", "-c", "user.name=Velpari Test"];

let dirs: string[] = [];
let handlers: Record<string, ToolCallHandler[]>;

function makePi(): ExtensionAPI {
	handlers = {};
	const pi = {
		on: (event: string, handler: ToolCallHandler) => {
			(handlers[event] ??= []).push(handler);
		},
	};
	return pi as unknown as ExtensionAPI;
}

function fire(toolName: string, input: Record<string, unknown>, cwd: string) {
	for (const handler of handlers["tool_call"] ?? []) {
		const result = handler({ toolName, input }, { cwd });
		if (result) return result;
	}
	return undefined;
}

function freshDir(prefix = "velpari-wtguard-"): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function initRepo(dir: string, branch = "velpari/line-A"): void {
	execFileSync("git", ["init", "-b", branch], { cwd: dir });
	execFileSync("git", [...IDENT, "commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

beforeEach(() => {
	dirs = [];
	makePi();
});

afterEach(() => {
	for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("guardWorktreeMutation (Phase 5, N5/N6)", () => {
	it("registers on tool_call and blocks an edit outside the run's worktree", () => {
		registerToolCallHook(makePi());
		assert.ok((handlers["tool_call"] ?? []).length > 0, "hook registered");

		// Run bound to worktree A on branch A (mid-pipeline stage so the
		// brainstorm lock is not the one answering).
		const dirA = freshDir();
		initRepo(dirA, "velpari/line-A");
		saveState(
			{
				version: 1,
				runId: "run-guard",
				mission: "guard mission",
				currentStage: "built-rtm",
				updatedAt: "t0",
				runWorktree: dirA,
				runBranch: "velpari/line-A",
			},
			dirA,
		);

		// B: a real second worktree, seeded with the same `.pi/velpari` state
		// (the honest "state carried into another folder" model).
		const parent = freshDir();
		const dirB = path.join(parent, "line-b");
		execFileSync("git", ["worktree", "add", dirB, "-b", "velpari/line-B"], { cwd: dirA });
		fs.cpSync(path.join(dirA, ".pi"), path.join(dirB, ".pi"), { recursive: true });

		const blocked = fire("edit", { path: path.join(dirB, "src", "x.ts") }, dirB);
		assert.ok(blocked, "edit from the wrong worktree must be blocked");
		assert.match(blocked!.reason, /Worktree mismatch \(N6\)/);
		assert.match(blocked!.reason, /git worktree add \.\.\//);

		// The same folder that IS the bound worktree → allowed.
		assert.equal(fire("edit", { path: path.join(dirA, "src", "x.ts") }, dirA), undefined);
	});

	it("fails open for read tools, unstamped runs and non-git folders", () => {
		const plain = freshDir();
		assert.equal(guardWorktreeMutation("read", loadState(plain), plain), undefined);
		assert.equal(guardWorktreeMutation("edit", loadState(plain), plain), undefined, "no run → fail-open");

		saveState(
			{ version: 1, runId: "run-plain", mission: "m", currentStage: "built-rtm", updatedAt: "t0" },
			plain,
		);
		assert.equal(
			guardWorktreeMutation("edit", loadState(plain), plain),
			undefined,
			"no stamp → fail-open in a non-git folder",
		);

		const dir = freshDir();
		initRepo(dir);
		saveState(
			{
				version: 1,
				runId: "run-ok",
				mission: "m",
				currentStage: "built-rtm",
				updatedAt: "t0",
				runWorktree: dir,
				runBranch: "velpari/line-A",
			},
			dir,
		);
		assert.equal(guardWorktreeMutation("write", loadState(dir), dir), undefined, "matching pair → allowed");
	});

	it("never blocks when there is no active run", () => {
		const dir = freshDir();
		initRepo(dir);
		assert.equal(guardWorktreeMutation("edit", loadState(dir), dir), undefined);
	});
});
