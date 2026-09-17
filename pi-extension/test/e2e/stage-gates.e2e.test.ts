/**
 * E2E integration tests for Velpari's sequence hard-lock, running inside
 * a real `pi --mode rpc` process.
 *
 * "We cannot break the sequence" is the core discipline of the
 * orchestrator. These tests prove it end-to-end with real state files in
 * the synthetic temp project, driving the BUILT modules through the RPC
 * `bash` channel — no mocks for state, only for the Pi-facing ctx/pi
 * surfaces (notify / sendUserMessage capture).
 *
 * Covered here:
 *   1. Happy path: walking STAGE_TRANSITIONS from `brainstorming` reaches
 *      `handoff-ready`, state.json on disk matches after every step
 *   2. Negative: `advanceStage` rejects every illegal jump with a clear
 *      "Cannot transition" error
 *   3. Hard stage gate: `runStage` blocks all 6 core stage commands when
 *      the run is at the wrong stage — error notify names the correct
 *      next command, and NOTHING is handed to the LLM
 *   4. Gate pass: `runStage("prd")` from `brainstormed` with the approved
 *      brainstorm doc present hands off exactly one prompt
 *
 * Tier 1 only. No LLM key required.
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
const CONSTANTS_JS = JSON.stringify(distModuleUrl("core/constants.js"));
const REGISTRY_JS = JSON.stringify(distModuleUrl("stages/registry.js"));
const APPROVE_JS = JSON.stringify(distModuleUrl("ops/approve.js"));

describe("e2e/stage-gates", () => {
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

	it("happy path: walking STAGE_TRANSITIONS reaches handoff-ready with on-disk state in sync", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { clearRun, createRun, advanceStage, loadState } from ${STATE_JS}; ` +
				`import { STAGE_TRANSITIONS } from ${CONSTANTS_JS}; ` +
				`const cwd = process.cwd(); ` +
				`clearRun(cwd); ` +
				`let state = createRun("E2E sequence walk", cwd); ` +
				`const visited = [state.currentStage]; ` +
				`let mismatches = 0; ` +
				`while (true) { ` +
				`  const t = STAGE_TRANSITIONS.find((x) => x.from === state.currentStage); ` +
				`  if (!t) break; ` +
				`  state = advanceStage(state, t.command, cwd); ` +
				`  visited.push(state.currentStage); ` +
				`  if (loadState(cwd).currentStage !== state.currentStage) mismatches++; ` +
				`} ` +
				`process.stdout.write(JSON.stringify({ visited, mismatches, historyLen: state.history.length, transitions: STAGE_TRANSITIONS.length }));`,
		);

		assert.strictEqual(out.mismatches, 0, "state.json on disk diverged from in-memory state during the walk");
		assert.strictEqual(out.visited[0], "brainstorming", "run did not start at brainstorming");
		assert.strictEqual(
			out.visited[out.visited.length - 1],
			"handoff-ready",
			`walk did not reach handoff-ready — stuck at ${out.visited[out.visited.length - 1]}`,
		);
		assert.strictEqual(
			out.historyLen,
			out.visited.length,
			"history must record exactly one entry per stage visited (incl. the initial createRun entry)",
		);
		// The full chain incl. all required stages (Option B — industry-standard order):
		// brainstorm → brainstormed → drafting-prd → drafted-prd → building-rtm → built-rtm
		// → analyzing-feasibility → analyzed-feasibility → designing → designed
		// → analyzing-atomic-functions → analyzed-atomic-functions → writing-pseudocode
		// → wrote-pseudocode → planning-tests → planned-tests → ordering-development
		// → ordered-development → finalizing-design → finalized-design → handoff-ready
		// = 21 visited stages (20 transitions after createRun).
		assert.strictEqual(out.visited.length, 21, `expected 21 visited stages, got: ${out.visited.join(" → ")}`);
	});

	it("negative: advanceStage rejects illegal jumps with a clear error", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { clearRun, createRun, advanceStage } from ${STATE_JS}; ` +
				`const cwd = process.cwd(); ` +
				`clearRun(cwd); ` +
				`const errors = []; ` +
				`let state = createRun("E2E negative walk", cwd); ` +
				`const tryAdvance = (s, cmd) => { try { advanceStage(s, cmd, cwd); return null; } catch (e) { return String(e.message ?? e); } }; ` +
				// From brainstorming, jumping straight to design must fail.
				`errors.push(tryAdvance(state, "/velpari-architecture-generator")); ` +
				// Walk to drafted-prd (3 legal steps), then skip ahead to testplan.
				`state = advanceStage(state, "/velpari-approve-brainstorm", cwd); ` +
				`state = advanceStage(state, "/velpari-prd", cwd); ` +
				`state = advanceStage(state, "/velpari-rtm-approve", cwd); ` +
				`errors.push(tryAdvance(state, "/velpari-testplan")); ` +
				`errors.push(tryAdvance(state, "/velpari-handoff")); ` +
				`process.stdout.write(JSON.stringify({ errors, stage: state.currentStage }));`,
		);

		assert.strictEqual(out.stage, "drafted-prd", "setup walk did not land on drafted-prd");
		for (const err of out.errors) {
			assert.ok(err && err.includes("Cannot transition"), `expected a "Cannot transition" error, got: ${err}`);
			assert.ok(err.includes("STAGE_TRANSITIONS"), "error should point at the transition table");
		}
	});

	it("hard gate: all 6 core stage commands are blocked at the wrong stage, nothing reaches the LLM", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { clearRun, createRun } from ${STATE_JS}; ` +
				`import { runStage } from ${REGISTRY_JS}; ` +
				`const cwd = process.cwd(); ` +
				`clearRun(cwd); ` +
				`createRun("E2E gate lock", cwd); ` + // stage = brainstorming
				`const notes = []; const sent = []; ` +
				`const ctx = { ui: { notify: (m, l) => notes.push({ m, l }) } }; ` +
				`const pi = { sendUserMessage: (m) => sent.push(m) }; ` +
				`for (const key of ["prd", "rtm", "feasibility", "architecture-generator", "pseudocode", "testplan"]) { ` +
				`  await runStage(key, ctx, pi, cwd); ` +
				`} ` +
				`process.stdout.write(JSON.stringify({ notes, sentCount: sent.length }));`,
		);

		assert.strictEqual(out.sentCount, 0, "a gated stage handed a prompt to the LLM — sequence lock broken");
		assert.strictEqual(out.notes.length, 6, "every blocked stage command must notify exactly once");
		for (const n of out.notes) {
			assert.strictEqual(n.l, "error", "gate violation must be an error-level notify");
			assert.ok(n.m.includes("Cannot run /velpari-"), `unexpected message: ${n.m}`);
			assert.ok(
				n.m.includes("/velpari-approve-brainstorm"),
				`error must name the correct next command (from brainstorming that is /velpari-approve-brainstorm): ${n.m}`,
			);
		}
	});

	it("gate pass: runStage(prd) from brainstormed hands off exactly one prompt", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		// Approved brainstorm artifact for mission "E2E gate pass" → slug "e2e-gate-pass".
		const brainstormDir = join(home.cwd, "Doc", "brainstorm");
		mkdirSync(brainstormDir, { recursive: true });
		writeFileSync(
			join(brainstormDir, "brainstorm-e2e-gate-pass.md"),
			"# Brainstorm: E2E gate pass\n\n## Agreed\n\n- Build the thing.\n",
			"utf8",
		);

		const out = await runModuleScript<any>(
			client,
			`import { clearRun, createRun, advanceStage } from ${STATE_JS}; ` +
				`import { runStage } from ${REGISTRY_JS}; ` +
				`const cwd = process.cwd(); ` +
				`clearRun(cwd); ` +
				`let state = createRun("E2E gate pass", cwd); ` +
				`state = advanceStage(state, "/velpari-approve-brainstorm", cwd); ` + // → brainstormed
				`const notes = []; const sent = []; ` +
				`const ctx = { ui: { notify: (m, l) => notes.push({ m, l }) } }; ` +
				`const pi = { sendUserMessage: (m) => sent.push(m) }; ` +
				`await runStage("prd", ctx, pi, cwd); ` +
				`process.stdout.write(JSON.stringify({` +
				`  notes, sentCount: sent.length,` +
				`  promptHasMission: sent.length === 1 && sent[0].includes("E2E gate pass"),` +
				`}));`,
		);

		assert.strictEqual(out.sentCount, 1, `expected exactly one prompt hand-off, notes: ${JSON.stringify(out.notes)}`);
		assert.ok(out.promptHasMission, "hand-off prompt does not carry the mission text");
		const errors = out.notes.filter((n: { l: string }) => n.l === "error");
		assert.deepStrictEqual(errors, [], `gate-pass run produced error notifies: ${JSON.stringify(errors)}`);
	});

	it("feasibility approve gate: unsettled session blocks, settled session publishes + clears (feasibility v2)", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`process.env.VELPARI_SKIP_AUTO_DOCTOR = "1"; ` +
				`import { clearRun, createRun, advanceStage, loadState, setFeasibilitySession } from ${STATE_JS}; ` +
				`import { handleApprove } from ${APPROVE_JS}; ` +
				`import { mkdirSync, writeFileSync, existsSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`const cwd = process.cwd(); ` +
				`clearRun(cwd); ` +
				`let state = createRun("E2EFixture", cwd); ` +
				`for (const cmd of ["/velpari-approve-brainstorm", "/velpari-prd", "/velpari-testplan-approve", "/velpari-rtm", "/velpari-development-order-approve", "/velpari-feasibility"]) { ` +
				`  state = advanceStage(state, cmd, cwd); ` +
				`} ` +
				// Full v2-template working copy (all 13 sections + verdict word).
				`const sections = ["Executive Summary", "Options Analysis", "Build-vs-Reuse Comparison", "Language Selection", "Technical Feasibility", "Schedule Feasibility", "Cost Feasibility", "Risk Feasibility", "Overall Verdict", "Conditions", "Top 5 Risks", "Open Questions", "Change Log"]; ` +
				`const body = sections.map((s, i) => "## " + (i + 1) + ". " + s + "\\n" + (s === "Overall Verdict" ? "All pass.\\nFinal: Go" : s + " content.")).join("\\n\\n"); ` +
				`const dir = join(cwd, ".IDE_Plans", "velpari", "runs", loadState(cwd).runId, "feasibility"); ` +
				`mkdirSync(dir, { recursive: true }); ` +
				`writeFileSync(join(dir, "feasibility-study_E2EFixture.md"), "# Feasibility Study\\n\\n" + body + "\\n", "utf8"); ` +
				`const notes = []; ` +
				`const ctx = { ui: { notify: (m, l) => notes.push({ m, l }), setStatus: () => {} } }; ` +
				`await handleApprove(ctx, undefined, cwd); ` +
				`const blocked = notes.map((n) => n.m).join("\\n"); ` +
				`const pubPath = join(cwd, "Doc", "feasibility", "feasibility-study_E2EFixture.md"); ` +
				`const publishedBefore = existsSync(pubPath); ` +
				`const stageAfterBlock = loadState(cwd).currentStage; ` +
				`setFeasibilitySession(loadState(cwd), { decision: "build", selectedLanguage: "typescript", selectedBy: "user" }, cwd); ` +
				`await handleApprove(ctx, undefined, cwd); ` +
				`const after = loadState(cwd); ` +
				`process.stdout.write(JSON.stringify({ blocked, publishedBefore, stageAfterBlock, publishedAfter: existsSync(pubPath), stage: after.currentStage, sessionCleared: after.feasibilitySession === undefined }));`,
		);

		assert.match(out.blocked, /Feasibility stage is not settled/, "unsettled session must block the publish");
		assert.strictEqual(out.publishedBefore, false, "blocked publish wrote to Doc/");
		assert.strictEqual(out.stageAfterBlock, "analyzing-feasibility", "blocked publish advanced the stage");
		assert.strictEqual(out.publishedAfter, true, "settled session did not publish");
		assert.strictEqual(out.stage, "analyzed-feasibility", "settled publish did not advance");
		assert.strictEqual(out.sessionCleared, true, "feasibility session was not cleared on approve");
	});

	it("feasibility skip: architecture-generator allowed from built-rtm only when a feasibility doc is published", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { clearRun, createRun, advanceStage, loadState } from ${STATE_JS}; ` +
				`import { runStage } from ${REGISTRY_JS}; ` +
				`import { mkdirSync, writeFileSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`const cwd = process.cwd(); ` +
				// Use a fresh projectName: an earlier test in this file already
				// published feasibility-study_E2EFixture.md into the shared home.
				`writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify({ version: 4, projectName: "E2ESkipApp" }), "utf8"); ` +
				`clearRun(cwd); ` +
				`let state = createRun("E2ESkipApp", cwd); ` +
				`for (const cmd of ["/velpari-approve-brainstorm", "/velpari-prd", "/velpari-final-design-approve", "/velpari-rtm", "/velpari-final-design-approve"]) { ` +
				`  state = advanceStage(state, cmd, cwd); ` +
				`} ` + // built-rtm
				`const notes = []; const sent = []; ` +
				`const ctx = { ui: { notify: (m, l) => notes.push({ m, l }) } }; ` +
				`const pi = { sendUserMessage: (m) => sent.push(m) }; ` +
				// No published feasibility doc → the skip must be rejected.
				`await runStage("architecture-generator", ctx, pi, cwd); ` +
				`const rejected = notes.map((n) => n.m).join("\\n"); ` +
				`const rejectedSent = sent.length; ` +
				// Publish a feasibility doc → the skip becomes legal.
				`const dir = join(cwd, "Doc", "feasibility"); ` +
				`mkdirSync(dir, { recursive: true }); ` +
				`writeFileSync(join(dir, "feasibility-study_E2ESkipApp.md"), "# Feasibility\\n", "utf8"); ` +
				`notes.length = 0; ` +
				`await runStage("architecture-generator", ctx, pi, cwd); ` +
				`const allowedErrors = notes.filter((n) => n.l === "error").map((n) => n.m); ` +
				`const allowedSent = sent.length; ` +
				`state = advanceStage(loadState(cwd), "/velpari-architecture-generator", cwd); ` +
				`process.stdout.write(JSON.stringify({ rejected, rejectedSent, allowedErrors, allowedSent, stage: state.currentStage }));`,
		);

		assert.strictEqual(out.rejectedSent, 0, "architecture-generator without a published feasibility doc must not reach the LLM");
		assert.match(out.rejected, /Cannot run \/velpari-architecture-generator at stage "built-rtm"/);
		assert.match(out.rejected, /Run \/velpari-feasibility first\./, "rejection must name /velpari-feasibility");
		assert.ok(
			!out.rejected.includes("or /velpari-architecture-generator"),
			`rejection must not offer the hidden skip: ${out.rejected}`,
		);
		assert.deepStrictEqual(out.allowedErrors, [], `allowed skip produced errors: ${JSON.stringify(out.allowedErrors)}`);
		assert.strictEqual(out.allowedSent, 1, "architecture-generator with a published feasibility doc must hand off exactly one prompt");
		assert.strictEqual(out.stage, "designing", "skip advance did not land on designing");
	});

	it("final-design: rejected at brainstorming, accepted at planned-tests, advances to finalizing-design", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { clearRun, createRun, advanceStage, loadState } from ${STATE_JS}; ` +
				`import { runStage } from ${REGISTRY_JS}; ` +
				`import { writeFileSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`const cwd = process.cwd(); ` +
				// Fresh projectName so we are not affected by earlier fixture docs.
				`writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify({ version: 4, projectName: "E2EFinalApp" }), "utf8"); ` +
				`clearRun(cwd); ` +
				`createRun("E2EFinalApp-reject", cwd); ` + // stage = brainstorming
				`const rejectNotes = []; ` +
				`const rejectCtx = { ui: { notify: (m, l) => rejectNotes.push({ m, l }) } }; ` +
				`await runStage("final-design", rejectCtx, { sendUserMessage: () => {} }, cwd); ` +
				`const rejectError = rejectNotes.filter((n) => n.l === "error").map((n) => n.m).join("|"); ` +
				`process.stdout.write(JSON.stringify({ stage: loadState(cwd).currentStage, rejectError }));`,
		);

		assert.strictEqual(out.stage, "brainstorming", "reject test should not advance the stage");
		assert.match(out.rejectError, /Cannot run \/velpari-final-design at stage "brainstorming"/);
	});

	it("final-design accept: at ordered-development the gate passes, advanceStage lands on finalizing-design", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		// Industry-standard order: design → atomic-function → pseudocode → test-plan →
		// development-order → final-design. Final-design runs from `ordered-development`.
		const out = await runModuleScript<any>(
			client,
			`import { clearRun, createRun, advanceStage, loadState } from ${STATE_JS}; ` +
				`import { runStage } from ${REGISTRY_JS}; ` +
				`import { writeFileSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`const cwd = process.cwd(); ` +
				`writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify({ version: 4, projectName: "E2EFinalApp2" }), "utf8"); ` +
				`clearRun(cwd); ` +
				`let state = createRun("E2EFinalApp2", cwd); ` +
				`for (const cmd of ["/velpari-approve-brainstorm", "/velpari-prd", "/velpari-final-design-approve", "/velpari-rtm", "/velpari-final-design-approve", "/velpari-feasibility", "/velpari-final-design-approve", "/velpari-architecture-generator", "/velpari-final-design-approve", "/velpari-atomic-function", "/velpari-final-design-approve", "/velpari-pseudocode", "/velpari-final-design-approve", "/velpari-testplan", "/velpari-final-design-approve", "/velpari-development-order", "/velpari-final-design-approve"]) { ` +
				`  state = advanceStage(state, cmd, cwd); ` +
				`} ` +
				`const acceptNotes = []; ` +
				`const acceptCtx = { ui: { notify: (m, l) => acceptNotes.push({ m, l }) } }; ` +
				`const preAdvance = loadState(cwd).currentStage; ` +
				`await runStage("final-design", acceptCtx, { sendUserMessage: () => {} }, cwd); ` +
				`const gateError = acceptNotes.find((n) => n.l === "error" && n.m.includes("Cannot run /velpari-final-design")); ` +
				`state = advanceStage(loadState(cwd), "/velpari-final-design", cwd); ` +
				`process.stdout.write(JSON.stringify({ preAdvance, gateError: gateError ? gateError.m : null, finalStage: state.currentStage }));`,
		);

		assert.strictEqual(out.preAdvance, "ordered-development", "walk did not land on ordered-development");
		assert.strictEqual(out.gateError, null, `gate at ordered-development should pass; saw: ${out.gateError}`);
		assert.strictEqual(out.finalStage, "finalizing-design", "advanceStage via /velpari-final-design did not land on finalizing-design");
	});
});
