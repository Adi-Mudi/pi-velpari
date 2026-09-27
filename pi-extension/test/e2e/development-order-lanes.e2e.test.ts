/**
 * Phase 7 E2E — Stage 9 development-order execution lanes (plan 7.10.1).
 *
 * Drives the full lanes flow through the built modules over the RPC bash
 * channel inside a real `pi --mode rpc` process (Tier 1, no LLM key):
 *
 *   1. Store-gated `runStage("development-order")` hands off exactly one
 *      prompt; the advanceStage walk lands on `ordering-development`.
 *   2. The skill-prescribed working copy (## Execution Lanes) + stage
 *      payload (devStep/stepAf/stepDep/devLane/devLaneXdep) are written.
 *   3. `handleApprove` publishes and finalizes: dev_lane rows land in the
 *      store (worked-example map), the envelope flips to published, and
 *      the working copy survives the preview gate untouched.
 *   4. `runDoctor` is green (zero errors) and the "Execution lanes"
 *      section reports the lane map.
 *   5. `runHandoff` writes `.pi/senai/architect-inputs.json` carrying the
 *      `lanes` block (lanes + integration plan + lock rules + shape).
 *
 * Fixture notes (learned in the plan-7.10.1 dry-run):
 *   - Declared input docs seed at the LEGACY flat Doc/ layout: grouped
 *     stubs fail frontmatter/PSRS checks as errors, legacy is warning/info.
 *   - The feasibility input carries its 13 v2 sections (heading + body +
 *     a Go verdict) or feasibility-v2 errors.
 *   - `skills/` is copied into the project cwd (the stage-skills check is
 *     cwd-relative) and package.json carries keywords + pi.extensions so
 *     official-readiness has no errors.
 *   - Input bytes must stay stable after publish: rewriting them (even as
 *     grouped copies) flips freshness to input-changed and handoff blocks.
 */

import { describe, it, before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, distModuleUrl, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedVelpariConfig } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

const PROJECT = "E2ELanesApp";

/** Run `script` (ESM source, top-level await allowed) in the temp project
 *  via the RPC bash channel; returns the parsed JSON payload the script
 *  printed to stdout. */
async function runModuleScript<T>(client: RpcClient, script: string): Promise<T> {
	const result = await client.request<any>("bash", {
		command: [
			// node:sqlite is experimental and prints an ExperimentalWarning to
			// stderr on first load (D9) — the bash channel merges stdout+stderr
			// and these scripts parse the union as JSON, so silence warnings.
			"NODE_NO_WARNINGS=1 node --input-type=module -e",
			JSON.stringify(script),
		].join(" "),
	});
	assert.ok(result.success === true, `subprocess failed: ${JSON.stringify(result.error ?? result)}`);
	const output: string = result.data?.output ?? result.output ?? "";
	assert.ok(output.length > 0, "subprocess produced no output");
	try {
		return JSON.parse(output) as T;
	} catch {
		throw new Error(
			`subprocess output is not pure JSON — head: ${JSON.stringify(output.slice(0, 400))} — tail: ${JSON.stringify(output.slice(-1500))}`,
		);
	}
}

const STATE_JS = JSON.stringify(distModuleUrl("core/state.js"));
const REGISTRY_JS = JSON.stringify(distModuleUrl("stages/registry.js"));
const APPROVE_JS = JSON.stringify(distModuleUrl("ops/approve.js"));
const DB_JS = JSON.stringify(distModuleUrl("io/db.js"));
const STORE_JS = JSON.stringify(distModuleUrl("io/store.js"));
const PATHS_JS = JSON.stringify(distModuleUrl("core/paths.js"));
const DEVL_JS = JSON.stringify(distModuleUrl("core/dev-lanes.js"));
const DOCTOR_JS = JSON.stringify(distModuleUrl("doctor/index.js"));
const HANDOFF_JS = JSON.stringify(distModuleUrl("ops/handoff.js"));

/** Walk up from this file until the pi-velpari package.json — same rule
 *  as helpers/test-home.ts:findProjectRoot (not exported). */
function findProjectRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 16; i++) {
		const pkg = join(dir, "package.json");
		if (existsSync(pkg)) {
			try {
				const json = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string };
				if (json.name === "pi-velpari" || json.name === "@adi-mudi/pi-velpari") return dir;
			} catch {
				/* keep walking */
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("development-order-lanes e2e: could not locate the pi-velpari project root");
}

describe("e2e/development-order-lanes", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedVelpariConfig(home, { projectName: PROJECT });
		// Official-readiness: keywords + pi.extensions are errors otherwise.
		writeFileSync(
			join(home.cwd, "package.json"),
			JSON.stringify(
				{
					name: "pi-velpari-e2e-fixture",
					version: "0.0.0",
					type: "module",
					private: true,
					keywords: ["pi-package", "pi-extension"],
					pi: { extensions: ["./pi-extension/src/index.ts"] },
				},
				null,
				2,
			) + "\n",
			"utf8",
		);
		// Stage-skills check resolves skills/ from the project cwd.
		cpSync(join(findProjectRoot(), "skills"), join(home.cwd, "skills"), { recursive: true });
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("1. store-gated runStage hands off one prompt; walk lands on ordering-development", {
		timeout: 60_000,
	}, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { clearRun, createRun, advanceStage, loadState } from ${STATE_JS}; ` +
				`import { runStage } from ${REGISTRY_JS}; ` +
				`import { openStoreDb, closeStoreDb } from ${DB_JS}; ` +
				`import { writeArtifact, publishArtifact } from ${STORE_JS}; ` +
				`import { buildStoreDbPath, buildOutputPath } from ${PATHS_JS}; ` +
				`import { mkdirSync, writeFileSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`const cwd = process.cwd(); ` +
				`clearRun(cwd); ` +
				`let state = createRun("${PROJECT} — phase 7 lanes e2e", cwd); ` +
				`for (const cmd of ["/velpari-approve-brainstorm", "/velpari-prd", "/velpari-prd-approve", "/velpari-rtm", "/velpari-rtm-approve", "/velpari-feasibility", "/velpari-feasibility-approve", "/velpari-architecture-generator", "/velpari-architecture-generator-approve", "/velpari-atomic-function", "/velpari-atomic-function-approve", "/velpari-pseudocode", "/velpari-pseudocode-approve", "/velpari-testplan", "/velpari-testplan-approve"]) { ` +
				`  state = advanceStage(state, cmd, cwd); ` +
				`} ` +
				`const feasSections = ["Executive Summary", "Options Analysis", "Build-vs-Reuse Comparison", "Language Selection", "Technical Feasibility", "Schedule Feasibility", "Cost Feasibility", "Risk Feasibility", "Overall Verdict", "Conditions", "Top 5 Risks", "Open Questions", "Change Log"]; ` +
				`const feas = feasSections.map((s) => { ` +
				`  const body = s === "Overall Verdict" ? "Go — the spike validates the approach." : "Stub body for " + s + "."; ` +
				`  return "## " + s + "\\n\\n" + body + "\\n"; ` +
				`}).join("\\n"); ` +
				`for (const artifact of ["design", "PRD", "RTM", "feasibility-study", "atomic-functions", "pseudocode", "test-plan", "test-cases"]) { ` +
				`  mkdirSync(join(cwd, "Doc"), { recursive: true }); ` +
				`  const body = artifact === "feasibility-study" ? "# Feasibility Study\\n\\n" + feas : "# " + artifact + "\\n\\nStub body.\\n"; ` +
				`  writeFileSync(join(cwd, buildOutputPath(artifact, "${PROJECT}")), body, "utf8"); ` +
				`} ` +
				`const runId = loadState(cwd).runId; ` +
				`const env = { version: 1, generatedAt: "2026-09-27T00:00:00.000Z", inputs: "{}", reviewerVerdict: null, changeLog: "[]" }; ` +
				`const db = openStoreDb(buildStoreDbPath("${PROJECT}", cwd)); ` +
				`try { ` +
				`  const pairs = [["prd", "drafting-prd"], ["rtm", "building-rtm"], ["feasibility", "analyzing-feasibility"], ["design", "designing"], ["pseudocode", "writing-pseudocode"], ["testplan", "planning-tests"]]; ` +
				`  for (const [kind, stage] of pairs) { ` +
				`    writeArtifact(db, kind, runId, Object.assign({}, env, { stage }), {}); ` +
				`    publishArtifact(db, runId, kind); ` +
				`  } ` +
				`  writeArtifact(db, "atomic-functions", runId, Object.assign({}, env, { stage: "analyzing-atomic-functions" }), { ` +
				`    atomicFunction: [ ` +
				`      { id: "AF-1", name: "seedOne", signature: "seedOne(): void", tier: "basic", criticality: "A", sil: "none", isLeaf: 1, purpose: "Seed AF-1.", source: "e2e", cohesion: "one", verification: "unit", testable: "yes" }, ` +
				`      { id: "AF-2", name: "seedTwo", signature: "seedTwo(): void", tier: "basic", criticality: "A", sil: "none", isLeaf: 1, purpose: "Seed AF-2.", source: "e2e", cohesion: "one", verification: "unit", testable: "yes" }, ` +
				`    ], ` +
				`  }); ` +
				`  publishArtifact(db, runId, "atomic-functions"); ` +
				`} finally { closeStoreDb(db); } ` +
				`const notes = []; const sent = []; ` +
				`const ctx = { ui: { notify: (m, l) => notes.push({ m, l }), setStatus: () => {}, confirm: async () => true } }; ` +
				`const pi = { sendUserMessage: (m) => sent.push(m), appendEntry: () => {}, getFlag: () => undefined }; ` +
				`await runStage("development-order", ctx, pi, cwd); ` +
				`const stageErrors = notes.filter((n) => n.l === "error").map((n) => n.m); ` +
				`state = advanceStage(loadState(cwd), "/velpari-development-order", cwd); ` +
				`process.stdout.write(JSON.stringify({ sentCount: sent.length, stageErrors, stage: state.currentStage }));`,
		);

		assert.strictEqual(out.sentCount, 1, "runStage must hand off exactly one prompt");
		assert.deepStrictEqual(out.stageErrors, [], `runStage produced errors: ${JSON.stringify(out.stageErrors)}`);
		assert.strictEqual(
			out.stage,
			"ordering-development",
			"advance via /velpari-development-order must land on ordering-development",
		);
	});

	it("2. skill-prescribed working copy + payload carry the lane map", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { loadState } from ${STATE_JS}; ` +
				`import { computeLanes } from ${DEVL_JS}; ` +
				`import { mkdirSync, writeFileSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`const cwd = process.cwd(); ` +
				`const runId = loadState(cwd).runId; ` +
				`const steps = [ { stepId: "A", module: "core" }, { stepId: "B", module: "core" }, { stepId: "C", module: "shared" }, { stepId: "D", module: "api" }, { stepId: "E", module: "api" }, { stepId: "F", module: "edge" } ]; ` +
				`const deps = [ { stepId: "C", dependsOnStepId: "A" }, { stepId: "C", dependsOnStepId: "B" }, { stepId: "D", dependsOnStepId: "C" }, { stepId: "E", dependsOnStepId: "C" }, { stepId: "F", dependsOnStepId: "D" }, { stepId: "F", dependsOnStepId: "E" } ]; ` +
				`const plan = computeLanes(steps, deps, { maxLanes: 4, projectSlug: "${PROJECT}" }); ` +
				`if (!plan.ok) throw new Error("computeLanes failed: " + JSON.stringify(plan.problems)); ` +
				`const laneRows = plan.plan.lanes.flatMap((lane) => lane.steps.map((stepId, position) => ({ laneId: lane.laneId, stepId, position, worktree: lane.worktree, branch: lane.branch, status: lane.status }))); ` +
				`const xdepRows = plan.plan.xdeps.map((x) => ({ stepId: x.stepId, dependsOnId: x.dependsOnStepId, boundaryLevel: x.boundaryLevel })); ` +
				`const wcDir = join(cwd, ".IDE_Plans", "velpari", "runs", runId, "development-order"); ` +
				`mkdirSync(wcDir, { recursive: true }); ` +
				`const wc = [ ` +
				`  "# Development Order — ${PROJECT}", "", "## Order", "", ` +
				`  "- 1. A — AFs: AF-1", "- 2. B — AFs: AF-2", "- 3. C — AFs: AF-1, AF-2", ` +
				`  "- 4. D — AFs: AF-1", "- 5. E — AFs: AF-2", "- 6. F — AFs: AF-1, AF-2", ` +
				`  "", "## Execution Lanes", "", "| Lane | Worktree | Branch | Steps | Status |", "| --- | --- | --- | --- | --- |", ` +
				`  "| lane-1 | e2elanesapp/lane-1-core | e2elanesapp/lane-1-core | A, C, D, F | active |", ` +
				`  "| lane-2 | e2elanesapp/lane-2-edge | e2elanesapp/lane-2-edge | B, E | active |", ` +
				`  "", "## Integration Plan", "", "| # | Lane | Merge level | Gates |", "| --- | --- | --- | --- |", ` +
				`  "| 1 | lane-2 | 1 | rebuild + tests + doctor |", "| 2 | lane-1 | 2 | rebuild + tests + doctor |", ` +
				`  "", "## Lane Shape", "", "parallel", "series", "parallel", "series", ` +
				`  "", "## Change Log", "", "- 1.0.0 — initial draft.", "", ` +
				`].join("\\n"); ` +
				`writeFileSync(join(wcDir, "development-order_${PROJECT}.md"), wc, "utf8"); ` +
				`const yaml = [ "project: ${PROJECT}", "version: 1.0.0", "steps:", "  - id: A", "    module: core", "    afs: [AF-1]", "    dependsOn: []", "    rationale: foundation", "changeLog:", "  - 1.0.0 — initial draft.", "" ].join("\\n"); ` +
				`writeFileSync(join(wcDir, "development-order_${PROJECT}.yaml"), yaml, "utf8"); ` +
				`const payload = { ` +
				`  envelope: { version: 1, stage: "ordering-development", generatedAt: "2026-09-27T00:00:00.000Z", inputs: {}, reviewerVerdict: null, changeLog: ["2026-09-27: Phase 7 lanes e2e."] }, ` +
				`  rows: { ` +
				`    devStep: steps.map((s) => ({ id: s.stepId, module: s.module, description: "Step " + s.stepId + "." })), ` +
				`    stepAf: [ { stepId: "A", afId: "AF-1" }, { stepId: "B", afId: "AF-2" }, { stepId: "C", afId: "AF-1" }, { stepId: "C", afId: "AF-2" }, { stepId: "D", afId: "AF-1" }, { stepId: "E", afId: "AF-2" }, { stepId: "F", afId: "AF-1" }, { stepId: "F", afId: "AF-2" } ], ` +
				`    stepDep: deps.map((d) => ({ stepId: d.stepId, dependsOnId: d.dependsOnStepId })), ` +
				`    devLane: laneRows, ` +
				`    devLaneXdep: xdepRows, ` +
				`  }, ` +
				`}; ` +
				`const payloadDir = join(wcDir, "payload"); ` +
				`mkdirSync(payloadDir, { recursive: true }); ` +
				`writeFileSync(join(payloadDir, "development-order-payload.json"), JSON.stringify(payload, null, 2) + "\\n", "utf8"); ` +
				`process.stdout.write(JSON.stringify({ hasLanesSection: wc.includes("## Execution Lanes"), laneCount: laneRows.length, xdepCount: xdepRows.length, payloadKeys: Object.keys(payload.rows) }));`,
		);

		assert.strictEqual(out.hasLanesSection, true, "working copy must carry the Execution Lanes section");
		assert.strictEqual(out.laneCount, 6, "the worked example must map all 6 steps into lanes");
		assert.strictEqual(out.xdepCount, 3, "the worked example must record 3 cross-lane integration points");
		assert.deepStrictEqual(
			out.payloadKeys.sort(),
			["devLane", "devLaneXdep", "devStep", "stepAf", "stepDep"],
			"payload row sets must be exactly the five the skill prescribes",
		);
	});

	it("3. approve finalizes lanes into the store; the working copy survives the gate", {
		timeout: 60_000,
	}, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { loadState } from ${STATE_JS}; ` +
				`import { handleApprove } from ${APPROVE_JS}; ` +
				`import { openStoreDb, closeStoreDb } from ${DB_JS}; import { readArtifact } from ${STORE_JS}; ` +
				`import { buildStoreDbPath } from ${PATHS_JS}; ` +
				`import { readFileSync, writeFileSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`import { execFileSync } from "node:child_process"; ` +
				`const cwd = process.cwd(); ` +
				`execFileSync("git", ["init", "-q"], { cwd }); ` +
				`execFileSync("git", ["config", "user.name", "Velpari Phase7"], { cwd }); ` +
				`execFileSync("git", ["config", "user.email", "phase7@velpari.local"], { cwd }); ` +
				`const globalCfg = join(cwd, "gitconfig-global"); ` +
				`writeFileSync(globalCfg, "[user]\\n\\tname = Velpari Phase7\\n\\temail = phase7@velpari.local\\n", "utf8"); ` +
				`process.env.GIT_CONFIG_GLOBAL = globalCfg; ` +
				`process.env.GIT_CONFIG_SYSTEM = "/dev/null"; ` +
				`process.env.GIT_CONFIG_NOSYSTEM = "1"; ` +
				`const notes = []; ` +
				`const ctx = { ui: { notify: (m, l) => notes.push({ m, l }), setStatus: () => {}, confirm: async () => true } }; ` +
				`await handleApprove(ctx, undefined, cwd, { skipAutoDoctor: true }); ` +
				`const stage = loadState(cwd).currentStage; ` +
				`const db = openStoreDb(buildStoreDbPath("${PROJECT}", cwd)); ` +
				`let store; ` +
				`try { ` +
				`  const stored = readArtifact(db, loadState(cwd).runId, "development-order"); ` +
				`  if (!stored) { store = null; } else { ` +
				`    const r = stored.rows; ` +
				`    store = { ` +
				`      status: stored.envelope.status, ` +
				`      lanes: (r.devLane ?? []).map((l) => ({ laneId: l.laneId, stepId: l.stepId, position: l.position, worktree: l.worktree, branch: l.branch })), ` +
				`      xdeps: (r.devLaneXdep ?? []).map((x) => ({ stepId: x.stepId, dependsOnId: x.dependsOnId, boundaryLevel: x.boundaryLevel })), ` +
				`    }; ` +
				`  } ` +
				`} finally { closeStoreDb(db); } ` +
				`const wcPath = join(cwd, ".IDE_Plans", "velpari", "runs", loadState(cwd).runId, "development-order", "development-order_${PROJECT}.md"); ` +
				`const wcSurvives = readFileSync(wcPath, "utf8").includes("## Execution Lanes"); ` +
				`const errorNotes = notes.filter((n) => n.l === "error").map((n) => n.m); ` +
				`process.stdout.write(JSON.stringify({ stage, store, wcSurvives, errorNotes }));`,
		);

		assert.deepStrictEqual(out.errorNotes, [], `approve produced errors: ${JSON.stringify(out.errorNotes)}`);
		assert.strictEqual(out.stage, "ordered-development", "approve must advance to ordered-development");
		assert.ok(out.store, "published development-order rows must exist in the store");
		assert.strictEqual(out.store.status, "published", "the envelope must flip to published");
		assert.deepStrictEqual(
			out.store.lanes.map((l: any) => [l.laneId, l.stepId, l.position]),
			[
				["lane-1", "A", 0],
				["lane-1", "C", 1],
				["lane-1", "D", 2],
				["lane-1", "F", 3],
				["lane-2", "B", 0],
				["lane-2", "E", 1],
			],
			"store dev_lane rows must equal the worked-example map",
		);
		for (const lane of out.store.lanes) {
			assert.strictEqual(lane.worktree, lane.branch, `name-match violated by ${lane.laneId}`);
			assert.match(lane.worktree, /^e2elanesapp\/lane-[12]-/, `worktree naming: ${lane.worktree}`);
		}
		assert.deepStrictEqual(
			out.store.xdeps,
			[
				{ stepId: "C", dependsOnId: "B", boundaryLevel: 1 },
				{ stepId: "E", dependsOnId: "C", boundaryLevel: 2 },
				{ stepId: "F", dependsOnId: "E", boundaryLevel: 3 },
			],
			"store dev_lane_xdep rows must equal the computed boundaries",
		);
		assert.strictEqual(
			out.wcSurvives,
			true,
			"the working copy's lanes section must survive the preview gate untouched",
		);
	});

	it("4. doctor is green and the Execution lanes section reports the lane map", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		// File transport (doctor.e2e pattern): the report path is large and
		// the bash channel merges stdout+stderr.
		const transportPath = `${home.cwd}/e2e-lanes-doctor.json`;
		const result = await client.request<any>("bash", {
			command: [
				"NODE_NO_WARNINGS=1 node --input-type=module -e",
				JSON.stringify(
					`import { writeFileSync } from "node:fs"; ` +
						`import { runDoctor } from ${DOCTOR_JS}; ` +
						`const report = runDoctor(process.cwd()); ` +
						`const errors = []; const laneItems = []; ` +
						`for (const s of report.sections) { ` +
						`  for (const item of s.items) { ` +
						`    if (item.status === "error") errors.push(s.title + ": " + item.message); ` +
						`    if (s.title === "Execution lanes") laneItems.push(item.status + ": " + item.message); ` +
						`  } ` +
						`} ` +
						`const summary = JSON.stringify({ ok: report.ok, errorCount: report.summary.error, errors, laneItems }); ` +
						`writeFileSync(process.cwd() + "/e2e-lanes-doctor.json", summary); ` +
						`process.stdout.write("WROTE " + summary.length);`,
				),
			].join(" "),
		});
		assert.ok(result.success === true, `runDoctor subprocess failed: ${JSON.stringify(result.error ?? result)}`);
		const output: string = result.data?.output ?? result.output ?? "";
		assert.ok(output.startsWith("WROTE "), `unexpected doctor output: ${JSON.stringify(output)}`);
		assert.ok(existsSync(transportPath), `doctor transport file missing at ${transportPath}`);
		const out = JSON.parse(readFileSync(transportPath, "utf8")) as {
			ok: boolean;
			errorCount: number;
			errors: string[];
			laneItems: string[];
		};

		assert.deepStrictEqual(out.errors, [], `doctor reported errors: ${JSON.stringify(out.errors, null, 2)}`);
		assert.strictEqual(out.errorCount, 0, "doctor summary must count zero errors");
		assert.strictEqual(out.ok, true, "doctor verdict must be green");
		assert.strictEqual(out.laneItems.length, 1, "the Execution lanes section must be present");
		assert.match(
			out.laneItems[0] ?? "",
			/^ok: 2 lane\(s\), 6 step\(s\), shape parallel→series→parallel→series$/,
			`lane section item: ${out.laneItems[0]}`,
		);
	});

	it("5. handoff payload carries the lanes block", { timeout: 60_000 }, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { advanceStage, loadState } from ${STATE_JS}; ` +
				`import { runHandoff } from ${HANDOFF_JS}; ` +
				`import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`const cwd = process.cwd(); ` +
				`let state = advanceStage(loadState(cwd), "/velpari-final-design", cwd); ` +
				`state = advanceStage(state, "/velpari-final-design-approve", cwd); ` +
				// Seed only the two docs not already on disk: the 8 declared
				// inputs exist at legacy paths with the exact bytes publish
				// stamped — rewriting them flips freshness to input-changed.
				`for (const [dir, file] of [ ["development-order", "development-order_${PROJECT}.md"], ["design", "final-design_${PROJECT}.md"] ]) { ` +
				`  mkdirSync(join(cwd, "Doc", dir), { recursive: true }); ` +
				`  writeFileSync(join(cwd, "Doc", dir, file), "## section\\n\\nbody", "utf8"); ` +
				`} ` +
				`const notes = []; ` +
				`const ctx = { ui: { notify: (m, l) => notes.push({ m, l }), setStatus: () => {}, confirm: async () => true } }; ` +
				`await runHandoff(loadState(cwd), ctx, cwd); ` +
				`const payloadPath = join(cwd, ".pi", "senai", "architect-inputs.json"); ` +
				`const payload = existsSync(payloadPath) ? JSON.parse(readFileSync(payloadPath, "utf8")) : null; ` +
				`process.stdout.write(JSON.stringify({ ` +
				`  stage: loadState(cwd).currentStage, ` +
				`  payloadKeys: payload ? Object.keys(payload) : null, ` +
				`  lanes: payload ? payload.lanes : null, ` +
				`  errorNotes: notes.filter((n) => n.l === "error").map((n) => n.m), ` +
				`  omittedWarnings: notes.filter((n) => n.l === "warning" && n.m.indexOf("Execution lanes omitted") >= 0).length, ` +
				`}));`,
		);

		assert.deepStrictEqual(out.errorNotes, [], `handoff produced errors: ${JSON.stringify(out.errorNotes)}`);
		assert.strictEqual(out.stage, "handoff-ready", "confirmed handoff must advance the stage to handoff-ready");
		assert.ok(out.payloadKeys, "architect-inputs.json must exist");
		assert.ok(out.payloadKeys.includes("lanes"), `payload keys must include lanes: ${JSON.stringify(out.payloadKeys)}`);
		assert.strictEqual(out.omittedWarnings, 0, "a published lane map must never be omitted");

		const lanes = out.lanes;
		assert.deepStrictEqual(
			(lanes.lanes ?? []).map((l: any) => [l.laneId, l.steps]),
			[
				["lane-1", ["A", "C", "D", "F"]],
				["lane-2", ["B", "E"]],
			],
			"payload lanes must equal the worked-example map",
		);
		for (const lane of lanes.lanes) {
			assert.strictEqual(lane.worktree, lane.branch, `name-match violated by ${lane.laneId}`);
			assert.strictEqual(lane.status, "active", `freshly computed lanes start active (${lane.laneId})`);
		}
		assert.deepStrictEqual(
			(lanes.integrationPlan ?? []).map((e: any) => [e.order, e.laneId, e.mergeLevel]),
			[
				[1, "lane-2", 1],
				[2, "lane-1", 2],
			],
			"integration plan must carry merge order and levels",
		);
		for (const entry of lanes.integrationPlan) {
			assert.deepStrictEqual(
				entry.gates,
				["tests green", "doctor audit"],
				"each plan entry must carry the merge gates",
			);
			assert.strictEqual(typeof entry.preMerge, "string");
			assert.ok((entry.preMerge as string).length > 0, "preMerge must name the parked-lane rebuild rule");
		}
		assert.ok(Array.isArray(lanes.lockRules) && lanes.lockRules.length > 0, "payload must carry lock rules");
		assert.deepStrictEqual(
			lanes.shape,
			["parallel", "series", "parallel", "series"],
			"payload must carry the lane shape",
		);
	});
});

test("E2E gate: this suite is skipped when Tier 1 prerequisites are missing", () => {
	if (!tier1Enabled()) {
		// eslint-disable-next-line no-console
		console.log(`[velpari-e2e] Tier 1 skipped: ${describeTier1Skip()}`);
	}
});
