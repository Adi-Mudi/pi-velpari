/**
 * E2E integration tests for Velpari's ops surface (status / reset /
 * show-* / handoff) and the doctor agent-mapping section, running inside
 * a real `pi --mode rpc` process via the `bash` channel.
 *
 * Only the Pi-facing surfaces are capture fakes (ctx.ui.notify /
 * ctx.ui.confirm / ctx.ui.setStatus / pi.appendEntry); state, config,
 * paths and file I/O are all the real built modules against the synthetic
 * temp project.
 *
 * Covered here:
 *   1. Doctor: agent-mapping section renders when agents.json exists
 *   2. Status: no-run notify; with-run appendEntry + footer setStatus
 *   3. Reset: cancelled keeps state.json; confirmed clears it
 *   4. show-prd: grouped miss falls back to the legacy flat path
 *   5. Handoff: wrong stage hard-blocks; planned-tests writes
 *      .pi/senai/architect-inputs.json that passes validateSenaiSchema
 *
 * Tier 1 only. No LLM key required.
 *
 * NOTE: embedded scripts run through bash — no backticks, no ${...}.
 * String concatenation only.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, distModuleUrl, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedVelpariConfig } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

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
const DOCTOR_JS = JSON.stringify(distModuleUrl("doctor/index.js"));
const AGENTS_JS = JSON.stringify(distModuleUrl("core/agents-config.js"));
const STATUS_JS = JSON.stringify(distModuleUrl("ops/status.js"));
const RESET_JS = JSON.stringify(distModuleUrl("ops/reset.js"));
const SHOW_JS = JSON.stringify(distModuleUrl("view/show.js"));
const HANDOFF_JS = JSON.stringify(distModuleUrl("ops/handoff.js"));

/** Mock ctx/pi capture fakes. `confirmAnswer` controls ctx.ui.confirm. */
const MOCKS =
	"const notes = []; const entries = []; const statuses = []; " +
	"const ctx = { ui: { " +
	"  notify: (m, l) => notes.push({ m, l }), " +
	"  setStatus: (k, v) => statuses.push({ k, v }), " +
	"  confirm: async () => globalThis.__confirmAnswer, " +
	"} }; " +
	"const pi = { appendEntry: (t, d) => entries.push({ t, d }), sendUserMessage: () => {}, getFlag: () => undefined }; ";

describe("e2e/ops-doctor", () => {
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

	it("doctor report renders the agent-mapping section when agents.json exists", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		// A project-local custom agent + a mapping that points at it.
		const agentsDir = join(home.cwd, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "test-scout.md"),
			"---\nname: test-scout\ndescription: E2E fixture scout\n---\n\n# test-scout\n",
			"utf8",
		);

		const out = await runModuleScript<any>(
			client,
			"import { saveAgentConfig } from " +
				AGENTS_JS +
				"; " +
				"import { runDoctor, formatDiagnosticReport } from " +
				DOCTOR_JS +
				"; " +
				"const cwd = process.cwd(); " +
				"saveAgentConfig(cwd, { version: 1, agents: { extractor: 'test-scout' } }); " +
				"const report = formatDiagnosticReport(runDoctor(cwd)); " +
				"process.stdout.write(JSON.stringify({ report }));",
		);

		assert.ok(
			out.report.includes("## Agent mapping (agents.json)"),
			"doctor report is missing the agent-mapping section",
		);
		assert.ok(out.report.includes("test-scout"), "agent-mapping section should mention the mapped custom agent");
	});

	it("status: no run notifies; with a run it appends a velpari-status entry and sets the footer", {
		timeout: 60_000,
	}, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			"import { clearRun, createRun } from " +
				STATE_JS +
				"; " +
				"import { handleStatus } from " +
				STATUS_JS +
				"; " +
				"const cwd = process.cwd(); " +
				"clearRun(cwd); " +
				MOCKS +
				"await handleStatus(ctx, pi, cwd); " +
				"const noRunNotes = notes.slice(); " +
				"notes.length = 0; " +
				"createRun('E2E status run', cwd); " +
				"await handleStatus(ctx, pi, cwd); " +
				"process.stdout.write(JSON.stringify({ noRunNotes, notes, entries, statuses }));",
		);

		assert.strictEqual(out.noRunNotes.length, 1, "no-run status should notify exactly once");
		assert.ok(
			out.noRunNotes[0].m.includes("No active Velpari run"),
			`unexpected no-run message: ${out.noRunNotes[0].m}`,
		);

		assert.strictEqual(out.entries.length, 1, "with-run status should append exactly one session entry");
		assert.strictEqual(out.entries[0].t, "velpari-status", "status entry must use the velpari-status custom type");
		assert.ok(
			out.entries[0].d.body.includes("Current stage: brainstorming"),
			"status entry body should carry the current stage",
		);
		assert.ok(
			out.statuses.some((s: { k: string; v: string }) => s.k === "velpari" && s.v.includes("brainstorming")),
			"footer status not set to the current stage",
		);
	});

	it("reset: cancelled keeps state.json, confirmed clears it", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			"import { createRun, loadState } from " +
				STATE_JS +
				"; " +
				"import { handleReset } from " +
				RESET_JS +
				"; " +
				"const cwd = process.cwd(); " +
				"createRun('E2E reset run', cwd); " +
				MOCKS +
				"globalThis.__confirmAnswer = false; " +
				"await handleReset(ctx, cwd); " +
				"const afterCancel = loadState(cwd).currentStage; " +
				"globalThis.__confirmAnswer = true; " +
				"await handleReset(ctx, cwd); " +
				"const afterConfirm = loadState(cwd).currentStage; " +
				"process.stdout.write(JSON.stringify({ afterCancel, afterConfirm, notes }));",
		);

		assert.strictEqual(out.afterCancel, "brainstorming", "cancelled reset must keep the run state");
		assert.strictEqual(out.afterConfirm, "none", "confirmed reset must clear the run state");
		assert.ok(
			out.notes.some((n: { m: string }) => n.m.includes("Reset cancelled")),
			"cancel path should notify 'Reset cancelled'",
		);
		assert.ok(
			out.notes.some((n: { m: string }) => n.m.includes("reset")),
			"confirm path should notify the reset",
		);
	});

	it("show-prd falls back to the legacy flat Doc/ path and says so", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		// Legacy flat layout only — no Doc/requirements/PRD_E2EFixture.md.
		const docDir = join(home.cwd, "Doc");
		mkdirSync(docDir, { recursive: true });
		writeFileSync(join(docDir, "PRD_E2EFixture.md"), "# PRD (legacy flat)\n", "utf8");

		const out = await runModuleScript<any>(
			client,
			"import { showPrd } from " +
				SHOW_JS +
				"; " +
				"const cwd = process.cwd(); " +
				MOCKS +
				"await showPrd(ctx, cwd); " +
				"process.stdout.write(JSON.stringify({ notes }));",
		);

		const flat = out.notes.map((n: { m: string }) => n.m).join("\n---\n");
		assert.ok(flat.includes("# PRD (legacy flat)"), "show-prd did not print the legacy document content");
		assert.ok(flat.includes("legacy flat path"), "show-prd should note that the legacy flat path was used");
	});

	it("handoff: wrong stage hard-blocks; finalized-design writes a schema-valid architect-inputs.json", {
		timeout: 60_000,
	}, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"; ' +
				"import { clearRun, createRun, advanceStage, loadState } from " +
				STATE_JS +
				"; " +
				"import { runHandoff, validateSenaiSchema } from " +
				HANDOFF_JS +
				"; " +
				"const cwd = process.cwd(); " +
				"clearRun(cwd); " +
				"let s = createRun('E2E handoff run', cwd); " +
				MOCKS +
				// 1. Wrong stage: brainstorming must hard-block.
				"await runHandoff(loadState(cwd), ctx, cwd); " +
				"const blockedNotes = notes.slice(); " +
				"notes.length = 0; " +
				// 2. Walk the legal chain up to finalized-design. v1.6.0+ requires
				//    per-stage approve commands (e.g. `/velpari-prd-approve`,
				//    `/velpari-rtm-approve`) to advance from each draft-*-ing
				//    state. The walk below mirrors STAGE_TRANSITIONS exactly.
				"const walk = ['/velpari-approve-brainstorm','/velpari-prd','/velpari-prd-approve','/velpari-rtm','/velpari-rtm-approve','/velpari-feasibility','/velpari-feasibility-approve','/velpari-architecture-generator','/velpari-architecture-generator-approve','/velpari-atomic-function','/velpari-atomic-function-approve','/velpari-pseudocode','/velpari-pseudocode-approve','/velpari-testplan','/velpari-testplan-approve','/velpari-development-order','/velpari-development-order-approve','/velpari-final-design','/velpari-final-design-approve']; " +
				"for (const cmd of walk) { s = advanceStage(s, cmd, cwd); } " +
				// 3. Seed the 10 required approved artifacts (grouped layout).
				"const seed = (p) => { mkdirSync(cwd + '/Doc/' + p.split('/')[0], { recursive: true }); writeFileSync(cwd + '/Doc/' + p, '# approved\\n', 'utf8'); }; " +
				"['requirements/PRD_E2EFixture.md','requirements/RTM_E2EFixture.md','feasibility/feasibility-study_E2EFixture.md','design/design_E2EFixture.md','atomic-functions/atomic-functions_E2EFixture.md','pseudocode/pseudocode_E2EFixture.md','tests/test-plan_E2EFixture.md','tests/test-cases_E2EFixture.md','development-order/development-order_E2EFixture.md','design/final-design_E2EFixture.md'].forEach(seed); " +
				// 4. Handoff with confirm = true.
				"globalThis.__confirmAnswer = true; " +
				"await runHandoff(loadState(cwd), ctx, cwd); " +
				"const target = cwd + '/.pi/senai/architect-inputs.json'; " +
				"const written = existsSync(target); " +
				"const json = written ? JSON.parse(readFileSync(target, 'utf8')) : null; " +
				"let schemaOk = false; " +
				"try { schemaOk = written ? validateSenaiSchema(json) : false; } catch { schemaOk = false; } " +
				"process.stdout.write(JSON.stringify({" +
				"  blockedNotes, notes, written, schemaOk," +
				"  docCount: json ? json.documents.length : -1," +
				"  projectName: json ? json.projectName : ''," +
				"  stage: loadState(cwd).currentStage," +
				"}));",
		);

		assert.strictEqual(out.blockedNotes.length, 1, "wrong-stage handoff should notify exactly once");
		assert.ok(
			out.blockedNotes[0].m.includes("Cannot handoff at stage"),
			`unexpected block message: ${out.blockedNotes[0].m}`,
		);
		assert.ok(out.written, "architect-inputs.json was not written");
		assert.ok(out.schemaOk, "architect-inputs.json failed validateSenaiSchema");
		assert.strictEqual(out.projectName, "E2EFixture", "handoff lost the projectName");
		assert.strictEqual(
			out.docCount,
			10,
			"handoff should reference exactly the 10 required documents (incl. atomic-functions + dev-order + final-design)",
		);
		assert.strictEqual(out.stage, "handoff-ready", "state must advance to handoff-ready after a confirmed handoff");
	});
});
