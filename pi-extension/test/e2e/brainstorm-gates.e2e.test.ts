/**
 * E2E integration tests for the brainstorm lifecycle v2 gates, running
 * inside a real `pi --mode rpc` process.
 *
 * Brainstorm has the most hard-locks of any stage (understanding lock,
 * decision ledger, notes content gate, read-only project mutation lock,
 * gated approve + auto-chain into PRD). These tests drive the BUILT
 * modules through the RPC `bash` channel with real state files in the
 * synthetic temp project. Only the Pi-facing surfaces (ctx.ui.notify /
 * ctx.ui.setStatus / pi.sendUserMessage / pi.appendEntry) are mocked, as
 * capture fakes.
 *
 * Covered here:
 *   1. Mutation lock: edit/write blocked outside the run's brainstorm
 *      folder while a brainstorm is open; lifted after approve
 *   2. Approve hard-block: understanding not confirmed
 *   3. Approve hard-block: a question still open (discussing)
 *   4. Approve hard-block: notes contain a `_TBD_` section
 *   5. Happy path: publish + audit log + session fields cleared + stage
 *      advanced + auto-chain into PRD (exactly one prompt hand-off)
 *
 * Tier 1 only. No LLM key required.
 *
 * NOTE for future authors: the embedded scripts run through bash, so they
 * must not contain backticks or ${...} (bash would expand them inside the
 * double-quoted -e argument). Use string concatenation only.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

import { RpcClient } from "./helpers/rpc-client.js";
import {
	makeTestHome,
	distModuleUrl,
	shouldRunE2E,
	type TestHome,
} from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedVelpariConfig } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

/** Run `script` (ESM source, top-level await allowed) in the temp
 *  project via the RPC bash channel; returns the parsed JSON payload the
 *  script printed to stdout. */
async function runModuleScript<T>(client: RpcClient, script: string): Promise<T> {
	const result = await client.request<any>("bash", {
		command: ["node --input-type=module -e", JSON.stringify(script)].join(" "),
	});
	assert.ok(
		result.success === true,
		`subprocess failed: ${JSON.stringify(result.error ?? result)}`,
	);
	const output: string = result.data?.output ?? result.output ?? "";
	assert.ok(output.length > 0, "subprocess produced no output");
	return JSON.parse(output) as T;
}

const STATE_JS = JSON.stringify(distModuleUrl("core/state.js"));
const GUARD_JS = JSON.stringify(distModuleUrl("stages/brainstorm/guard.js"));
const APPROVE_JS = JSON.stringify(distModuleUrl("stages/brainstorm-approve.js"));

/** Shared script fragment: mock ctx/pi that capture every call. */
const MOCKS =
	"const notes = []; const sent = []; const statuses = []; " +
	"const ctx = { ui: { notify: (m, l) => notes.push({ m, l }), setStatus: (k, v) => statuses.push({ k, v }) } }; " +
	"const pi = { sendUserMessage: (m) => sent.push(m), appendEntry: () => {}, getFlag: () => undefined }; ";

/** Complete notes (all 7 required sections filled, no _TBD_). */
const NOTES_EXPR =
	'["# Brainstorm Notes","",' +
	'"## Mission","Build the thing.","",' +
	'"## Interview Answers","Answered inline.","",' +
	'"## Scout Proposals","No scouts dispatched.","",' +
	'"## Decision Summary","One question, agreed.","",' +
	'"## Agreed","- Build the thing.","",' +
	'"## Not wanted","- Nothing rejected.","",' +
	'"## Open","- None."].join("\\n")';

/** Same notes but the Decision Summary section is left as _TBD_. */
const TBD_NOTES_EXPR = NOTES_EXPR.replace('"One question, agreed."', '"_TBD_"');

describe("e2e/brainstorm-gates", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedVelpariConfig(home, { projectName: "E2EFixture" });
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("mutation lock: edit/write blocked outside the brainstorm folder while open, lifted after approve", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			"import { clearRun, createRun, advanceStage } from " + STATE_JS + "; " +
				"import { guardBrainstormMutation } from " + GUARD_JS + "; " +
				"const cwd = process.cwd(); " +
				"clearRun(cwd); " +
				"const s = createRun('E2E brainstorm lock', cwd); " +
				"const inside = '.IDE_Plans/velpari/runs/' + s.runId + '/brainstorm/brainstorm-notes.md'; " +
				"const blockedOutside = guardBrainstormMutation('edit', { path: 'src/index.js' }, s, cwd); " +
				"const allowedInside = guardBrainstormMutation('write', { path: inside }, s, cwd); " +
				"const bashNotGated = guardBrainstormMutation('bash', { command: 'ls' }, s, cwd); " +
				"const afterApprove = advanceStage(s, '/velpari-approve-brainstorm', cwd); " +
				"const liftedOnceApproved = guardBrainstormMutation('edit', { path: 'src/index.js' }, afterApprove, cwd); " +
				"process.stdout.write(JSON.stringify({" +
				"  blockedOutside: blockedOutside?.block === true," +
				"  blockReason: blockedOutside?.reason ?? ''," +
				"  allowedInside: allowedInside === undefined," +
				"  bashNotGated: bashNotGated === undefined," +
				"  liftedOnceApproved: liftedOnceApproved === undefined," +
				"}));",
		);

		assert.ok(out.blockedOutside, "edit outside the brainstorm folder was NOT blocked while a brainstorm is open");
		assert.ok(out.blockReason.includes("read-only"), "block reason should explain the read-only lock");
		assert.ok(out.allowedInside, "write inside the run's brainstorm folder must be allowed");
		assert.ok(out.bashNotGated, "bash is intentionally not gated");
		assert.ok(out.liftedOnceApproved, "mutation lock must lift once the stage advances past brainstorming");
	});

	it("approve hard-blocks when understanding is not confirmed", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			'import { existsSync, mkdirSync, writeFileSync } from "node:fs"; ' +
				"import { clearRun, createRun, loadState } from " + STATE_JS + "; " +
				"import { handleApproveBrainstorm } from " + APPROVE_JS + "; " +
				"const cwd = process.cwd(); " +
				"clearRun(cwd); " +
				"const s = createRun('E2E approve lock', cwd); " +
				"const bDir = cwd + '/.IDE_Plans/velpari/runs/' + s.runId + '/brainstorm'; " +
				"mkdirSync(bDir, { recursive: true }); " +
				"writeFileSync(bDir + '/brainstorm-notes.md', " + NOTES_EXPR + ", 'utf8'); " +
				MOCKS +
				"await handleApproveBrainstorm(ctx, pi, cwd); " +
				"process.stdout.write(JSON.stringify({" +
				"  notes, sentCount: sent.length," +
				"  published: existsSync(cwd + '/Doc/brainstorm/brainstorm-e2e-approve-lock.md')," +
				"  stage: loadState(cwd).currentStage," +
				"}));",
		);

		assert.strictEqual(out.sentCount, 0, "PRD chain must not fire when approve is blocked");
		assert.strictEqual(out.published, false, "nothing may be published when understanding is unconfirmed");
		assert.strictEqual(out.stage, "brainstorming", "stage must not advance on a blocked approve");
		const errors = out.notes.filter((n: { l: string }) => n.l === "error");
		assert.strictEqual(errors.length, 1, `expected exactly one error notify, got: ${JSON.stringify(out.notes)}`);
		assert.ok(errors[0].m.includes("Understanding is not confirmed"), `wrong block reason: ${errors[0].m}`);
	});

	it("approve hard-blocks while a question is still open (discussing)", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			'import { existsSync, mkdirSync, writeFileSync } from "node:fs"; ' +
				"import { clearRun, createRun, confirmUnderstanding, upsertBrainstormQuestion, loadState } from " + STATE_JS + "; " +
				"import { handleApproveBrainstorm } from " + APPROVE_JS + "; " +
				"const cwd = process.cwd(); " +
				"clearRun(cwd); " +
				"let s = createRun('E2E open question', cwd); " +
				"s = confirmUnderstanding(s, cwd); " +
				"s = upsertBrainstormQuestion(s, { id: 'q1', text: 'Sync or local-only?', state: 'discussing' }, cwd); " +
				"const bDir = cwd + '/.IDE_Plans/velpari/runs/' + s.runId + '/brainstorm'; " +
				"mkdirSync(bDir, { recursive: true }); " +
				"writeFileSync(bDir + '/brainstorm-notes.md', " + NOTES_EXPR + ", 'utf8'); " +
				MOCKS +
				"await handleApproveBrainstorm(ctx, pi, cwd); " +
				"process.stdout.write(JSON.stringify({" +
				"  notes, sentCount: sent.length," +
				"  published: existsSync(cwd + '/Doc/brainstorm/brainstorm-e2e-open-question.md')," +
				"  stage: loadState(cwd).currentStage," +
				"}));",
		);

		assert.strictEqual(out.sentCount, 0, "PRD chain must not fire when approve is blocked");
		assert.strictEqual(out.published, false, "nothing may be published while a question is open");
		assert.strictEqual(out.stage, "brainstorming", "stage must not advance on a blocked approve");
		const errors = out.notes.filter((n: { l: string }) => n.l === "error");
		assert.strictEqual(errors.length, 1, `expected exactly one error notify, got: ${JSON.stringify(out.notes)}`);
		assert.ok(errors[0].m.includes("still open"), `wrong block reason: ${errors[0].m}`);
		assert.ok(errors[0].m.includes("q1"), "block reason should name the open question id");
	});

	it("approve hard-blocks when a notes section is still _TBD_", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			'import { existsSync, mkdirSync, writeFileSync } from "node:fs"; ' +
				"import { clearRun, createRun, confirmUnderstanding, loadState } from " + STATE_JS + "; " +
				"import { handleApproveBrainstorm } from " + APPROVE_JS + "; " +
				"const cwd = process.cwd(); " +
				"clearRun(cwd); " +
				"let s = createRun('E2E tbd notes', cwd); " +
				"s = confirmUnderstanding(s, cwd); " +
				"const bDir = cwd + '/.IDE_Plans/velpari/runs/' + s.runId + '/brainstorm'; " +
				"mkdirSync(bDir, { recursive: true }); " +
				"writeFileSync(bDir + '/brainstorm-notes.md', " + TBD_NOTES_EXPR + ", 'utf8'); " +
				MOCKS +
				"await handleApproveBrainstorm(ctx, pi, cwd); " +
				"process.stdout.write(JSON.stringify({" +
				"  notes, sentCount: sent.length," +
				"  published: existsSync(cwd + '/Doc/brainstorm/brainstorm-e2e-tbd-notes.md')," +
				"  stage: loadState(cwd).currentStage," +
				"}));",
		);

		assert.strictEqual(out.sentCount, 0, "PRD chain must not fire when approve is blocked");
		assert.strictEqual(out.published, false, "nothing may be published with _TBD_ sections");
		assert.strictEqual(out.stage, "brainstorming", "stage must not advance on a blocked approve");
		const errors = out.notes.filter((n: { l: string }) => n.l === "error");
		assert.strictEqual(errors.length, 1, `expected exactly one error notify, got: ${JSON.stringify(out.notes)}`);
		assert.ok(errors[0].m.includes("not ready to approve"), `wrong block reason: ${errors[0].m}`);
		assert.ok(errors[0].m.includes("Decision Summary"), "block reason should name the unfilled section");
	});

	it("happy path: approve publishes, writes audit log, clears session, advances, chains into PRD", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			'import { existsSync, mkdirSync, writeFileSync } from "node:fs"; ' +
				"import { clearRun, createRun, confirmUnderstanding, loadState } from " + STATE_JS + "; " +
				"import { handleApproveBrainstorm } from " + APPROVE_JS + "; " +
				"const cwd = process.cwd(); " +
				"clearRun(cwd); " +
				"let s = createRun('E2E approve happy', cwd); " +
				"s = confirmUnderstanding(s, cwd); " +
				"const bDir = cwd + '/.IDE_Plans/velpari/runs/' + s.runId + '/brainstorm'; " +
				"mkdirSync(bDir, { recursive: true }); " +
				"writeFileSync(bDir + '/brainstorm-notes.md', " + NOTES_EXPR + ", 'utf8'); " +
				MOCKS +
				"await handleApproveBrainstorm(ctx, pi, cwd); " +
				"const after = loadState(cwd); " +
				"process.stdout.write(JSON.stringify({" +
				"  notes, sentCount: sent.length, statuses," +
				"  published: existsSync(cwd + '/Doc/brainstorm/brainstorm-e2e-approve-happy.md')," +
				"  auditLog: existsSync(bDir + '/brainstorm-dispatch.md')," +
				"  stage: after.currentStage," +
				"  understandingCleared: after.understandingConfirmed === undefined," +
				"  questionsCleared: after.brainstormQuestions === undefined," +
				"  promptHasMission: sent.length === 1 && sent[0].includes('E2E approve happy')," +
				"}));",
		);

		assert.ok(out.published, "approved notes were not published to Doc/brainstorm/");
		assert.ok(out.auditLog, "brainstorm-dispatch.md audit log was not written");
		assert.notStrictEqual(out.stage, "brainstorming", "stage must advance past brainstorming after approve");
		assert.ok(out.understandingCleared, "understandingConfirmed session field was not cleared");
		assert.ok(out.questionsCleared, "brainstormQuestions session field was not cleared");
		assert.strictEqual(out.sentCount, 1, `approve must auto-chain into PRD with exactly one prompt, notes: ${JSON.stringify(out.notes)}`);
		assert.ok(out.promptHasMission, "chained PRD prompt does not carry the mission text");
		const errors = out.notes.filter((n: { l: string }) => n.l === "error");
		assert.deepStrictEqual(errors, [], `happy-path approve produced error notifies: ${JSON.stringify(errors)}`);
		assert.ok(
			out.statuses.some((s: { k: string }) => s.k === "velpari"),
			"footer status was not updated after approve",
		);
	});
});
