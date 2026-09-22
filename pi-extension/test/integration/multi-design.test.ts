/**
 * Multi-design integration test (v1.3.0+).
 *
 * Sets up a federation CWD with two projectNames, runs the
 * architecture-stage approve cycle for project A, then again for
 * project B. Verifies that the per-design publish path produces
 * two separate Doc/<artifact>_<projectName>.md files, each stamped
 * with the right projectName and version.
 *
 * Per the v1.3.0 plan: the existing per-stage flow runs unchanged;
 * the prelude persists the chosen projectName in
 * state.archSubCycle.projectName; the publish path uses it.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";

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

const RTM_JSON = (frId: string) =>
	JSON.stringify({
		project: "Federation",
		version: "1.0.0",
		rows: [
			{ id: frId, title: "x", phase: 1, design: "", implementation: "", tests: [], status: "proposed", coverage: "covered" },
		],
	});

const DESIGN_BODY = (projectName: string, version: string) => {
	const adr = JSON.stringify({
		id: "ADR-001",
		title: `Style for ${projectName}`,
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
	return [
		"---",
		`version: ${version}`,
		"---",
		"",
		"## 0. Introduction & Goals",
		"",
		"### 0.1 Mission",
		"",
		"Test",
		"",
		"### 0.2 Top 3–5 Quality Goals",
		"",
		"| # | Quality Attribute | Goal | Source PRD row |",
		"|---|---|---|---|",
		"| 1 | perf | p95 < 200ms | NFR-01 |",
		"",
		"### 0.3 Stakeholders",
		"",
		"| Stakeholder | Concern | Viewpoint |",
		"|---|---|---|",
		"| user | fast | Runtime |",
		"",
		"### 0.4 Architecture Constraints",
		"",
		"| Constraint | Source | Type |",
		"|---|---|---|",
		"| Linux | PRD | platform |",
		"",
		"## 1. Module Breakdown",
		"",
		"| Module | Purpose | Source FRs | Maturity | Depends on |",
		"|---|---|---|---|---|",
		"| api | test | FR-01 | proposed | — |",
		"",
		"## 2. Data Model",
		"",
		"| Entity | Fields | Constraints | Notes |",
		"|---|---|---|---|",
		"| User | id, email | not null | test |",
		"",
		"## 3. Interface Contracts",
		"",
		"Function: createUser",
		"- Inputs: email",
		"- Outputs: userId",
		"- Errors: InvalidEmail",
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
		"| NFR-01 | user | save | normal | api | save | p95 | cache | NFR-01 |",
		"",
		"## Architecture Decisions",
		"",
		`- ADR-001: ${projectName} style | Status: accepted | Stage: design | Date: 2026-09-14T00:00:00.000Z`,
		"```yaml",
		adr,
		"```",
		"",
		"## 9. Context View",
		"",
		"External: stripe",
		"",
		"## 10. Deployment View",
		"",
		"Container: api",
		"",
		"## 11. Crosscutting Concepts",
		"",
		"Logging: pino",
		"",
		"## 12. Risks & Tech Debt",
		"",
		"single-region: outage",
		"",
		"## 13. Glossary",
		"",
		"Task: work",
		"",
		"## 14. Diagrams (C4)",
		"",
		"```mermaid",
		"C4Context",
		"```",
		"",
		"```mermaid",
		"C4Container",
		"```",
		"",
		"```mermaid",
		"C4Component",
		"```",
	].join("\n");
};

/** Build the federation cwd (projectNames = [alpha, beta]). */
function setupFederationCwd(): void {
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({
			version: 4,
			projectName: "",
			projectNames: ["alpha", "beta"],
			framework: { language: "typescript" },
			codePaths: ["src"],
			testPaths: ["test"],
			docPaths: ["Doc"],
			excludedPaths: ["node_modules"],
		}),
	);
	fs.writeFileSync(path.join(tmpDir, ".pi", "velpari", "standards-profile.json"), JSON.stringify({ id: "none", version: "1.0.0", selectedAt: "x", selectedBy: "x" }));
	fs.writeFileSync(path.join(tmpDir, ".pi", "velpari", "agents.json"), JSON.stringify({ version: 1, agents: {} }));

	fs.mkdirSync(path.join(tmpDir, "Doc", "requirements"), { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "Doc", "requirements", "PRD_alpha.md"), PSRS);
	fs.writeFileSync(path.join(tmpDir, "Doc", "requirements", "RTM_alpha.md"), "# RTM\n");
	fs.writeFileSync(path.join(tmpDir, "Doc", "requirements", "RTM_alpha.json"), RTM_JSON("FR-01"));
	fs.writeFileSync(path.join(tmpDir, "Doc", "requirements", "RTM_beta.md"), "# RTM\n");
	fs.writeFileSync(path.join(tmpDir, "Doc", "requirements", "RTM_beta.json"), RTM_JSON("FR-01"));
	// B4: the publish gate refuses a design publish when its declared input
	// (the published feasibility study) is missing.
	fs.mkdirSync(path.join(tmpDir, "Doc", "feasibility"), { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "Doc", "feasibility", "feasibility-study_alpha.md"), "# Feasibility\n");
	fs.writeFileSync(path.join(tmpDir, "Doc", "feasibility", "feasibility-study_beta.md"), "# Feasibility\n");
}

function enterBuildingRtmFor(projectName: string, frId: string): void {
	const run = createRun("Federation", tmpDir);
	// v1.3.0+ multi-design: the architecture sub-life cycle prelude must
	// confirm the developer AND record the chosen projectName so the
	// publish path uses it. The state shape carries developerConfirmed
	// (required by the publish gate) + projectName (v1.3.0+).
	saveState(
		{
			...run,
			currentStage: "designed",
			archSubCycle: {
				developerConfirmed: true,
				confirmOutcome: "proceed",
				summaryShown: "test",
				contextLoaded: true,
				projectName,
				updatedAt: new Date().toISOString(),
			},
		},
		tmpDir,
	);
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", run.runId, "design");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `design_${projectName}.md`), DESIGN_BODY(projectName, "1.2.3"));
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-multi-design-"));
	// v1.2.1 escape hatch OFF for the integration test.
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("/velpari-architecture-generator end-to-end on a federation", () => {
	it("publishes per-projectName designs as separate Doc files", async () => {
		setupFederationCwd();
		// Publish the alpha design.
		enterBuildingRtmFor("alpha", "FR-01");
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });
		// Publish the beta design.
		enterBuildingRtmFor("beta", "FR-01");
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		// Both designs exist on disk as separate files.
		const alphaPath = path.join(tmpDir, "Doc", "design", "design_alpha.md");
		const betaPath = path.join(tmpDir, "Doc", "design", "design_beta.md");
		assert.ok(fs.existsSync(alphaPath), `expected alpha design at ${alphaPath}`);
		assert.ok(fs.existsSync(betaPath), `expected beta design at ${betaPath}`);

		// Each is stamped with the right projectName in its body.
		const alphaBody = fs.readFileSync(alphaPath, "utf8");
		const betaBody = fs.readFileSync(betaPath, "utf8");
		assert.match(alphaBody, /version: 1\.2\.3/);
		assert.match(betaBody, /version: 1\.2\.3/);
		// Neither has the wrong projectName in its body.
		assert.doesNotMatch(alphaBody, /Style for beta/);
		assert.doesNotMatch(betaBody, /Style for alpha/);
	});
});
