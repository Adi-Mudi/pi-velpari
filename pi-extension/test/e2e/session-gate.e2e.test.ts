/**
 * E2E — session-start worktree gate (Phase A, N18/G3), Tier 1, no LLM key.
 *
 * Drives the REGISTERED tool_call hook through the RPC `bash` channel of a
 * real `pi --mode rpc` process against a git fixture with two linked
 * worktrees (A = repo root, B = `git worktree add` sibling):
 *
 *   1. Wrong worktree: session in A, A's plan directive declares B →
 *      edit/write blocked with the character-exact N18 message.
 *   2. Zero files changed: the blocked write's target keeps its content
 *      (the guard denies before any write happens).
 *   3. Correct worktree: session in B, B's plan declares B → allowed.
 *   4. Conflict: an active run binding (worktree B) plus a plan directive
 *      (worktree A) in the same folder → blocked, reason names both
 *      declarations and asks the user which line wins (G4).
 *
 * NOTE for future authors: embedded scripts run through bash — no backticks
 * and no ${...} anywhere (bash expands them inside the double-quoted -e
 * argument). String concatenation only.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, distModuleUrl, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

/**
 * Run `script` (ESM source, top-level await allowed) in the temp project
 * via the RPC bash channel; returns the parsed JSON payload it printed.
 * @param {RpcClient} client - The live RPC session.
 * @param {string} script - ESM source (no backticks, no ${...}).
 * @returns {Promise<any>} The parsed stdout JSON payload.
 */
async function runModuleScript<T>(client: RpcClient, script: string): Promise<T> {
	const result = await client.request<any>("bash", {
		command: ["node --input-type=module -e", JSON.stringify(script)].join(" "),
	});
	assert.ok(result.success === true, `subprocess failed: ${JSON.stringify(result.error ?? result)}`);
	const output: string = result.data?.output ?? result.output ?? "";
	assert.ok(output.length > 0, "subprocess produced no output");
	return JSON.parse(output) as T;
}

const STATE_JS = JSON.stringify(distModuleUrl("core/state.js"));
const RUN_BINDING_JS = JSON.stringify(distModuleUrl("core/run-binding.js"));
const TOOL_CALL_JS = JSON.stringify(distModuleUrl("hooks/tool-call.js"));

/** Shared fixture: repo A + linked worktree B + plans + a target file. */
const SETUP =
	"const cp = await import('node:child_process'); " +
	"const fs = await import('node:fs'); " +
	"const path = await import('node:path'); " +
	"const IDENT = ['-c','user.email=velpari@e2e.local','-c','user.name=Velpari E2E']; " +
	"const home = process.cwd(); " +
	"const A = path.join(home, 'wt-fixture'); " +
	"const B = path.join(home, 'wt-fixture-b'); " +
	"fs.rmSync(A, {recursive: true, force: true}); " +
	"fs.rmSync(B, {recursive: true, force: true}); " +
	"fs.mkdirSync(A, {recursive: true}); " +
	"cp.execFileSync('git', ['init','-q','-b','main'], {cwd: A, stdio: 'ignore'}); " +
	"cp.execFileSync('git', IDENT.concat(['commit','--allow-empty','-m','init']), {cwd: A, stdio: 'ignore'}); " +
	"cp.execFileSync('git', ['worktree','add',B,'-b','line-b'], {cwd: A, stdio: 'ignore'}); " +
	"const mkPlan = (dir, wt, branch) => { " +
	"  const p = path.join(dir, '.IDE_Plans'); " +
	"  fs.mkdirSync(p, {recursive: true}); " +
	"  const lines = ['**Worktree:** ' + wt, '**Branch:** ' + branch, '- **Status:** PENDING']; " +
	"  fs.writeFileSync(path.join(p, 'gate_plan_20260928_0000_v1.0.md'), lines.join('\\n')); " +
	"}; " +
	"const { registerToolCallHook } = await import(" +
	TOOL_CALL_JS +
	"); " +
	"const handlers = {}; " +
	"const pi = { on: (n, f) => { handlers[n] = f; } }; " +
	"registerToolCallHook(pi); " +
	"const fire = (tool, input, cwd) => handlers.tool_call({toolName: tool, input: input}, {cwd: cwd}); ";

/** Register gate handler + build fixture where A's plan declares B. */
const MISMATCH_SCRIPT =
	SETUP +
	"mkPlan(A, B, 'line-b'); " +
	"mkPlan(B, B, 'line-b'); " +
	"const target = path.join(A, 'target.js'); " +
	"fs.writeFileSync(target, 'ORIGINAL'); " +
	"const blocked = fire('write', {path: target}, A); " +
	"const after = fs.readFileSync(target, 'utf8'); " +
	"const passB = fire('edit', {path: path.join(B, 'x.js')}, B); " +
	"process.stdout.write(JSON.stringify({ " +
	"  A: A, B: B, " +
	"  blocked: blocked?.block === true, " +
	"  reason: blocked?.reason ?? '', " +
	"  unchanged: after === 'ORIGINAL', " +
	"  targetExists: fs.existsSync(target), " +
	"  passB: passB === undefined, " +
	"}));";

/** Active run binding (worktree B) + plan directive (worktree A) in folder A. */
const CONFLICT_SCRIPT =
	SETUP +
	"mkPlan(A, A, 'main'); " +
	"const { createRun, saveState } = await import(" +
	STATE_JS +
	"); " +
	"const { writeRunBinding } = await import(" +
	RUN_BINDING_JS +
	"); " +
	"const s = createRun('E2E session-gate conflict', A); " +
	"const bindDir = path.join(A, '.IDE_Plans', 'velpari', 'runs', s.runId); " +
	"fs.mkdirSync(bindDir, {recursive: true}); " +
	"writeRunBinding(A, {runId: s.runId, branch: 'line-b', worktree: B, " +
	"  startedAt: '2026-09-28T00:00:00.000Z', status: 'active'}); " +
	"saveState(Object.assign({}, s, {runWorktree: B, runBranch: 'line-b'}), A); " +
	"const hit = fire('edit', {path: path.join(A, 'src', 'index.js')}, A); " +
	"process.stdout.write(JSON.stringify({ " +
	"  A: A, B: B, " +
	"  blocked: hit?.block === true, " +
	"  reason: hit?.reason ?? '', " +
	"}));";

describe("e2e/session-gate", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("wrong worktree: hard stop with the exact N18 message, zero files changed; correct worktree passes", {
		timeout: 60_000,
	}, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client, "test setup missing");

		const out = await runModuleScript<any>(client, MISMATCH_SCRIPT);

		assert.ok(out.blocked, "edit/write from the wrong worktree must be blocked");
		assert.equal(
			out.reason,
			"This work belongs in worktree " + out.B + " on branch line-b. " +
				"You are in " + out.A + " on branch main. " +
				"Restart the session there. No changes were made.",
			"the block reason must be the character-exact N18 message",
		);
		assert.ok(out.unchanged && out.targetExists, "zero files changed — the guarded write must leave the target untouched");
		assert.ok(out.passB, "the session opened in the DECLARED worktree must be allowed");
	});

	it("conflict: run binding and plan directive disagree → blocked, reason names both", {
		timeout: 60_000,
	}, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client, "test setup missing");

		const out = await runModuleScript<any>(client, CONFLICT_SCRIPT);

		assert.ok(out.blocked, "two disagreeing declarations must block (G4)");
		assert.ok(out.reason.includes("run binding"), "reason must name the run-binding side");
		assert.ok(out.reason.includes("plan directive"), "reason must name the plan-directive side");
		assert.ok(out.reason.includes(out.B), "reason must quote the run binding's worktree");
		assert.ok(out.reason.includes(out.A), "reason must quote the plan directive's worktree");
		assert.ok(out.reason.includes("ask the user"), "conflict must ask the user which line wins");
	});
});
