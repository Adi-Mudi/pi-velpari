/**
 * Phase D E2E — full-app wireframe pairing (N26) + handoff version
 * metadata (N29) on a real `pi --mode rpc` process (Tier 1, no LLM key).
 *
 *   1. Paired publish: a `projectType: "full-app"` project at Stage 5
 *      publishes design + wireframe TOGETHER (identical stamped version),
 *      the design kind lands in the store with a head revision (+ the
 *      `WF-1` wireframe diagram row), and the stage advances.
 *   2. Handoff metadata: every `architect-inputs.json` document carries
 *      numeric `version`/`revisionId` + `frozen: true` +
 *      `freezeReason: "handoff (N4)"` (the payload is written AFTER the
 *      N4 freeze), the optional 11th `Wireframe` document is present,
 *      the N16 `lanes` block is there, and the schema mirror passes.
 *
 * Fixture notes:
 *   - Top-level `projectType: "full-app"` + `velpari.markdownWrites: true`
 *     in files.json (write-alongside mode so the published markdown is
 *     assertable); state walks to `designing` with the arch-sub-cycle
 *     confirmed; the feasibility declared input seeds at the grouped path
 *     with STABLE bytes (freshness must not go input-changed).
 *   - Embedded scripts are string concatenation ONLY (no backticks, no
 *     `${...}`) — the design doc's ``` fences are built at runtime via
 *     String.fromCharCode(96).
 *   - Store seeding for the handoff leg reuses the raw-SQL recipe from
 *     test/ops/handoff-version-meta.test.ts (design already has a real
 *     CAS head from leg 1; the other kinds get envelope + head + lanes).
 */

import { describe, it, before, after, test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RpcClient } from "./helpers/rpc-client.js";
import { makeTestHome, distModuleUrl, shouldRunE2E, type TestHome } from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedVelpariConfig } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

const PROJECT = "E2EFullApp";
const MISSION = "E2EFullApp — full-app wireframe e2e";

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
const APPROVE_JS = JSON.stringify(distModuleUrl("ops/approve.js"));
const HANDOFF_JS = JSON.stringify(distModuleUrl("ops/handoff.js"));
const DB_JS = JSON.stringify(distModuleUrl("io/db.js"));
const STORE_JS = JSON.stringify(distModuleUrl("io/store.js"));
const PATHS_JS = JSON.stringify(distModuleUrl("core/paths.js"));

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
	throw new Error("full-app-wireframe e2e: could not locate the pi-velpari project root");
}

describe("e2e/full-app-wireframe", () => {
	let home: TestHome | undefined;
	let client: RpcClient | undefined;

	before(async () => {
		if (!shouldRunE2E()) return;
		home = makeTestHome({ files: makeMinimalProjectFiles() });
		seedVelpariConfig(home, { projectName: PROJECT });
		// Phase D fixture: top-level projectType (N26) + write-alongside
		// markdown (Phase 11 rollback hatch) so published files are assertable.
		const cfgPath = join(home.cwd, ".pi", "velpari", "files.json");
		const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
		cfg.projectType = "full-app";
		cfg.velpari = { markdownWrites: true };
		writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
		client = new RpcClient({ env: home.env, cwd: home.cwd });
	});

	after(async () => {
		if (client) await client.close();
		if (home) home.cleanup();
	});

	it("1. full-app Stage 5 publishes design + wireframe together with one version", {
		timeout: 120_000,
	}, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { clearRun, createRun, advanceStage, loadState, saveState } from ${STATE_JS}; ` +
				`import { handleApprove } from ${APPROVE_JS}; ` +
				`import { openStoreDb, closeStoreDb } from ${DB_JS}; ` +
				`import { readArtifact, getHeadRevision } from ${STORE_JS}; ` +
				`import { buildGroupedPath, buildStoreDbPath } from ${PATHS_JS}; ` +
				`import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"; ` +
				`import { join } from "node:path"; ` +
				`const cwd = process.cwd(); ` +
				`clearRun(cwd); ` +
				`let state = createRun("${MISSION}", cwd); ` +
				`for (const cmd of ["/velpari-approve-brainstorm", "/velpari-prd", "/velpari-prd-approve", "/velpari-rtm", "/velpari-rtm-approve", "/velpari-feasibility", "/velpari-feasibility-approve", "/velpari-architecture-generator"]) { ` +
				`  state = advanceStage(state, cmd, cwd); ` +
				`} ` +
				`saveState(Object.assign({}, loadState(cwd), { archSubCycle: { contextLoaded: true, developerConfirmed: true, confirmOutcome: "proceed", summaryShown: "e2e", updatedAt: new Date().toISOString() } }), cwd); ` +
				// Declared input (STABLE bytes — freshness must not flip) + legacy stubs.
				`mkdirSync(join(cwd, "Doc", "feasibility"), { recursive: true }); ` +
				`mkdirSync(join(cwd, "Doc", "requirements"), { recursive: true }); ` +
				`writeFileSync(join(cwd, buildGroupedPath("feasibility-study", "${PROJECT}")), "# Feasibility Study\\n\\nStub body.\\n", "utf8"); ` +
				`writeFileSync(join(cwd, buildGroupedPath("PRD", "${PROJECT}")), "# PRD\\n\\nStub body without ids.\\n", "utf8"); ` +
				`writeFileSync(join(cwd, buildGroupedPath("RTM", "${PROJECT}")), "# RTM\\n\\nStub body.\\n", "utf8"); ` +
				// Working copies: 14-section design (gates: arch-sub-cycle +
				// ADR + design-readiness) + the paired wireframe.
				`const BT = String.fromCharCode(96); const F = BT + BT + BT; ` +
				`const adr = '{"id":"ADR-001","title":"Use Layered","status":"accepted","stage":"design","date":"2026-09-14T00:00:00.000Z","runId":"run-test","context":"test","options":[{"id":"layered","label":"Layered","pros":"simple","cons":"scaling"},{"id":"modular-monolith","label":"Modular Monolith","pros":"decomposed","cons":"files"}],"decision":"layered","rationale":"test","consequences":"test","reconsiderTriggers":["scale"]}'; ` +
				`const design = [ ` +
				`  "## 0. Introduction & Goals", "", "### 0.1 Mission", "", "Full-app wireframe e2e mission.", "", ` +
				`  "### 0.2 Top 3-5 Quality Goals", "", "| # | Quality Attribute | Goal | Source PRD row |", "|---|---|---|---|", ` +
				`  "| 1 | Performance | p95 < 200ms | NFR-01 |", "", ` +
				`  "### 0.3 Stakeholders", "", "| Stakeholder | Concern | Viewpoint |", "|---|---|---|", "| end user | fast UI | Runtime |", "", ` +
				`  "### 0.4 Architecture Constraints", "", "| Constraint | Source | Type |", "|---|---|---|", "| Linux arm64 | PRD §13 | platform |", "", ` +
				`  "## 1. Module Breakdown", "", "| Module | Purpose | Source FRs | Maturity | Depends on |", "|---|---|---|---|---|", ` +
				`  "| auth | users | FR-01 | proposed | — |", "", ` +
				`  "## 2. Data Model", "", "| Entity | Fields | Constraints | Notes |", "|---|---|---|---|", "| User | id, email | not null | test |", "", ` +
				`  "## 3. Interface Contracts", "", "Function: createUser", "- Inputs: email", "- Outputs: userId", "- Errors: InvalidEmail", "", ` +
				`  "## 4. Data Flow", "", F + "mermaid", "flowchart LR", "  user --> api", "  api --> db", F, "", ` +
				`  "## 5. Quality Attribute Scenarios", "", ` +
				`  "| NFR ID | Source | Stimulus | Environment | Artifact | Response | Response measure | Approach | Source PRD row |", ` +
				`  "|---|---|---|---|---|---|---|---|---|", ` +
				`  "| NFR-01 | user | click Save | normal | api | save committed | p95 < 200ms | cache | NFR-01 |", "", ` +
				`  "## Architecture Decisions", "", ` +
				`  "- ADR-001: Use Layered | Status: accepted | Stage: design | Date: 2026-09-14T00:00:00.000Z", F + "yaml", adr, F, "", ` +
				`  "## 9. Context View", "", "### 9.1 Users", "", "| Persona | Access | Primary goal |", "|---|---|---|", "| end user | web | test |", "", ` +
				`  "### 9.2 External Systems", "", ` +
				`  "| External system | Purpose | Protocol | Auth | Data direction | Owner | SLA |", "|---|---|---|---|---|---|---|", ` +
				`  "| stripe | billing | REST | OAuth | out | finance | 99.9% |", "", ` +
				`  "### 9.3 Trust Boundaries", "", "| Boundary | From | To | Why the boundary exists |", "|---|---|---|---|", ` +
				`  "| web edge | user | api | untrusted to trusted |", "", ` +
				`  "### 9.4 Cross-boundary Data Flows", "", "| Data | From | To | Rate | Sensitive fields | Encryption |", "|---|---|---|---|---|---|", ` +
				`  "| invoice | api | stripe | per day | amount | TLS |", "", ` +
				`  "## 10. Deployment View", "", "### 10.1 Container → Host Mapping", "", "| Container | Host | Region / Zone | Scaling limits |", ` +
				`  "|---|---|---|---|", "| api | k8s pod | us-east-1 | 2–10 |", "", ` +
				`  "### 10.2 Network Topology", "", "| Network | CIDR / Endpoint | Purpose | Trust level |", "|---|---|---|---|", ` +
				`  "| public-api | api.example.com | webhook | public |", "", ` +
				`  "### 10.3 Scaling Boundaries", "", "| Container | Limit | Source |", "|---|---|---|", "| api | 10 instances max | NFR-01 tactic |", "", ` +
				`  "## 11. Crosscutting Concepts", "", "| Crosscutting concern | Decision |", "|---|---|", "| Persistence | Postgres |", "| Logging | pino, JSON |", "", ` +
				`  "## 12. Risks & Tech Debt", "", "| Risk / Tech debt | Impact | Mitigation | Owner | Status |", "|---|---|---|---|---|", ` +
				`  "| single-region | outage | add second region v0.4 | platform | known |", "", ` +
				`  "## 13. Glossary", "", "| Term | Definition | Source |", "|---|---|---|", "| Task | a unit of work | PRD §3.1 |", "", ` +
				`  "## 14. Diagrams (C4)", "", "### 14.1 System Context (C4 Level 1)", "", F + "mermaid", "C4Context", ` +
				`  '  Person(user, "End user")', '  System(system, "${PROJECT}")', '  Rel(user, system, "Uses")', F, "", ` +
				`  "### 14.2 Container view (C4 Level 2)", "", F + "mermaid", "C4Container", ` +
				`  '  Person(user, "End user")', '  System_Boundary(c1, "${PROJECT}") { Container(api, "API", "Node") }', '  Rel(user, api, "Uses")', F, "", ` +
				`  "### 14.3 Component view (C4 Level 3)", "", F + "mermaid", "C4Component", ` +
				`  '  Container_Boundary(api, "API") { Component(c, "Core", "Node") }', F, "", ` +
				`].join("\\n"); ` +
				`const wireframe = [ ` +
				`  "# Wireframe — ${PROJECT}", "", "## Screens", "", "1. Home — header + list body.", "2. Todo list — one row per todo.", "", ` +
				`  "## User flows", "", "1. Open app → Home.", "2. Home → Todo list → mark done.", "", ` +
				`  "## Layout notes", "", "- Header with app title.", "- List body with one row per todo.", "", ` +
				`  "## FR traceability", "", "| Screen | FRs |", "|---|---|", "| home | FR-01 |", "| list | FR-01 |", "", ` +
				`  "## Change Log", "", "- 1.0.0 — initial wireframes.", "", ` +
				`].join("\\n"); ` +
				`const runId = loadState(cwd).runId; ` +
				`const wcDir = join(cwd, ".IDE_Plans", "velpari", "runs", runId, "design"); ` +
				`mkdirSync(wcDir, { recursive: true }); ` +
				`writeFileSync(join(wcDir, "design_${PROJECT}.md"), design, "utf8"); ` +
				`writeFileSync(join(wcDir, "wireframe_${PROJECT}.md"), wireframe, "utf8"); ` +
				// Stage payload: design kind + the WF-1 wireframe diagram row
				// (N26 decision 8 — canvas sketches ride payload.rows.diagram).
				`const payload = { ` +
				`  envelope: { version: 1, stage: "designing", generatedAt: "2026-09-28T00:00:00.000Z", inputs: {}, reviewerVerdict: null, changeLog: ["2026-09-28: full-app wireframe e2e."] }, ` +
				`  rows: { ` +
				`    designModule: [{ id: "M-1", name: "auth", description: "Auth module." }], ` +
				`    diagram: [{ id: "WF-1", diagramKind: "wireframe", mermaidText: "flowchart LR\\n  home --> list" }], ` +
				`  }, ` +
				`}; ` +
				`const payloadDir = join(wcDir, "payload"); ` +
				`mkdirSync(payloadDir, { recursive: true }); ` +
				`writeFileSync(join(payloadDir, "design-payload.json"), JSON.stringify(payload, null, 2) + "\\n", "utf8"); ` +
				// Real git repo + pinned identity (publish commit + prechecks).
				`import { execFileSync } from "node:child_process"; ` +
				`execFileSync("git", ["init", "-q"], { cwd }); ` +
				`execFileSync("git", ["config", "user.name", "Velpari PhaseD"], { cwd }); ` +
				`execFileSync("git", ["config", "user.email", "phased@velpari.local"], { cwd }); ` +
				`const globalCfg = join(cwd, "gitconfig-global"); ` +
				`writeFileSync(globalCfg, "[user]\\n\\tname = Velpari PhaseD\\n\\temail = phased@velpari.local\\n", "utf8"); ` +
				`process.env.GIT_CONFIG_GLOBAL = globalCfg; ` +
				`process.env.GIT_CONFIG_SYSTEM = "/dev/null"; ` +
				`process.env.GIT_CONFIG_NOSYSTEM = "1"; ` +
				`const notes = []; ` +
				`const ctx = { ui: { notify: (m, l) => notes.push({ m, l }), setStatus: () => {}, confirm: async () => true } }; ` +
				`await handleApprove(ctx, undefined, cwd, { skipAutoDoctor: true }); ` +
				// --- assertions payload ---
				`const fmOf = (p) => { const txt = readFileSync(p, "utf8"); const a = txt.match(/^artifact:\\s*(.+)$/m); const v = txt.match(/^version:\\s*(.+)$/m); return { artifact: a ? a[1].trim() : null, version: v ? v[1].trim() : null }; }; ` +
				`const designPath = join(cwd, buildGroupedPath("design", "${PROJECT}")); ` +
				`const wfPath = join(cwd, buildGroupedPath("wireframe", "${PROJECT}")); ` +
				`const db = openStoreDb(buildStoreDbPath("${PROJECT}", cwd)); ` +
				`let head = null; let diagramIds = []; ` +
				`try { ` +
				`  const h = getHeadRevision(db, runId, "design"); ` +
				`  head = h ? { revisionId: h.revisionId, revisionNumber: h.revisionNumber } : null; ` +
				`  const stored = readArtifact(db, runId, "design"); ` +
				`  diagramIds = stored ? (stored.rows.diagram ?? []).map((d) => d.id) : []; ` +
				`} finally { closeStoreDb(db); } ` +
				`process.stdout.write(JSON.stringify({ ` +
				`  designExists: existsSync(designPath), wfExists: existsSync(wfPath), ` +
				`  designFm: existsSync(designPath) ? fmOf(designPath) : null, ` +
				`  wfFm: existsSync(wfPath) ? fmOf(wfPath) : null, ` +
				`  head, diagramIds, ` +
				`  stage: loadState(cwd).currentStage, ` +
				`  errorNotes: notes.filter((n) => n.l === "error").map((n) => n.m), ` +
				`}));`,
		);

		assert.deepStrictEqual(out.errorNotes, [], `approve produced errors: ${JSON.stringify(out.errorNotes)}`);
		assert.strictEqual(out.designExists, true, "the paired design must be published to Doc/design/");
		assert.strictEqual(out.wfExists, true, "the paired wireframe must be published to Doc/design/");
		assert.strictEqual(out.designFm?.artifact, "design", "design frontmatter artifact");
		assert.strictEqual(out.wfFm?.artifact, "wireframe", "wireframe frontmatter artifact");
		assert.ok(out.designFm?.version, "design must carry a stamped version");
		assert.strictEqual(
			out.wfFm?.version,
			out.designFm?.version,
			"both targets must carry the SAME stamped version",
		);
		assert.ok(out.head, "the design kind must have a store head revision");
		assert.ok((out.head.revisionNumber ?? 0) >= 1, "head revision number must be >= 1");
		assert.ok(
			out.diagramIds.includes("WF-1"),
			`the wireframe diagram row must land in the store: ${JSON.stringify(out.diagramIds)}`,
		);
		assert.strictEqual(out.stage, "designed", "the paired publish must advance the stage");
	});

	it("2. handoff payload carries per-document version metadata + Wireframe + lanes", {
		timeout: 120_000,
	}, async (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(client && home, "test setup missing");

		const out = await runModuleScript<any>(
			client,
			`import { advanceStage, loadState } from ${STATE_JS}; ` +
				`import { runHandoff, validateSenaiSchema } from ${HANDOFF_JS}; ` +
				`import { openStoreDb, closeStoreDb } from ${DB_JS}; ` +
				`import { buildGroupedPath, buildStoreDbPath } from ${PATHS_JS}; ` +
				`import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"; ` +
				`import { join, dirname } from "node:path"; ` +
				`const cwd = process.cwd(); ` +
				`let state = loadState(cwd); ` +
				`for (const cmd of ["/velpari-atomic-function", "/velpari-atomic-function-approve", "/velpari-pseudocode", "/velpari-pseudocode-approve", "/velpari-testplan", "/velpari-testplan-approve", "/velpari-development-order", "/velpari-development-order-approve", "/velpari-final-design", "/velpari-final-design-approve"]) { ` +
				`  state = advanceStage(state, cmd, cwd); ` +
				`} ` +
				// The 8 remaining required docs (design + wireframe already
				// published in leg 1; feasibility input already on disk).
				`for (const a of ["PRD", "RTM", "atomic-functions", "pseudocode", "test-plan", "test-cases", "development-order", "final-design"]) { ` +
				`  const rel = buildGroupedPath(a, "${PROJECT}"); ` +
				`  mkdirSync(join(cwd, dirname(rel)), { recursive: true }); ` +
				`  writeFileSync(join(cwd, rel), "## section\\n\\nbody", "utf8"); ` +
				`} ` +
				// Store heads for every kind (design already has one from leg
				// 1) + the dev-lane rows the N16 lanes block renders from.
				`const runId = loadState(cwd).runId; ` +
				`const now = "2026-09-28T00:00:00.000Z"; ` +
				`const db = openStoreDb(buildStoreDbPath("${PROJECT}", cwd)); ` +
				`try { ` +
				`  for (const kind of ["prd", "rtm", "feasibility", "atomic-functions", "pseudocode", "testplan", "development-order", "final-design"]) { ` +
				`    db.prepare("INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint, inputs, change_log, status) VALUES (?, ?, 1, 'finalized-design', ?, 'f', '{}', '[]', 'published')").run(runId, kind, now); ` +
				`    const ins = db.prepare("INSERT INTO artifact_revisions (kind, run_id, revision_number, status, version, stage, generated_at, published_at, sha256_fingerprint, inputs, change_log, yaml_bytes) VALUES (?, ?, 1, 'published', 1, 'finalized-design', ?, ?, 'f', '{}', '[]', '')").run(kind, runId, now, now); ` +
				`    db.prepare("UPDATE artifacts SET head_revision_id = ? WHERE run_id = ? AND kind = ?").run(Number(ins.lastInsertRowid), runId, kind); ` +
				`  } ` +
				`  const steps = [["DO-1", "auth"], ["DO-2", "db"], ["DO-3", "api"], ["DO-4", "web"]]; ` +
				`  const stepStmt = db.prepare("INSERT INTO dev_step (run_id, kind, id, module) VALUES (?, ?, ?, ?)"); ` +
				`  for (const [id, mod] of steps) stepStmt.run(runId, "development-order", id, mod); ` +
				`  const depStmt = db.prepare("INSERT INTO step_dep (run_id, kind, step_id, depends_on_id) VALUES (?, ?, ?, ?)"); ` +
				`  depStmt.run(runId, "development-order", "DO-3", "DO-1"); ` +
				`  depStmt.run(runId, "development-order", "DO-3", "DO-2"); ` +
				`  depStmt.run(runId, "development-order", "DO-4", "DO-3"); ` +
				`  const laneStmt = db.prepare("INSERT INTO dev_lane (run_id, kind, lane_id, step_id, position, worktree, branch, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"); ` +
				`  const lanes = [ ` +
				`    ["lane-1", "DO-1", 0], ["lane-1", "DO-3", 1], ["lane-1", "DO-4", 2], ["lane-2", "DO-2", 0], ` +
				`  ]; ` +
				`  for (const [laneId, stepId, pos] of lanes) { ` +
				`    const branch = "e2efullapp/" + laneId + (laneId === "lane-1" ? "-core" : "-db"); ` +
				`    laneStmt.run(runId, "development-order", laneId, stepId, pos, branch, branch, "active"); ` +
				`  } ` +
				`} finally { closeStoreDb(db); } ` +
				`const notes = []; ` +
				`const ctx = { ui: { notify: (m, l) => notes.push({ m, l }), setStatus: () => {}, confirm: async () => true } }; ` +
				`await runHandoff(loadState(cwd), ctx, cwd); ` +
				`const payloadPath = join(cwd, ".pi", "senai", "architect-inputs.json"); ` +
				`const payload = existsSync(payloadPath) ? JSON.parse(readFileSync(payloadPath, "utf8")) : null; ` +
				`let schemaOk = null; ` +
				`if (payload) { try { schemaOk = validateSenaiSchema(payload); } catch (e) { schemaOk = String(e); } } ` +
				`const docs = payload ? payload.documents : []; ` +
				`process.stdout.write(JSON.stringify({ ` +
				`  stage: loadState(cwd).currentStage, ` +
				`  schemaOk, ` +
				`  payloadKeys: payload ? Object.keys(payload) : null, ` +
				`  docCount: docs.length, ` +
				`  docTypes: docs.map((d) => d.type), ` +
				`  docs: docs.map((d) => ({ type: d.type, version: d.version, revisionId: d.revisionId, frozen: d.frozen, freezeReason: d.freezeReason })), ` +
				`  wireframePath: (docs.find((d) => d.type === "Wireframe") || {}).path ?? null, ` +
				`  lanes: payload ? payload.lanes : null, ` +
				`  mission: payload ? payload.mission : null, ` +
				`  projectName: payload ? payload.projectName : null, ` +
				`  errorNotes: notes.filter((n) => n.l === "error").map((n) => n.m), ` +
				`}));`,
		);

		assert.deepStrictEqual(out.errorNotes, [], `handoff produced errors: ${JSON.stringify(out.errorNotes)}`);
		assert.strictEqual(out.stage, "handoff-ready", "confirmed handoff must advance to handoff-ready");
		assert.strictEqual(out.schemaOk, true, "the payload must pass validateSenaiSchema");
		assert.strictEqual(out.docCount, 11, "full-app handoff must carry 10 required docs + Wireframe");
		assert.ok(out.docTypes.includes("Wireframe"), `doc types: ${JSON.stringify(out.docTypes)}`);
		assert.ok(
			out.wireframePath && out.wireframePath.includes(`wireframe_${PROJECT}.md`),
			`Wireframe entry must name the published wireframe: ${out.wireframePath}`,
		);
		for (const doc of out.docs) {
			assert.strictEqual(typeof doc.version, "number", `${doc.type}: version must be numeric`);
			assert.strictEqual(typeof doc.revisionId, "number", `${doc.type}: revisionId must be numeric`);
			assert.strictEqual(doc.frozen, true, `${doc.type}: must be frozen in the payload (N29)`);
			assert.strictEqual(doc.freezeReason, "handoff (N4)", `${doc.type}: must carry the N4 freeze reason`);
		}
		assert.ok(out.lanes, "the N16 lanes block must be present");
		assert.strictEqual(out.lanes.lanes.length, 2, "the seeded lane map must render as 2 lanes");
		assert.ok(Array.isArray(out.lanes.lockRules) && out.lanes.lockRules.length > 0, "lanes must carry lock rules");
		assert.strictEqual(out.mission, MISSION, "mission must be unchanged");
		assert.strictEqual(out.projectName, PROJECT, "projectName must be unchanged");
	});
});

test("E2E gate: this suite is skipped when Tier 1 prerequisites are missing", () => {
	if (!tier1Enabled()) {
		// eslint-disable-next-line no-console
		console.log(`[velpari-e2e] Tier 1 skipped: ${describeTier1Skip()}`);
	}
});
