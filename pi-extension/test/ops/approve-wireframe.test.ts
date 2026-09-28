/**
 * N26 — full-app wireframe pairing at Stage 5, exercised via handleApprove
 * (the single publish path for the velpari_stage_publish tool AND the
 * /velpari-architecture-generator-approve fall-back).
 *
 * Asserts:
 *   - (a) full-app + design working copy only → BLOCKED with the wireframe
 *     pairing message; nothing written; stage stays `designing`
 *   - (b) full-app + BOTH working copies → both published to Doc/design/,
 *     identical stamped `version`, `artifact:` fields design/wireframe,
 *     stage advances to `designed`
 *   - (c) backend (default) + design only → publishes normally, no
 *     wireframe mention anywhere in the notices (regression guard)
 *   - (d) backend + stray wireframe file → design publishes; the stray
 *     rides along without error (documented behavior)
 *   - (e) path routing: buildGroupedPath("wireframe", …) → Doc/design/
 *
 * The map-parity case (f) is pinned by test/core/upstream.test.ts, which
 * runs unchanged in the Phase 3.5 gate (both maps gained the key together).
 *
 * Fixture recipe: test/ops/approve-final-design.test.ts (state walk +
 * mock ctx + skipDbPublish) + test/integration/approve-real-cwd.test.ts
 * (design doc that passes the arch-sub-cycle / ADR / design-readiness
 * gates + feasibility declared input).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { advanceStage, clearRun, createRun, loadState, saveState } from "../../src/core/state.js";
import { buildGroupedPath } from "../../src/core/paths.js";

interface Notice {
	message: string;
	level: string;
}

let tmpDir: string;
let notices: Notice[];

function makeCtx(): ExtensionCommandContext {
	notices = [];
	return {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
			setStatus: () => {},
		},
	} as unknown as ExtensionCommandContext;
}

function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

function setupFilesConfig(extra: Record<string, unknown> = {}): void {
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TodoApp", ...extra }),
		"utf8",
	);
}

/** Walk the in-process state machine to `designing` + confirm the prelude. */
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
	// The design publish gate blocks until the architecture sub-life cycle
	// prelude was confirmed (gateArchSubCycle) — mirror handleDesign's persist.
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

/** B4: the publish gate refuses a design publish when its declared input
 *  (the published feasibility study) is missing. */
function seedFeasibilityInput(): void {
	mkdirSync(join(tmpDir, "Doc", "feasibility"), { recursive: true });
	writeFileSync(join(tmpDir, "Doc", "feasibility", "feasibility-study_TodoApp.md"), "# Feasibility\n", "utf8");
}

function workingDir(): string {
	const runId = loadState(tmpDir).runId!;
	return join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "design");
}

function seedWorkingFile(name: string, body: string): void {
	mkdirSync(workingDir(), { recursive: true });
	writeFileSync(join(workingDir(), name), body, "utf8");
}

/**
 * Full 14-section design that satisfies the publish gate
 * (arch-sub-cycle state + Architecture Decisions + §0/§0.4/§5/§9–§14
 * design-readiness). Taken from the real-cwd fixture, frontmatter
 * stripped so both pairing targets fall back to the same stamped version.
 */
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

/** Wireframe working copy per the skill's wireframe file format (N26). */
function wireframeDoc(): string {
	return [
		"# Wireframe — TodoApp",
		"",
		"## Screens",
		"",
		"```mermaid",
		"flowchart LR",
		"  home[Home] --> list[Todo list]",
		"  list --> detail[Todo detail]",
		"```",
		"",
		"## User flows",
		"",
		"1. Open app → Home.",
		"2. Home → Todo list → mark done.",
		"",
		"## Layout notes",
		"",
		"- Header with app title.",
		"- List body with one row per todo.",
		"",
		"## FR traceability",
		"",
		"| Screen | FRs |",
		"|---|---|",
		"| home | FR-01 |",
		"| list | FR-01, FR-02 |",
		"",
		"## Change Log",
		"",
		"- 1.0.0 — initial wireframes.",
		"",
	].join("\n");
}

function publishedPath(file: string): string {
	return join(tmpDir, "Doc", "design", file);
}

function frontmatterValue(content: string, key: string): string | null {
	const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
	return match?.[1]?.trim() ?? null;
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-wireframe-approve-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	// v1.2.1 opt-out for minimal-cwd test fixtures.
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("N26 — full-app wireframe pairing at Stage 5 (handleApprove)", () => {
	it("blocks a full-app design publish without its paired wireframe — nothing written, stage stays designing", async () => {
		setupFilesConfig({ projectType: "full-app" });
		walkToDesigning();
		seedFeasibilityInput();
		seedWorkingFile("design_TodoApp.md", designDoc());

		const ctx = makeCtx();
		await handleApprove(ctx, undefined, tmpDir, { skipDbPublish: true });

		const messages = allMessages();
		assert.match(
			messages,
			/paired wireframe/,
			`expected the N26 pairing message; got: ${messages}`,
		);
		assert.ok(
			messages.includes("wireframe_TodoApp.md"),
			`pairing message must name the expected path; got: ${messages}`,
		);
		assert.ok(
			!existsSync(publishedPath("design_TodoApp.md")),
			"blocked publish must write nothing",
		);
		assert.strictEqual(loadState(tmpDir).currentStage, "designing", "blocked publish must not advance");
	});

	it("publishes design + wireframe together with identical versions (full-app)", async () => {
		setupFilesConfig({ projectType: "full-app" });
		walkToDesigning();
		seedFeasibilityInput();
		seedWorkingFile("design_TodoApp.md", designDoc());
		seedWorkingFile("wireframe_TodoApp.md", wireframeDoc());

		const ctx = makeCtx();
		await handleApprove(ctx, undefined, tmpDir, { skipDbPublish: true });

		const designPath = publishedPath("design_TodoApp.md");
		const wireframePath = publishedPath("wireframe_TodoApp.md");
		assert.ok(existsSync(designPath), `expected design publish; messages: ${allMessages()}`);
		assert.ok(existsSync(wireframePath), `expected wireframe publish; messages: ${allMessages()}`);

		const designContent = readFileSync(designPath, "utf8");
		const wireframeContent = readFileSync(wireframePath, "utf8");
		assert.strictEqual(frontmatterValue(designContent, "artifact"), "design");
		assert.strictEqual(frontmatterValue(wireframeContent, "artifact"), "wireframe");
		const designVersion = frontmatterValue(designContent, "version");
		const wireframeVersion = frontmatterValue(wireframeContent, "version");
		assert.ok(designVersion, "design must carry a stamped version");
		assert.strictEqual(wireframeVersion, designVersion, "both targets must carry the SAME version");

		assert.strictEqual(loadState(tmpDir).currentStage, "designed", "paired publish must advance");
	});

	it("backend (default) publishes the design alone — no wireframe mention (regression)", async () => {
		setupFilesConfig();
		walkToDesigning();
		seedFeasibilityInput();
		seedWorkingFile("design_TodoApp.md", designDoc());

		const ctx = makeCtx();
		await handleApprove(ctx, undefined, tmpDir, { skipDbPublish: true });

		assert.ok(
			existsSync(publishedPath("design_TodoApp.md")),
			`expected design publish; messages: ${allMessages()}`,
		);
		assert.ok(!existsSync(publishedPath("wireframe_TodoApp.md")), "backend must not gain a wireframe");
		assert.ok(
			!/paired wireframe|wireframe_TodoApp|Wireframe/.test(allMessages()),
			`backend notices must not mention wireframes; got: ${allMessages()}`,
		);
		assert.strictEqual(loadState(tmpDir).currentStage, "designed");
	});

	it("backend with a stray wireframe file publishes both without error (documented)", async () => {
		setupFilesConfig();
		walkToDesigning();
		seedFeasibilityInput();
		seedWorkingFile("design_TodoApp.md", designDoc());
		seedWorkingFile("wireframe_TodoApp.md", wireframeDoc());

		const ctx = makeCtx();
		await handleApprove(ctx, undefined, tmpDir, { skipDbPublish: true });

		assert.ok(
			existsSync(publishedPath("design_TodoApp.md")),
			`expected design publish; messages: ${allMessages()}`,
		);
		assert.ok(
			existsSync(publishedPath("wireframe_TodoApp.md")),
			`stray wireframe rides along; messages: ${allMessages()}`,
		);
		assert.ok(!allMessages().includes("paired wireframe"), "no pairing block on backend");
		assert.strictEqual(loadState(tmpDir).currentStage, "designed");
	});
});

describe("N26 — path routing", () => {
	it('buildGroupedPath("wireframe", "TodoApp") routes into Doc/design/', () => {
		assert.strictEqual(buildGroupedPath("wireframe", "TodoApp"), join("Doc", "design", "wireframe_TodoApp.md"));
	});
});
