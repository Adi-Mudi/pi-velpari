/**
 * preflight decision-table tests (Phase C, plan Subphase 4.5 — G1).
 *
 * Rows 1–10 of the plan's decision table are the unit-test oracle:
 * session-gate hard stops (no fix), skip-doctor flag, files.json
 * unreadable/invalid-shape, state unreadable, bookkeeping drift,
 * scaffold info, clean pass, non-interactive degrade. Plus timing
 * (`durationMs > 0`) and the heavy-check exclusion (no static import of
 * `doctor/index.ts`, `io/db`, or the hash chain — the ms budget).
 *
 * Fixtures are temp dirs (git repos where the row needs one).
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { runCommandPreflight, runPreflight, runStagePreflight } from "../../src/doctor/preflight.js";
import { ensureStandardScaffold } from "../../src/ops/self-heal.js";
import { resetSessionGateCache } from "../../src/core/plan-binding.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(path.join(os.tmpdir(), "velpari-preflight-"));
	resetSessionGateCache();
});

afterEach(() => {
	resetSessionGateCache();
	rmSync(tmpDir, { recursive: true, force: true });
});

/** Write the minimal run state. */
function writeState(runId: string, currentStage: string): void {
	mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "state.json"),
		JSON.stringify({ version: 1, runId, mission: "m", currentStage, history: [], updatedAt: new Date().toISOString() }),
		"utf8",
	);
}

/** Write a valid files.json (v4 + projectName). */
function writeConfig(): void {
	mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "PreApp" }),
		"utf8",
	);
}

/** git init + commit files.json (tracked fixture for row 4). */
function gitInitCommit(): void {
	/**
	 * Run one git command in the fixture repo, throwing on error.
	 * @param {...string} args - Arguments after `git` (e.g. `init`, `-q`).
	 * @returns {void} Nothing; throws when the command fails.
	 */
	const run = (...args: string[]): void => {
		const r = spawnSync("git", args, { cwd: tmpDir, encoding: "utf8" });
		if (r.error) throw r.error;
		if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
	};
	run("init", "-q");
	run("add", ".pi/velpari/files.json");
	run("-c", "user.email=t@t.local", "-c", "user.name=T", "commit", "-q", "-m", "init");
}

describe("runPreflight — decision table", () => {
	it("row 1: session-gate mismatch → hardStop, NO findings (no fix offered)", () => {
		writeState("run-1", "designing");
		mkdirSync(path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "run-1"), { recursive: true });
		writeFileSync(
			path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "run-1", "run-binding.json"),
			JSON.stringify({ runId: "run-1", branch: "", worktree: "/somewhere/else", startedAt: "x", status: "active" }),
			"utf8",
		);
		const r0 = spawnSync("git", ["init", "-q"], { cwd: tmpDir, encoding: "utf8" });
		assert.equal(r0.status, 0);
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		assert.equal(result.ok, false);
		assert.ok(result.hardStop !== null);
		assert.match(result.hardStop!, /belongs in worktree|No changes were made/);
		assert.deepEqual(result.findings, [], "hard stop offers NO fix");
	});

	it("row 2: session-gate conflict → hardStop, NO findings", () => {
		writeState("run-1", "designing");
		mkdirSync(path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "run-1"), { recursive: true });
		writeFileSync(
			path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "run-1", "run-binding.json"),
			JSON.stringify({ runId: "run-1", branch: "", worktree: "/somewhere/else", startedAt: "x", status: "active" }),
			"utf8",
		);
		const dir = path.join(tmpDir, ".IDE_Plans");
		writeFileSync(
			path.join(dir, "bind_plan_20260928_1234_v1.0.md"),
			`# Plan\n\nWorktree: ${tmpDir}\n\n## Phase 1\n- **Status:** PENDING\n`,
			"utf8",
		);
		const r0 = spawnSync("git", ["init", "-q"], { cwd: tmpDir, encoding: "utf8" });
		assert.equal(r0.status, 0);
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		assert.equal(result.ok, false);
		assert.ok(result.hardStop !== null);
		assert.match(result.hardStop!, /disagree|ask the user/i);
		assert.deepEqual(result.findings, []);
	});

	it("row 3: --velpari-skip-doctor → session gate only, pass (corrupt state ignored)", () => {
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(tmpDir, ".pi", "velpari", "state.json"), "{not json", "utf8");
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start", skipDoctor: true });
		assert.equal(result.ok, true);
		assert.equal(result.hardStop, null);
		assert.deepEqual(result.findings, []);
	});

	it("row 4: files.json corrupt + git-tracked → blocking auto config-restore-git", () => {
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(tmpDir, ".pi", "velpari", "files.json"), "{broken", "utf8");
		gitInitCommit();
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		const row4 = result.findings.find((f) => f.fingerprint === "config-restore-git");
		assert.ok(row4, `expected row 4, got ${JSON.stringify(result.findings.map((f) => f.fingerprint))}`);
		assert.equal(row4!.blocking, true);
		assert.equal(row4!.autoFixable, true);
		assert.match(row4!.item.message, /config-unreadable/);
	});

	it("row 4b: files.json corrupt + UNtracked → manual config-unreadable (autoFixable false)", () => {
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(tmpDir, ".pi", "velpari", "files.json"), "{broken", "utf8");
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		const row4 = result.findings.find((f) => f.fingerprint === "config-unreadable");
		assert.ok(row4, `expected manual row 4, got ${JSON.stringify(result.findings.map((f) => f.fingerprint))}`);
		assert.equal(row4!.blocking, true);
		assert.equal(row4!.autoFixable, false);
	});

	it("row 5: files.json parses but no projectName → blocking manual config-invalid", () => {
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(tmpDir, ".pi", "velpari", "files.json"), JSON.stringify({ version: 4 }), "utf8");
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		const row5 = result.findings.find((f) => f.fingerprint === "config-invalid");
		assert.ok(row5, `expected row 5, got ${JSON.stringify(result.findings.map((f) => f.fingerprint))}`);
		assert.equal(row5!.blocking, true);
		assert.equal(row5!.autoFixable, false);
		assert.equal(result.ok, false);
	});

	it("row 6: state.json unreadable → blocking manual state-unreadable", () => {
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(tmpDir, ".pi", "velpari", "state.json"), "{not json", "utf8");
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		const row6 = result.findings.find((f) => f.fingerprint === "state-unreadable");
		assert.ok(row6, `expected row 6, got ${JSON.stringify(result.findings.map((f) => f.fingerprint))}`);
		assert.equal(row6!.blocking, true);
		assert.match(row6!.item.message, /state\.json/);
		// state unreadable → drift probe is skipped (no double-report).
		assert.equal(result.findings.some((f) => f.fingerprint === "bookkeeping-advance"), false);
	});

	it("row 7: bookkeeping drift (evidence) → blocking auto bookkeeping-advance", () => {
		writeState("run-1", "brainstorming");
		const notes = path.join(tmpDir, "Doc", "brainstorm");
		mkdirSync(notes, { recursive: true });
		writeFileSync(path.join(notes, "brainstorm-x.md"), "---\nartifact: brainstorm\nrun: run-1\n---\n\n# Notes\n", "utf8");
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		const row7 = result.findings.find((f) => f.fingerprint === "bookkeeping-advance");
		assert.ok(row7, `expected row 7, got ${JSON.stringify(result.findings.map((f) => f.fingerprint))}`);
		assert.equal(row7!.blocking, true);
		assert.equal(row7!.autoFixable, true);
		assert.match(row7!.item.message, /bookkeeping-drift:/);
		assert.equal(result.ok, false);
	});

	it("row 8: scaffold missing → NON-blocking info scaffold-missing", () => {
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		const row8 = result.findings.find((f) => f.fingerprint === "scaffold-missing");
		assert.ok(row8, `expected row 8, got ${JSON.stringify(result.findings.map((f) => f.fingerprint))}`);
		assert.equal(row8!.blocking, false);
		assert.equal(row8!.autoFixable, true);
		assert.equal(row8!.item.status, "info");
		assert.equal(result.ok, true, "scaffold info alone never blocks");
	});

	it("row 9: clean fixture → pass with ZERO findings + durationMs > 0", () => {
		ensureStandardScaffold(tmpDir);
		writeConfig();
		writeState("run-1", "drafted-prd");
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		assert.equal(result.ok, true);
		assert.equal(result.hardStop, null);
		assert.deepEqual(result.findings, []);
		assert.ok(result.durationMs > 0, `durationMs must be measured, got ${result.durationMs}`);
	});

	it("every result carries durationMs (hard-stop path too)", () => {
		const result = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		assert.ok(result.durationMs >= 0);
		assert.equal(typeof result.durationMs, "number");
	});
});

describe("runStagePreflight — non-interactive + interactive", () => {
	it("row 10: non-interactive + blocking → notify + continue:false (never hangs)", async () => {
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(tmpDir, ".pi", "velpari", "state.json"), "{not json", "utf8");
		const notifies: { m: string; k?: string }[] = [];
		const ctx = { ui: { notify: (m: string, k?: string) => notifies.push({ m, k }) } };
		const out = await runStagePreflight("prd", ctx, {}, tmpDir);
		assert.equal(out.continue, false);
		assert.ok(notifies.some((n) => n.m.includes("state-unreadable")));
	});

	it("hard stop (row 1) → notify error + continue:false, even interactive", async () => {
		writeState("run-1", "designing");
		mkdirSync(path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "run-1"), { recursive: true });
		writeFileSync(
			path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "run-1", "run-binding.json"),
			JSON.stringify({ runId: "run-1", branch: "", worktree: "/somewhere/else", startedAt: "x", status: "active" }),
			"utf8",
		);
		const r0 = spawnSync("git", ["init", "-q"], { cwd: tmpDir, encoding: "utf8" });
		assert.equal(r0.status, 0);
		const notifies: { m: string; k?: string }[] = [];
		let selectCalls = 0;
		const ctx = {
			ui: {
				notify: (m: string, k?: string) => notifies.push({ m, k }),
				select: async (): Promise<string> => {
					selectCalls++;
					return "Abort";
				},
				confirm: async (): Promise<boolean> => false,
			},
		};
		const out = await runStagePreflight("prd", ctx, {}, tmpDir);
		assert.equal(out.continue, false);
		assert.equal(selectCalls, 0, "no fix flow on a hard stop");
		assert.equal(notifies[0]?.k, "error");
	});

	it("interactive + blocking + user aborts → continue:false with the stop reason", async () => {
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(tmpDir, ".pi", "velpari", "state.json"), "{not json", "utf8");
		const notifies: { m: string; k?: string }[] = [];
		const ctx = {
			ui: {
				notify: (m: string, k?: string) => notifies.push({ m, k }),
				select: async (): Promise<string> => "Abort",
				confirm: async (): Promise<boolean> => false,
			},
		};
		const out = await runStagePreflight("prd", ctx, {}, tmpDir);
		assert.equal(out.continue, false);
		assert.ok(notifies.some((n) => n.m.includes("stopped by preflight")), JSON.stringify(notifies));
	});

	it("row 3 at stage level: skip-doctor flag → continue:true despite corrupt state", async () => {
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(tmpDir, ".pi", "velpari", "state.json"), "{not json", "utf8");
		const ctx = { ui: { notify: (): void => {} } };
		const pi = { getFlag: (name: string): unknown => name === "velpari-skip-doctor" };
		const out = await runStagePreflight("prd", ctx, pi, tmpDir);
		assert.equal(out.continue, true);
	});
});

describe("heavy-check exclusion (ms budget)", () => {
	it("compiled preflight.js statically imports no doctor orchestrator / store / hash-chain", () => {
		// Test lives at dist/pi-extension/test/doctor/ → ../../src/doctor/preflight.js
		const src = readFileSync(fileURLToPath(new URL("../../src/doctor/preflight.js", import.meta.url)), "utf8");
		const forbidden = [
			/from\s+"\.\/index\.js"/, // doctor orchestrator (runDoctor) — import cycle + heavy
			/from\s+"[^"]*io\/db\.js"/, // node:sqlite store access
			/from\s+"[^"]*hash-chain[^"]*"/, // O(rows) chain verification
			/from\s+"[^"]*stage-runner[^"]*"/, // scout machinery
		];
		for (const re of forbidden) {
			assert.ok(!re.test(src), `preflight must not statically import matches of ${re}`);
		}
	});
});

describe("runCommandPreflight — command-start (E#3)", () => {
	it("clean project → continue:true", async () => {
		ensureStandardScaffold(tmpDir);
		writeConfig();
		writeState("run-1", "drafted-prd");
		const ctx = { ui: { notify: (): void => {} } };
		const out = await runCommandPreflight("/velpari-handoff", ctx, {}, tmpDir);
		assert.equal(out.continue, true);
	});

	it("corrupt files.json (untracked) + non-interactive → continue:false + config-unreadable notify (row 10)", async () => {
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(tmpDir, ".pi", "velpari", "files.json"), "{broken", "utf8");
		const notifies: { m: string; k?: string }[] = [];
		const ctx = { ui: { notify: (m: string, k?: string) => notifies.push({ m, k }) } };
		const out = await runCommandPreflight("/velpari-handoff", ctx, {}, tmpDir);
		assert.equal(out.continue, false);
		assert.ok(notifies.some((n) => n.m.includes("config-unreadable")), JSON.stringify(notifies));
	});

	it("session-gate mismatch (row 1) → continue:false + hardStop notify as error", async () => {
		writeState("run-1", "designing");
		mkdirSync(path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "run-1"), { recursive: true });
		writeFileSync(
			path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "run-1", "run-binding.json"),
			JSON.stringify({ runId: "run-1", branch: "", worktree: "/somewhere/else", startedAt: "x", status: "active" }),
			"utf8",
		);
		const r0 = spawnSync("git", ["init", "-q"], { cwd: tmpDir, encoding: "utf8" });
		assert.equal(r0.status, 0);
		const notifies: { m: string; k?: string }[] = [];
		const ctx = { ui: { notify: (m: string, k?: string) => notifies.push({ m, k }) } };
		const out = await runCommandPreflight("/velpari-handoff", ctx, {}, tmpDir);
		assert.equal(out.continue, false);
		assert.equal(notifies[0]?.k, "error");
		assert.ok(notifies[0] && /worktree|No changes were made/.test(notifies[0].m), JSON.stringify(notifies));
	});

	it("row 3 at command level: skip-doctor flag → continue:true despite corrupt state", async () => {
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(tmpDir, ".pi", "velpari", "state.json"), "{not json", "utf8");
		const ctx = { ui: { notify: (): void => {} } };
		const pi = { getFlag: (name: string): unknown => name === "velpari-skip-doctor" };
		const out = await runCommandPreflight("/velpari-handoff", ctx, pi, tmpDir);
		assert.equal(out.continue, true);
	});
});
