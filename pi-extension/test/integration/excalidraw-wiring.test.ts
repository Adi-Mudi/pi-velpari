// Wiring — Phase F (N31): design approve (handleApprove) offers the canvas
// push at the end of a SUCCESSFUL design publish, and the export flow does
// the same. Fixture recipe: test/ops/approve-wireframe.test.ts (state walk +
// mock ctx + skipDbPublish) + approve-real-cwd.test.ts (gate-passing design
// doc). Injected launcher deps → fake MCP child, health-up fetch: no real
// npx, no network; asserts enable+push confirms, the pin on the spawn line,
// the exact mermaid diagrams on the wire, info-only notices, and that the
// publish/stage-advance outcome is unchanged.
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { handleApprove } from "../../src/ops/approve.js";
import { advanceStage, clearRun, createRun, loadState, saveState } from "../../src/core/state.js";
import { __resetCanvasSession, __setCanvasTestDeps, type CanvasFetchFn, type LauncherDeps } from "../../src/core/excalidraw.js";
import { fakeMcpChild } from "../helpers/mock-mcp.js";

let tmpDir: string;
let notices: Array<{ message: string; level: string }>;
let confirms: Array<{ title: string; message: string }>;

const okFetch: CanvasFetchFn = async () => ({
	ok: true,
	status: 200,
	json: async () => ({ status: "healthy", service: "mcp-excalidraw-canvas" }),
});

function makeCtx(answers: boolean[]): ExtensionCommandContext {
	notices = [];
	confirms = [];
	let i = 0;
	return {
		ui: {
			notify: (message: string, level: string) => notices.push({ message, level }),
			setStatus: () => {},
			confirm: async (title: string, message: string) => {
				confirms.push({ title, message });
				return answers[i++] ?? false;
			},
		},
	} as unknown as ExtensionCommandContext;
}

function setupFilesConfig(extra: Record<string, unknown> = {}): void {
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TodoApp", ...extra }),
		"utf8",
	);
}

function walkToDesigning(): void {
	clearRun(tmpDir);
	let state = createRun("Build a todo app", tmpDir);
	state = advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
	state = advanceStage(state, "/velpari-prd", tmpDir);
	state = advanceStage(state, "/velpari-prd-approve", tmpDir);
	state = advanceStage(state, "/velpari-rtm", tmpDir);
	state = advanceStage(state, "/velpari-rtm-approve", tmpDir);
	state = advanceStage(state, "/velpari-feasibility", tmpDir);
	state = advanceStage(state, "/velpari-feasibility-approve", tmpDir);
	state = advanceStage(state, "/velpari-architecture-generator", tmpDir);
	assert.strictEqual(state.currentStage, "designing");
	saveState(
		{
			...loadState(tmpDir),
			archSubCycle: {
				contextLoaded: true,
				developerConfirmed: true,
				confirmOutcome: "proceed",
				summaryShown: "test",
				updatedAt: new Date().toISOString(),
			},
		},
		tmpDir,
	);
}

function seedFeasibilityInput(): void {
	mkdirSync(join(tmpDir, "Doc", "feasibility"), { recursive: true });
	writeFileSync(join(tmpDir, "Doc", "feasibility", "feasibility-study_TodoApp.md"), "# Feasibility\n", "utf8");
}

function workingDir(): string {
	const runId = loadState(tmpDir).runId!;
	return join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "design");
}

/** Gate-passing 14-section design (recipe: approve-wireframe/real-cwd). 4 mermaid fences. */
function designDoc(): string {
	return [
		"## 0. Introduction & Goals",
		"",
		"### 0.1 Mission",
		"",
		"Build a todo app",
		"",
		"### 0.2 Top 3–5 Quality Goals",
		"",
		"| # | Quality Attribute | Goal | Source PRD row |",
		"|---|---|---|---|",
		"| 1 | Performance | p95 < 200ms | NFR-01 |",
		"",
		"### 0.3 Stakeholders",
		"",
		"| Stakeholder | Concern | Viewpoint |",
		"|---|---|---|",
		"| end user | fast UI | Runtime |",
		"",
		"### 0.4 Architecture Constraints",
		"",
		"| Constraint | Source | Type |",
		"|---|---|---|",
		"| Linux arm64 | PRD §13 | platform |",
		"",
		"## 1. Module Breakdown",
		"",
		"| Module | Purpose | Source FRs | Maturity | Depends on |",
		"|---|---|---|---|---|",
		"| auth | users | FR-01, FR-02 | proposed | — |",
		"",
		"## 2. Data Model",
		"",
		"| Entity | Fields | Constraints | Notes |",
		"|---|---|---|---|",
		"| User | id, email | not null | test |",
		"",
		"## 3. Interface Contracts",
		"",
		"Function: createUser\n",
		"- Inputs: email\n",
		"- Outputs: userId\n",
		"- Errors: InvalidEmail\n",
		"",
		"## 4. Data Flow",
		"",
		"```mermaid",
		"flowchart LR",
		"  user --> api",
		"  api --> db",
		"```",
		"",
		"## 5. Quality Attribute Scenarios",
		"",
		"| NFR ID | Source | Stimulus | Environment | Artifact | Response | Response measure | Approach | Source PRD row |",
		"|---|---|---|---|---|---|---|---|---|",
		"| NFR-01 | user | click Save | normal | api | save committed | p95 < 200ms | cache | NFR-01 |",
		"",
		"## Architecture Decisions",
		"",
		"- ADR-001: Use Layered | Status: accepted | Stage: design | Date: 2026-09-14T00:00:00.000Z",
		"```yaml",
		'{"id":"ADR-001","title":"Use Layered","status":"accepted","stage":"design","date":"2026-09-14T00:00:00.000Z","runId":"run-test","context":"test","options":[{"id":"layered","label":"Layered","pros":"simple","cons":"scaling"},{"id":"modular-monolith","label":"Modular Monolith","pros":"decomposed","cons":"files"}],"decision":"layered","rationale":"test","consequences":"test","reconsiderTriggers":["scale"]}',
		"```",
		"",
		"## 9. Context View",
		"",
		"### 9.1 Users",
		"",
		"| Persona | Access | Primary goal |",
		"|---|---|---|",
		"| end user | web | test |",
		"",
		"### 9.2 External Systems",
		"",
		"| External system | Purpose | Protocol | Auth | Data direction | Owner | SLA |",
		"|---|---|---|---|---|---|---|",
		"| stripe | billing | REST | OAuth | out | finance | 99.9% |",
		"",
		"### 9.3 Trust Boundaries",
		"",
		"| Boundary | From | To | Why the boundary exists |",
		"|---|---|---|---|",
		"| web edge | user | api | untrusted to trusted |",
		"",
		"### 9.4 Cross-boundary Data Flows",
		"",
		"| Data | From | To | Rate | Sensitive fields | Encryption |",
		"|---|---|---|---|---|---|",
		"| invoice | api | stripe | per day | amount | TLS |",
		"",
		"## 10. Deployment View",
		"",
		"### 10.1 Container → Host Mapping",
		"",
		"| Container | Host | Region / Zone | Scaling limits |",
		"|---|---|---|---|",
		"| api | k8s pod | us-east-1 | 2–10 |",
		"",
		"### 10.2 Network Topology",
		"",
		"| Network | CIDR / Endpoint | Purpose | Trust level |",
		"|---|---|---|---|",
		"| public-api | api.example.com | webhook | public |",
		"",
		"### 10.3 Scaling Boundaries",
		"",
		"| Container | Limit | Source |",
		"|---|---|---|",
		"| api | 10 instances max | NFR-01 tactic |",
		"",
		"## 11. Crosscutting Concepts",
		"",
		"| Crosscutting concern | Decision |",
		"|---|---|",
		"| Persistence | Postgres |",
		"| Logging | pino, JSON |",
		"",
		"## 12. Risks & Tech Debt",
		"",
		"| Risk / Tech debt | Impact | Mitigation | Owner | Status |",
		"|---|---|---|---|---|",
		"| single-region | outage | add second region v0.4 | platform | known |",
		"",
		"## 13. Glossary",
		"",
		"| Term | Definition | Source |",
		"|---|---|---|",
		"| Task | a unit of work | PRD §3.1 |",
		"",
		"## 14. Diagrams (C4)",
		"",
		"### 14.1 System Context (C4 Level 1)",
		"",
		"```mermaid",
		"C4Context",
		'  Person(user, "End user")',
		'  System(system, "TodoApp")',
		'  Rel(user, system, "Uses")',
		"```",
		"",
		"### 14.2 Container view (C4 Level 2)",
		"",
		"```mermaid",
		"C4Container",
		'  Person(user, "End user")',
		'  System_Boundary(c1, "TodoApp") { Container(api, "API", "Node") }',
		'  Rel(user, api, "Uses")',
		"```",
		"",
		"### 14.3 Component view (C4 Level 3)",
		"",
		"```mermaid",
		"C4Component",
		'  Container_Boundary(api, "API") { Component(c, "Core", "Node") }',
		"```",
		"",
	].join("\n");
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-excalidraw-wiring-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
	__resetCanvasSession();
	__setCanvasTestDeps(null);
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
	__resetCanvasSession();
	__setCanvasTestDeps(null);
});

describe("N31 wiring — design approve offers the canvas push", () => {
	it("successful design publish → enable + push confirms, diagrams pushed, publish outcome unchanged", async () => {
		setupFilesConfig();
		walkToDesigning();
		seedFeasibilityInput();
		mkdirSync(workingDir(), { recursive: true });
		writeFileSync(join(workingDir(), "design_TodoApp.md"), designDoc(), "utf8");

		const fake = fakeMcpChild();
		const spawns: Array<{ cmd: string; args: string[] }> = [];
		const deps: LauncherDeps = {
			detectRuntime: async () => ({ ok: true }),
			fetchImpl: okFetch,
			sleep: async () => {},
			spawn: (cmd, args) => {
				spawns.push({ cmd, args });
				return fake.child;
			},
			timeouts: { initMs: 1_000, healthPollMs: 100, healthIntervalMs: 5, pushMs: 1_000, detectMs: 1_000, killMs: 100 },
		};
		__setCanvasTestDeps(deps);

		const ctx = makeCtx([true, true]);
		await handleApprove(ctx, undefined, tmpDir, { skipDbPublish: true });

		// The canvas offer: enable + push, both asked, pin named in the enable copy.
		assert.strictEqual(confirms.length, 2, `expected enable+push confirms; notices: ${notices.map((n) => n.message).join(" | ")}`);
		assert.strictEqual(confirms[0]!.title, "Excalidraw canvas");
		assert.match(confirms[0]!.message, /mcp-excalidraw-server@2\.0\.0/);
		assert.strictEqual(confirms[1]!.title, "Push to canvas");
		assert.match(confirms[1]!.message, /4 Mermaid diagram\(s\)/, "design has 4 fences (§4 + §14.1–14.3)");

		// The push summary is info-level and reports the delivery.
		const summary = notices.find((n) => /Pushed 4 diagram\(s\)/.test(n.message));
		assert.ok(summary, `expected push summary; got: ${notices.map((n) => n.message).join(" | ")}`);
		assert.strictEqual(summary.level, "info");

		// Exact diagrams on the wire (recorded by the fake MCP child).
		const toolCalls = fake.received.filter((m) => m.method === "tools/call");
		assert.strictEqual(toolCalls.length, 4, "all 4 fences pushed");
		const diagrams = toolCalls.map((m) => (m.params as { arguments: { mermaidDiagram: string } }).arguments.mermaidDiagram);
		assert.ok(diagrams.some((d) => d.includes("C4Context")), "C4 context fence round-trips");
		assert.ok(diagrams.some((d) => d.includes("flowchart LR")), "data-flow fence round-trips");

		// Spawn used the pin; publish outcome untouched.
		assert.deepStrictEqual(spawns[0]!.args, ["-y", "mcp-excalidraw-server@2.0.0"]);
		assert.strictEqual(loadState(tmpDir).currentStage, "designed", "stage advance unchanged by the offer");
	});

	it("enable declined → publish still succeeds, no spawn, no push confirm", async () => {
		setupFilesConfig();
		walkToDesigning();
		seedFeasibilityInput();
		mkdirSync(workingDir(), { recursive: true });
		writeFileSync(join(workingDir(), "design_TodoApp.md"), designDoc(), "utf8");

		const spawns: Array<{ cmd: string; args: string[] }> = [];
		__setCanvasTestDeps({
			detectRuntime: async () => ({ ok: true }),
			fetchImpl: okFetch,
			sleep: async () => {},
			spawn: (cmd, args) => (spawns.push({ cmd, args }), fakeMcpChild().child),
			timeouts: { initMs: 500, healthPollMs: 50, healthIntervalMs: 5, pushMs: 500, detectMs: 500, killMs: 50 },
		});

		const ctx = makeCtx([false]); // decline the enable dialog
		await handleApprove(ctx, undefined, tmpDir, { skipDbPublish: true });

		assert.strictEqual(confirms.length, 1, "only the enable dialog");
		assert.strictEqual(spawns.length, 0, "no spawn without consent (§3.5)");
		assert.strictEqual(
			notices.some((n) => /Pushed/.test(n.message)),
			false,
		);
		assert.strictEqual(loadState(tmpDir).currentStage, "designed", "publish unaffected by a declined offer");
	});
});
