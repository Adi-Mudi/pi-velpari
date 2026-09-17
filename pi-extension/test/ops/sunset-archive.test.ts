/**
 * Sunset auto-archive test (v1.3.0+).
 *
 * Verifies that when a published design carries a `sunset:` date
 * in the past, the next `/velpari-prd-approve` invocation archives
 * the design: bumps `version:` to the next MAJOR, sets
 * `status: deprecated`, and stamps `deprecatedAt: <today>`.
 *
 * The doctor check `ShapeCompatibility` downgrades the past-sunset
 * finding from `error` to `info` once the design is archived, so
 * the second approve after auto-archive does not block.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";
import { checkShapeCompatibility } from "../../src/doctor/checks/shape-compatibility.js";

interface Notice {
	m: string;
	level: string;
}

let tmpDir: string;
let notices: Notice[];

function makeCtx(): ExtensionCommandContext {
	notices = [];
	return {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ m: message, level });
			},
			setStatus: () => {},
		},
	} as unknown as ExtensionCommandContext;
}

const PSRS = [
	"# PSRS",
	"## Functional Requirements",
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|---|",
	"| FR-01 | test | must | 1 | x | x | proposed |",
	"## Non-Functional Requirements",
	"| ID | Category | Requirement | Phase | Verification | Status |",
	"|---|---|---|---|---|---|",
	"| NFR-01 | perf | x | 1 | x | proposed |",
	"",
].join("\n");

const RTM_JSON = JSON.stringify({
	project: "TestApp",
	version: "1.0.0",
	rows: [{ id: "FR-01", title: "x", phase: 1, design: "", implementation: "", tests: [], status: "proposed", coverage: "covered" }],
});

/**
 * Build a design body with a 14-section shape (so the publish-gate
 * design-readiness check passes) and a custom version + sunset frontmatter.
 */
function designBody(version: string, sunset: string | null, status: string | null): string {
	const sections = [
		"## 0. Introduction & Goals",
		"### 0.1 Mission",
		"Test mission",
		"### 0.2 Top 3–5 Quality Goals",
		"| # | Quality Attribute | Goal | Source PRD row |",
		"|---|---|---|---|",
		"| 1 | Performance | p95 < 200ms | NFR-01 |",
		"### 0.3 Stakeholders",
		"| Stakeholder | Concern | Viewpoint |",
		"|---|---|---|",
		"| user | fast UI | Runtime |",
		"### 0.4 Architecture Constraints",
		"| Constraint | Source | Type |",
		"|---|---|---|",
		"| Linux arm64 | PRD §13 | platform |",
		"## 1. Module Breakdown",
		"| Module | Purpose | Source FRs | Maturity | Depends on |",
		"|---|---|---|---|---|",
		"| api | test | FR-01 | proposed | — |",
		"## 2. Data Model",
		"| Entity | Fields | Constraints | Notes |",
		"|---|---|---|---|",
		"| User | id, email | not null | test |",
		"## 3. Interface Contracts",
		"Function: createUser",
		"- Inputs: email",
		"- Outputs: userId",
		"- Errors: InvalidEmail",
		"## 4. Data Flow",
		"```mermaid",
		"flowchart LR",
		"  user --> api",
		"  api --> db",
		"```",
		"## 5. Quality Attribute Scenarios",
		"| NFR ID | Source | Stimulus | Environment | Artifact | Response | Response measure | Approach | Source PRD row |",
		"|---|---|---|---|---|---|---|---|---|",
		"| NFR-01 | user | save | normal | api | save | p95 | cache | NFR-01 |",
		"## 9. Context View",
		"### 9.1 Users",
		"- end user (web, fast UI)",
		"### 9.2 External Systems",
		"- stripe (REST, billing)",
		"### 9.3 Trust Boundaries",
		"- web edge (user → api, untrusted → trusted)",
		"### 9.4 Cross-boundary Data Flows",
		"- invoice (api → stripe, per day, amount, TLS)",
		"## 10. Deployment View",
		"### 10.1 Container → Host Mapping",
		"- api → k8s pod, us-east-1, 2–10",
		"### 10.2 Network Topology",
		"- public-api → api.example.com",
		"### 10.3 Scaling Boundaries",
		"- api → 10 instances max",
		"## 11. Crosscutting Concepts",
		"| Concern | Decision |",
		"|---|---|",
		"| Persistence | Postgres |",
		"## 12. Risks & Tech Debt",
		"| Risk | Impact |",
		"|---|---|",
		"| single-region | outage |",
		"## 13. Glossary",
		"| Term | Definition | Source |",
		"|---|---|---|",
		"| Task | unit of work | PRD §3.1 |",
		"## 14. Diagrams (C4)",
		"### 14.1 System Context (C4 Level 1)",
		"```mermaid",
		"C4Context",
		"  Person(user, \"End user\")",
		"  System(system, \"alpha\")",
		"```",
		"### 14.2 Container view (C4 Level 2)",
		"```mermaid",
		"C4Container",
		"```",
		"### 14.3 Component view (C4 Level 3)",
		"```mermaid",
		"C4Component",
		"```",
		"## Architecture Decisions",
	].join("\n");
	const adr = JSON.stringify({
		id: "ADR-001",
		title: "Layered",
		status: "accepted",
		stage: "design",
		date: "2026-09-14T00:00:00.000Z",
		runId: "run-test",
		context: "test",
		options: [
			{ id: "layered", label: "Layered" },
			{ id: "modular-monolith", label: "Modular" },
		],
		decision: "layered",
		rationale: "t",
		consequences: "t",
		reconsiderTriggers: ["x"],
	});
	const sunField = sunset ? `sunset: ${sunset}\n` : "";
	const statusField = status ? `status: ${status}\n` : "";
	return [
		"---",
		`version: ${version}`,
		statusField + sunField,
		"---",
		"",
		sections,
		"",
		"- ADR-001: Layered | Status: accepted | Stage: design | Date: 2026-09-14T00:00:00.000Z",
		"```yaml",
		adr,
		"```",
	].join("\n");
}

function setupCwd(designContent: string, sunset: string | null): void {
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TestApp", framework: { language: "typescript" }, codePaths: ["src"], testPaths: ["test"], docPaths: ["Doc"], excludedPaths: ["node_modules"] }),
	);
	fs.writeFileSync(path.join(tmpDir, ".pi", "velpari", "standards-profile.json"), JSON.stringify({ id: "none", version: "1.0.0", selectedAt: "x", selectedBy: "x" }));
	fs.writeFileSync(path.join(tmpDir, ".pi", "velpari", "agents.json"), JSON.stringify({ version: 1, agents: {} }));
	fs.mkdirSync(path.join(tmpDir, "Doc", "requirements"), { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "Doc", "requirements", "PRD_TestApp.md"), PSRS);
	fs.writeFileSync(path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.md"), "# RTM\n");
	fs.writeFileSync(path.join(tmpDir, "Doc", "requirements", "RTM_TestApp.json"), RTM_JSON);
	const run = createRun("TestApp", tmpDir);
	saveState(
		{
			...run,
			currentStage: "designing",
			archSubCycle: {
				developerConfirmed: true,
				confirmOutcome: "proceed",
				summaryShown: "test",
				contextLoaded: true,
				updatedAt: "2026-09-14T00:00:00.000Z",
			},
		},
		tmpDir,
	);
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", run.runId, "design");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "design_TestApp.md"), designContent);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-sunset-archive-"));
	// Escape hatch so the v1.2.1 auto-doctor does not block these
	// tests on a minimal cwd. The auto-archive logic itself is what
	// we're testing; the doctor's downstream behavior is tested in
	// the "downgrades past-sunset to info" case below (which doesn't
	// publish).
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("v1.3.0+ sunset auto-archive", () => {
	it("auto-archives when sunset is in the past", async () => {
		// Past date
		setupCwd(designBody("1.2.3", "2024-01-01", "published"), "2024-01-01");
		await handleApprove(makeCtx(), undefined, tmpDir);

		const published = path.join(tmpDir, "Doc", "design", "design_TestApp.md");
		assert.ok(fs.existsSync(published), "design was published");
		const body = fs.readFileSync(published, "utf8");

		// Version bumped to next MAJOR (1.2.3 -> 2.0.0)
		assert.match(body, /^version: 2\.0\.0$/m);
		// Status set to deprecated
		assert.match(body, /^status: deprecated$/m);
		// deprecatedAt stamped
		const today = new Date().toISOString().slice(0, 10);
		assert.match(body, new RegExp(`^deprecatedAt: ${today}$`, "m"));
		// supersedes references the old version
		assert.match(body, /^supersedes: 1\.2\.3$/m);
	});

	it("does not re-archive a design that's already deprecated", async () => {
		// Already deprecated in the working copy; the archive action
		// should not double-archive (idempotent).
		setupCwd(designBody("2.0.0", "2024-01-01", "deprecated"), "2024-01-01");
		await handleApprove(makeCtx(), undefined, tmpDir);

		const published = path.join(tmpDir, "Doc", "design", "design_TestApp.md");
		const body = fs.readFileSync(published, "utf8");
		// Version stays at 2.0.0 (no double bump).
		assert.match(body, /^version: 2\.0\.0$/m);
		// deprecatedAt is preserved (or re-stamped with today's date).
		assert.match(body, /^deprecatedAt: \d{4}-\d{2}-\d{2}$/m);
	});

	it("does not archive when sunset is in the future", async () => {
		// Future date
		setupCwd(designBody("1.2.3", "2099-01-01", "published"), "2099-01-01");
		await handleApprove(makeCtx(), undefined, tmpDir);

		const published = path.join(tmpDir, "Doc", "design", "design_TestApp.md");
		const body = fs.readFileSync(published, "utf8");
		// Version stays at 1.2.3 (no bump)
		assert.match(body, /^version: 1\.2\.3$/m);
		// Status stays published
		assert.match(body, /^status: published$/m);
		// No deprecatedAt
		assert.doesNotMatch(body, /^deprecatedAt: /m);
	});

	it("ShapeCompatibility downgrades past-sunset to info for archived designs", () => {
		// Pure unit test: archived design with past sunset emits info
		// (not error) so the auto-doctor does not re-block.
		// Set up a minimal cwd with just the published design (no
		// other artifacts).
		fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "TestApp" }),
		);
		fs.mkdirSync(path.join(tmpDir, "Doc", "design"), { recursive: true });
		const archived = `---
version: 2.0.0
status: deprecated
deprecatedAt: 2026-09-14
sunset: 2024-01-01
---

## Architecture Decisions

- ADR-001: Layered | Status: accepted | Stage: design | Date: 2026-09-14T00:00:00.000Z
`;
		fs.writeFileSync(path.join(tmpDir, "Doc", "design", "design_TestApp.md"), archived);

		const section = checkShapeCompatibility(tmpDir, "TestApp");
		// Past sunset + status:deprecated => info (not error)
		const hasError = section.items.some((i) => i.status === "error");
		assert.equal(hasError, false, "archived design should not produce errors");
	});
});
