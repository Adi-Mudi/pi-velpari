/**
 * Phase 6.2 — integration (C+A): the session-gate hard stop at the
 * stage-start boundary.
 *
 * `runStagePreflight` must return `{continue: false}` for a plan/binding
 * MISMATCH or CONFLICT — and the scripted UI asserts `select`/`confirm`
 * were NEVER called (no fix flow is ever offered on rows 1–2, the
 * C+A rule). The matching fixture continues into `runStage`.
 *
 * Session verdicts are cached (`core/plan-binding.ts`) — every case
 * resets the cache first.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStagePreflight, type PreflightCtx, type PreflightPi } from "../../src/doctor/preflight.js";
import { resetSessionGateCache } from "../../src/core/plan-binding.js";

let tmpDir = "";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-session-gate-"));
	resetSessionGateCache();
});

afterEach(() => {
	resetSessionGateCache();
	rmSync(tmpDir, { recursive: true, force: true });
});

/** Recorded calls of one scripted UI session. */
interface UiLog {
	/** Every notify message, in order. */
	notifies: string[];
	/** Count of `select` invocations (must stay 0 on hard stops). */
	selects: number;
	/** Count of `confirm` invocations (must stay 0 on hard stops). */
	confirms: number;
	/** The UI context handed to `runStagePreflight`. */
	ctx: PreflightCtx;
}

/**
 * Build a scripted UI that records every primitive call.
 * @returns {UiLog} The recorder + a ctx whose select/confirm never resolve choices.
 */
function scriptedUi(): UiLog {
	const log: UiLog = {
		notifies: [],
		selects: 0,
		confirms: 0,
		ctx: {
			ui: {
				notify: (message: string) => {
					log.notifies.push(message);
				},
				select: async () => {
					log.selects += 1;
					return "Abort";
				},
				confirm: async () => {
					log.confirms += 1;
					return false;
				},
			},
		},
	};
	return log;
}

/** Flag-less Pi surface (no `--velpari-skip-doctor`). */
const pi: PreflightPi = {};

/**
 * Write the minimal run state.
 * @param {string} runId - Run id to stamp.
 * @returns {void} Nothing.
 */
function writeState(runId: string): void {
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "state.json"),
		JSON.stringify({
			version: 1,
			runId,
			mission: "session gate mission",
			currentStage: "designing",
			history: [],
			updatedAt: new Date().toISOString(),
		}),
		"utf8",
	);
}

/**
 * Seed a run-binding.json pointing at a DIFFERENT worktree.
 * @param {string} runId - Run id the binding belongs to.
 * @returns {void} Nothing.
 */
function writeForeignBinding(runId: string): void {
	const dir = join(tmpDir, ".IDE_Plans", "velpari", "runs", runId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "run-binding.json"),
		JSON.stringify({ runId, branch: "", worktree: "/somewhere/else", startedAt: "x", status: "active" }),
		"utf8",
	);
}

/**
 * Seed a plan directive whose `Worktree:` header points at `worktree`.
 * @param {string} worktree - Absolute worktree path written into the header.
 * @returns {void} Nothing.
 */
function writePlan(worktree: string): void {
	mkdirSync(join(tmpDir, ".IDE_Plans"), { recursive: true });
	writeFileSync(
		join(tmpDir, ".IDE_Plans", "bind_plan_20260928_1234_v1.0.md"),
		`# Plan\n\nWorktree: ${worktree}\n\n## Phase 1\n- **Status:** PENDING\n`,
		"utf8",
	);
}

describe("integration — runStagePreflight session gate (C+A)", () => {
	it("mismatch (binding → foreign worktree) hard-stops with NO fix offered", async () => {
		writeState("run-1");
		writeForeignBinding("run-1");
		assert.equal(spawnSync("git", ["init", "-q"], { cwd: tmpDir }).status, 0);

		const log = scriptedUi();
		const result = await runStagePreflight("prd", log.ctx, pi, tmpDir);
		assert.equal(result.continue, false, "mismatch must stop the stage start");
		assert.ok(log.notifies.length >= 1, "the hard stop must be reported");
		assert.match(log.notifies.join("\n"), /worktree|belongs/i);
		assert.equal(log.selects, 0, "NO picker may be offered on a hard stop");
		assert.equal(log.confirms, 0, "NO confirm may be asked on a hard stop");
	});

	it("conflict (binding vs plan disagree) hard-stops with NO fix offered", async () => {
		writeState("run-1");
		writeForeignBinding("run-1");
		writePlan(tmpDir); // plan says THIS worktree, binding says elsewhere → conflict
		assert.equal(spawnSync("git", ["init", "-q"], { cwd: tmpDir }).status, 0);

		const log = scriptedUi();
		const result = await runStagePreflight("prd", log.ctx, pi, tmpDir);
		assert.equal(result.continue, false, "conflict must stop the stage start");
		assert.match(log.notifies.join("\n"), /disagree|ask the user/i);
		assert.equal(log.selects, 0, "NO picker may be offered on a conflict");
		assert.equal(log.confirms, 0, "NO confirm may be asked on a conflict");
	});

	it("match (binding → this worktree) continues into the stage", async () => {
		writeState("run-1");
		const dir = join(tmpDir, ".IDE_Plans", "velpari", "runs", "run-1");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "run-binding.json"),
			JSON.stringify({ runId: "run-1", branch: "", worktree: tmpDir, startedAt: "x", status: "active" }),
			"utf8",
		);
		assert.equal(spawnSync("git", ["init", "-q"], { cwd: tmpDir }).status, 0);

		const log = scriptedUi();
		const result = await runStagePreflight("prd", log.ctx, pi, tmpDir);
		assert.equal(result.continue, true, "a matching binding must proceed");
		assert.equal(log.notifies.filter((m) => /worktree|disagree/i.test(m)).length, 0, "no hard-stop message");
	});
});
