/**
 * Doctor design-readiness tests (Phase 1 of the architecture-generator
 * upgrade plan; arc42 / SEI QAS alignment).
 *
 * Asserts gateDesignReadiness + checkDesignReadiness against synthetic
 * design bodies:
 *   - null content → no errors (no design yet)
 *   - missing §0 → error
 *   - missing §0.4 → error
 *   - missing §5 → error
 *   - empty §5 table → error
 *   - §5 row missing a required column → error
 *   - valid minimal design → 0 errors
 *   - rows with Response measure but blank → error (one per column miss)
 *
 * Plus exercises extractQAScenarioRows for the table parser.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	gateDesignReadiness,
	checkDesignReadiness,
	extractQAScenarioRows,
} from "../../src/doctor/checks/design-readiness.js";

function buildValidDesign(): string {
	return [
		"# High-Level Design — TodoApp",
		"",
		"## 0. Introduction & Goals",
		"",
		"### 0.1 Mission",
		"",
		"Deliver a todo app for freelancers.",
		"",
		"### 0.2 Top 3–5 Quality Goals",
		"",
		"| # | Quality Attribute | Goal | Source PRD row |",
		"|---|---|---|---|",
		"| 1 | Performance | p95 < 200 ms at 10k users | NFR-1 |",
		"| 2 | Availability | 99.9 % monthly | NFR-2 |",
		"| 3 | Security | OWASP Top 10 mitigated | NFR-3 |",
		"",
		"### 0.3 Stakeholders",
		"",
		"| Stakeholder | Concern | Viewpoint |",
		"|---|---|---|",
		"| end user | fast UI | Runtime |",
		"| ops | uptime | Deployment |",
		"| security | audit | Crosscutting |",
		"",
		"### 0.4 Architecture Constraints",
		"",
		"| Constraint | Source | Type |",
		"|---|---|---|",
		"| must run on Linux arm64 | PRD §13.1 | platform |",
		"| budget ≤ USD 200 / month | feasibility §3 | budget |",
		"",
		"## 1. Module Breakdown",
		"",
		"| Module | Purpose | Source FRs |",
		"|---|---|---|",
		"| auth-service | owns users | FR-1, FR-3 |",
		"| todo-service | owns tasks | FR-2 |",
		"",
		"## 5. Quality Attribute Scenarios",
		"",
		"| NFR ID | Source | Stimulus | Environment | Artifact | Response | Response measure | Approach | Source PRD row |",
		"|---|---|---|---|---|---|---|---|---|",
		"| NFR-1 | 10k concurrent users | click Save | normal load | todo-service | save committed | p95 < 200 ms 99 % of time | cache | NFR-1 |",
		"| NFR-2 | monitors | outage | degraded | auth-service | system recovers | RTO < 5 min | retry | NFR-2 |",
		"| NFR-3 | attacker | SQL injection | normal | todo-service | rejected | OWASP scan 0 high | encrypt | NFR-3 |",
		"",
		"## 9. Context View",
		"",
		"### 9.1 Users",
		"| Persona | Access | Primary goal |",
		"|---|---|---|",
		"| freelancer | web | manage tasks |",
		"",
		"### 9.2 External Systems",
		"| External system | Purpose | Protocol | Auth | Data direction | Owner | SLA |",
		"|---|---|---|---|---|---|---|",
		"| stripe | billing | REST | OAuth | out | finance | 99.95 % |",
		"",
		"### 9.3 Trust Boundaries",
		"| Boundary | From | To | Why the boundary exists |",
		"|---|---|---|---|",
		"| web edge | user | api | untrusted to trusted |",
		"",
		"### 9.4 Cross-boundary Data Flows",
		"| Data | From | To | Rate | Sensitive fields | Encryption |",
		"|---|---|---|---|---|---|",
		"| invoice | api | stripe | per day | amount, email | TLS |",
		"",
		"## 10. Deployment View",
		"",
		"### 10.1 Container → Host Mapping",
		"| Container | Host | Region / Zone | Scaling limits |",
		"|---|---|---|---|",
		"| auth-service | k8s pod | us-east-1 | 2–10 |",
		"| todo-service | k8s pod | us-east-1 | 2–10 |",
		"",
		"### 10.2 Network Topology",
		"| Network | CIDR / Endpoint | Purpose | Trust level |",
		"|---|---|---|---|",
		"| public-api | api.todo.example.com | webhook intake | public |",
		"",
		"### 10.3 Scaling Boundaries",
		"| Container | Limit | Source |",
		"|---|---|---|",
		"| auth-service | 10 instances max | NFR-1 tactic |",
		"",
		"## 11. Crosscutting Concepts",
		"| Crosscutting concern | Decision |",
		"|---|---|",
		"| Persistence | PostgreSQL via Prisma; migrations via Prisma Migrate |",
		"| Logging | pino, JSON, correlation-id header `x-request-id` |",
		"| Security — authn | OAuth 2.0 + JWT, 1h access tokens, 7d refresh |",
		"",
		"## 12. Risks & Tech Debt",
		"| Risk / Tech debt | Impact | Mitigation | Owner | Status |",
		"|---|---|---|---|---|",
		"| Single-region deploy | outages affect all users | add second region in v0.4 | platform | known |",
		"",
		"## 13. Glossary",
		"| Term | Definition | Source |",
		"|---|---|---|",
		"| Task | a unit of work owned by a user | PRD §3.1 |",
		"",
		"## 14. Diagrams (C4)",
		"",
		"### 14.1 System Context (C4 Level 1)",
		"```mermaid",
		"C4Context",
		"  title System Context — TodoApp",
		'  Person(user, "End user")',
		'  System(system, "TodoApp", "Tasks")',
		'  Rel(user, system, "Uses")',
		"```",
		"",
		"### 14.2 Container view (C4 Level 2)",
		"```mermaid",
		"C4Container",
		"  title Container view — TodoApp",
		'  Person(user, "End user")',
		'  System_Boundary(c1, "TodoApp") { Container(app, "Web app", "Node") }',
		'  Rel(user, app, "Uses")',
		"```",
		"",
		"### 14.3 Component view (C4 Level 3)",
		"```mermaid",
		"C4Component",
		"  title API components",
		'  Container(app, "Web app", "Node")',
		'  Container_Boundary(api, "API") { Component(c, "Core", "Node") }',
		'  Rel(app, c, "Calls")',
		"```",
		"",
		"## 8. Architecture Decisions",
		"",
		"- ADR-001: Use Layered Architecture | Status: accepted | Stage: design | Date: 2026-09-14T00:00:00.000Z",
		"```yaml",
		JSON.stringify(
			{
				id: "ADR-001",
				title: "Use Layered Architecture",
				status: "accepted",
				stage: "design",
				date: "2026-09-14T00:00:00.000Z",
				runId: "run-test",
				context: "Two styles fit; layering wins on team velocity.",
				options: [
					{ id: "A", label: "Layered", pros: "Simple", cons: "Harder to scale", score: "8/10" },
					{ id: "B", label: "Modular Monolith", pros: "Decomposed", cons: "More files", score: "6/10" },
				],
				decision: "layered",
				rationale: "Team is small; Layered wins on velocity.",
				consequences: "Easier to refactor later.",
				reconsiderTriggers: ["Team size > 20 engineers"],
			},
			null,
			2,
		),
		"```",
		"",
	].join("\n");
}

describe("gateDesignReadiness", () => {
	it("null content → 0 errors (no design yet)", () => {
		const errors = gateDesignReadiness(null);
		assert.equal(errors.length, 0);
	});

	it("valid design → 0 errors", () => {
		const errors = gateDesignReadiness(buildValidDesign());
		assert.equal(errors.length, 0, JSON.stringify(errors, null, 2));
	});

	it("missing §0 → error design.missing-introduction", () => {
		const md = buildValidDesign().replace(/## 0\. Introduction & Goals[\s\S]*?(?=## 1\.)/, "");
		const errors = gateDesignReadiness(md);
		assert.ok(errors.some((e) => e.code === "design.missing-introduction"));
	});

	it("missing §0.4 Architecture Constraints → error", () => {
		const md = buildValidDesign().replace(/### 0\.4 Architecture Constraints[\s\S]*?(?=## 1\.)/, "");
		const errors = gateDesignReadiness(md);
		assert.ok(errors.some((e) => e.code === "design.missing-constraints"));
	});

	it("missing §5 Quality Attribute Scenarios → error", () => {
		const md = buildValidDesign().replace(/## 5\. Quality Attribute Scenarios[\s\S]*?(?=## 8\.)/, "");
		const errors = gateDesignReadiness(md);
		assert.ok(errors.some((e) => e.code === "design.missing-qa-scenarios"));
	});

	it("empty §5 table → error", () => {
		const md =
			"# High-Level Design — X\n\n" +
			"## 0. Introduction & Goals\n\n### 0.4 Architecture Constraints\n\n## 5. Quality Attribute Scenarios\n\n" +
			"| NFR ID | Source | Stimulus | Environment | Artifact | Response | Response measure | Approach | Source PRD row |\n" +
			"|---|---|---|---|---|---|---|---|---|\n\n" +
			"## 8. Architecture Decisions\n";
		const errors = gateDesignReadiness(md);
		assert.ok(
			errors.some((e) => e.code === "design.empty-qa-table"),
			JSON.stringify(errors),
		);
	});

	it("§5 row missing Response measure → error design.qa-row-incomplete", () => {
		const md = buildValidDesign().replace(
			"| NFR-1 | 10k concurrent users | click Save | normal load | todo-service | save committed | p95 < 200 ms 99 % of time | cache | NFR-1 |",
			"| NFR-1 | 10k users | click Save | normal load | todo-service | save committed | | cache | NFR-1 |",
		);
		const errors = gateDesignReadiness(md);
		const rowErrors = errors.filter((e) => e.code === "design.qa-row-incomplete");
		assert.ok(rowErrors.length >= 1, JSON.stringify(errors));
		assert.match(rowErrors[0]?.message ?? "", /Response measure/);
	});

	it("§5 row missing Approach → error", () => {
		const md = buildValidDesign().replace(
			"| NFR-1 | 10k concurrent users | click Save | normal load | todo-service | save committed | p95 < 200 ms 99 % of time | cache | NFR-1 |",
			"| NFR-1 | 10k users | click Save | normal load | todo-service | save committed | p95 < 200 ms |  | NFR-1 |",
		);
		const errors = gateDesignReadiness(md);
		const rowErrors = errors.filter((e) => e.code === "design.qa-row-incomplete");
		assert.ok(
			rowErrors.some((e) => /Approach/.test(e.message)),
			JSON.stringify(errors),
		);
	});

	it("missing §9 Context View → error", () => {
		const md = buildValidDesign().replace(/## 9\. Context View[\s\S]*?(?=## 10\.)/, "");
		const errors = gateDesignReadiness(md);
		assert.ok(
			errors.some((e) => e.code === "design.missing-context-view"),
			JSON.stringify(errors),
		);
	});

	it("missing §10 Deployment View → error", () => {
		const md = buildValidDesign().replace(/## 10\. Deployment View[\s\S]*?(?=## 8\.)/, "");
		const errors = gateDesignReadiness(md);
		assert.ok(
			errors.some((e) => e.code === "design.missing-deployment-view"),
			JSON.stringify(errors),
		);
	});

	it("valid design (now including §9 + §10) → 0 errors", () => {
		const errors = gateDesignReadiness(buildValidDesign());
		assert.equal(errors.length, 0, JSON.stringify(errors, null, 2));
	});

	it("missing §11 Crosscutting Concepts → error", () => {
		const md = buildValidDesign().replace(/## 11\. Crosscutting Concepts[\s\S]*?(?=## 12\.)/, "");
		const errors = gateDesignReadiness(md);
		assert.ok(
			errors.some((e) => e.code === "design.missing-crosscutting"),
			JSON.stringify(errors),
		);
	});

	it("missing §12 Risks & Tech Debt → error", () => {
		const md = buildValidDesign().replace(/## 12\. Risks & Tech Debt[\s\S]*?(?=## 13\.)/, "");
		const errors = gateDesignReadiness(md);
		assert.ok(
			errors.some((e) => e.code === "design.missing-risks"),
			JSON.stringify(errors),
		);
	});

	it("missing §13 Glossary → error", () => {
		const md = buildValidDesign().replace(/## 13\. Glossary[\s\S]*?(?=## 8\.)/, "");
		const errors = gateDesignReadiness(md);
		assert.ok(
			errors.some((e) => e.code === "design.missing-glossary"),
			JSON.stringify(errors),
		);
	});

	it("complete design (§0 + §1 + §5 + §9 + §10 + §11 + §12 + §13 + §8) → 0 errors", () => {
		const errors = gateDesignReadiness(buildValidDesign());
		assert.equal(errors.length, 0, JSON.stringify(errors, null, 2));
	});
});

describe("checkDesignReadiness", () => {
	it("null content → info item", () => {
		const section = checkDesignReadiness(null);
		assert.equal(section.title, "Design readiness (Phase 1)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
	});

	it("valid design → ok item summarising every required section", () => {
		const section = checkDesignReadiness(buildValidDesign());
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /Phase-1 design sections present/);
		assert.match(section.items[0]?.message ?? "", /rows=3/);
	});

	it("missing §0 → error item list", () => {
		const md = buildValidDesign().replace(/## 0\. Introduction & Goals[\s\S]*?(?=## 1\.)/, "");
		const section = checkDesignReadiness(md);
		const errors = section.items.filter((i) => i.status === "error");
		assert.ok(errors.length >= 1);
		assert.match(errors[0]?.message ?? "", /Introduction & Goals/);
	});
});

describe("extractQAScenarioRows", () => {
	it("parses the valid design table into 3 data rows", () => {
		const rows = extractQAScenarioRows(buildValidDesign());
		assert.equal(rows.length, 3);
		assert.equal(rows[0]?.["NFR ID"], "NFR-1");
		assert.equal(rows[0]?.["Artifact"], "todo-service");
		assert.equal(rows[1]?.["Environment"], "degraded");
	});

	it("returns 0 rows when no §5 heading", () => {
		const md = "# Title\n\nSome other content with no QA table.\n";
		const rows = extractQAScenarioRows(md);
		assert.equal(rows.length, 0);
	});

	it("table content after another heading is not picked up", () => {
		const md = [
			"## 5. Quality Attribute Scenarios",
			"| NFR ID | Source | Stimulus | Environment | Artifact | Response | Response measure | Approach | Source PRD row |",
			"|---|---|---|---|---|---|---|---|---|",
			"| NFR-1 | src | stim | env | art | resp | measure | tactic | NFR-1 |",
			"",
			"## 6. Error Handling",
			"",
			"| NFR ID | Source | Stimulus | Environment | Artifact | Response | Response measure | Approach | Source PRD row |",
			"|---|---|---|---|---|---|---|---|---|",
			"| NFR-9 | src | stim | env | art | resp | measure | tactic | NFR-9 |",
		].join("\n");
		const rows = extractQAScenarioRows(md);
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.["NFR ID"], "NFR-1");
	});
});
