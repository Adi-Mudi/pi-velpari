/**
 * binding-match doctor check tests (Phase C, plan Subphase 3.4 — G6).
 *
 * Decision matrix over real fixtures: not-git / no declarations / match /
 * mismatch / conflict / state.runWorktree-only. Each case builds a temp
 * git repo + (optionally) a run-binding.json and/or a plan directive with
 * a `Worktree:` header and `Status: PENDING` — the exact Phase A shapes.
 *
 * The session verdict is cached per cwd (G2) — `resetSessionGateCache()`
 * runs in beforeEach so every check re-probes its own fixture.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkBindingMatchSection } from "../../../src/doctor/checks/binding-match.js";
import { resetSessionGateCache } from "../../../src/core/plan-binding.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-binding-"));
	resetSessionGateCache();
});

afterEach(() => {
	resetSessionGateCache();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a minimal run state (runId + currentStage drive the gate). */
function writeState(runId: string, currentStage = "designing"): void {
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "state.json"),
		JSON.stringify({
			version: 1,
			runId,
			mission: "binding mission",
			currentStage,
			history: [],
			updatedAt: new Date().toISOString(),
		}),
		"utf8",
	);
}

/** Write the live run binding at the per-run path. */
function writeBinding(runId: string, worktree: string, branch = ""): void {
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "run-binding.json"),
		JSON.stringify({
			runId,
			branch,
			worktree,
			startedAt: new Date().toISOString(),
			status: "active",
		}),
		"utf8",
	);
}

/** Write an active plan directive (naming convention + PENDING item). */
function writePlan(worktree: string, branch = ""): void {
	const dir = path.join(tmpDir, ".IDE_Plans");
	fs.mkdirSync(dir, { recursive: true });
	const header = [`# Binding plan`, ``, `Worktree: ${worktree}`];
	if (branch !== "") header.push(`Branch: ${branch}`);
	header.push(``, `## Phase 1`, `- **Status:** PENDING`, ``);
	fs.writeFileSync(path.join(dir, "bind_plan_20260928_1234_v1.0.md"), header.join("\n"), "utf8");
}

/** git init (no commit needed — the gate compares worktree paths). */
function gitInit(): void {
	const r = spawnSync("git", ["init", "-q"], { cwd: tmpDir, encoding: "utf8" });
	if (r.error) throw r.error;
	if (r.status !== 0) throw new Error(`git init failed: ${r.stderr ?? ""}`);
}

describe("checkBindingMatchSection", () => {
	it("not a git folder → info (R4 fail-open)", () => {
		writeState("run-1");
		const section = checkBindingMatchSection(tmpDir);
		assert.equal(section.title, "Worktree binding (N17)");
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /not a git folder/);
	});

	it("git repo, no declarations → info no declared binding", () => {
		gitInit();
		writeState("run-1");
		const section = checkBindingMatchSection(tmpDir);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /no declared binding/);
	});

	it("matching run-binding → ok + gate status line", () => {
		gitInit();
		writeState("run-1");
		writeBinding("run-1", fs.realpathSync(tmpDir));
		const section = checkBindingMatchSection(tmpDir);
		const ok = section.items.find((i) => i.status === "ok");
		assert.ok(ok, `expected an ok item, got ${JSON.stringify(section.items)}`);
		assert.match(ok!.message, /matches this session/);
		// Detail rows: actual + declared source.
		assert.ok(section.items.some((i) => i.message.startsWith("actual: ")));
		assert.ok(section.items.some((i) => i.message.startsWith("run-binding: ")));
	});

	it("mismatched run-binding → error binding-mismatch with N18 reason + details", () => {
		gitInit();
		writeState("run-1");
		writeBinding("run-1", "/somewhere/else/worktree");
		const section = checkBindingMatchSection(tmpDir);
		const err = section.items.find((i) => i.status === "error");
		assert.ok(err, `expected an error, got ${JSON.stringify(section.items)}`);
		assert.match(err!.message, /binding-mismatch/);
		assert.ok(err!.details?.some((d) => d.startsWith("actual:")));
		assert.ok(err!.details?.some((d) => d.startsWith("declared: run-binding")));
		assert.match(err!.suggestion ?? "", /another worktree|Restart the session/);
	});

	it("two declarations, different worktrees → error binding-conflict", () => {
		gitInit();
		writeState("run-1");
		writeBinding("run-1", "/somewhere/else/worktree");
		writePlan(fs.realpathSync(tmpDir));
		const section = checkBindingMatchSection(tmpDir);
		const err = section.items.find((i) => i.status === "error");
		assert.ok(err, `expected an error, got ${JSON.stringify(section.items)}`);
		assert.match(err!.message, /binding-conflict/);
		assert.ok(err!.details?.some((d) => d.startsWith("run-binding:")));
		assert.ok(err!.details?.some((d) => d.startsWith("plan:")));
		assert.match(err!.suggestion ?? "", /ask the user|Restart the session/);
	});

	it("plan directive matching this folder → ok", () => {
		gitInit();
		writeState("run-1");
		writePlan(fs.realpathSync(tmpDir));
		const section = checkBindingMatchSection(tmpDir);
		const ok = section.items.find((i) => i.status === "ok");
		assert.ok(ok, `expected an ok item, got ${JSON.stringify(section.items)}`);
		assert.match(ok!.message, /matches this session/);
	});

	it("only state.runWorktree declares → info explaining the unverifiable source", () => {
		gitInit();
		writeState("run-1");
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "state.json"),
			JSON.stringify({
				version: 1,
				runId: "run-1",
				mission: "binding mission",
				currentStage: "designing",
				runWorktree: "/declared/only/in/state",
				history: [],
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		const section = checkBindingMatchSection(tmpDir);
		const info = section.items.find((i) => i.message.includes("state.runWorktree"));
		assert.ok(info, `expected the state.runWorktree info line, got ${JSON.stringify(section.items)}`);
		assert.equal(info!.status, "info");
	});

	it("never throws (doctor always renders)", () => {
		// state.json is a DIRECTORY → loadState throws inside → caught.
		gitInit();
		fs.mkdirSync(path.join(tmpDir, ".pi", "velpari", "state.json"), { recursive: true });
		const section = checkBindingMatchSection(tmpDir);
		assert.ok(section.items.length > 0);
	});
});
