/**
 * PSRS validator tests (strict 20-section migration + status lifecycle).
 *
 * Covers:
 *   - full 20-section document with numbered headings passes clean
 *   - every one of the 20 sections is required (strict, no warnings)
 *   - Status column mandatory on FR/NFR/US/SM tables
 *   - status values restricted to the lifecycle vocabulary
 *   - duplicate ids are errors
 *   - referencedIds picks up US-/SM- references
 *   - readSectionBody tolerates numbered headings
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	findFrRowsMissingKeywords,
	readSectionBody,
	referencedIds,
	validatePsrs,
} from "../../src/core/psrs.js";

const FRONTMATTER = `---
documentType: product-software-requirements
version: 1.0.0
status: draft
profile: core-psrs-v1
profileVersion: 1.0.0
mission: Test mission
projectName: TestApp
---

# Product and Software Requirements Specification — TestApp
`;

const SECTION_BODIES: Array<[string, string]> = [
	["Objective", "One paragraph summary of the objective."],
	["Problem", "What problem this solves."],
	["System Actors", "Primary and secondary users."],
	[
		"User Stories",
		"| ID | Actor | Story | Source | Status |\n|---|---|---|---|---|\n| US-01 | user | As a user, I want to add an expense so that I can track spending. | FR-01 | proposed |",
	],
	["Scope", "In-scope and out-of-scope summary."],
	["MVP", "MVP goal, users, requirements, and exit criteria captured here."],
	[
		"Success Metrics",
		"| ID | Metric | Target | Measurement | Status |\n|---|---|---|---|---|\n| SM-01 | Weekly active users | 100 in first month | analytics dashboard | proposed |",
	],
	["Phases", "Phase 0 foundation, Phase 1 MVP, each with goals and acceptance."],
	[
		"Functional Requirements",
		"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |\n|---|---|---|---|---|---|---|\n| FR-01 | Add expense | must | 1 | expense saved | Integration test | proposed |",
	],
	[
		"Non-Functional Requirements",
		"| ID | Category | Requirement | Phase | Verification | Status |\n|---|---|---|---|---|---|\n| NFR-01 | performance | p95 < 200ms | 1 | Performance test | proposed |",
	],
	[
		"Data and Interfaces",
		"| ID | Type | Name | Requirement | Source |\n|---|---|---|---|---|\n| DATA-01 | Entity | Expense | amount + category | FR-01 |",
	],
	[
		"Errors and Edge Cases",
		"| ID | Condition | Expected Behavior |\n|---|---|---|\n| ERR-01 | amount <= 0 | reject with validation error |",
	],
	["Constraints", "1. Offline-first storage."],
	["Dependencies and Risks", "1. Depends on local filesystem access."],
	["Out of Scope", "1. Multi-currency support."],
	[
		"Open Questions",
		"| ID | Question | Impact | Owner | Status |\n|---|---|---|---|---|\n| Q-01 | Sync strategy? | medium | user | Open |",
	],
	["Acceptance Criteria", "1. FR-01 verified by integration test."],
	[
		"Helper Function Candidates",
		"| ID | Name | Purpose | Source Requirements | Inputs | Outputs | Errors | Testable |\n|---|---|---|---|---|---|---|---|\n| HF-01 | validateExpense | Validate expense data. | FR-01 | amount | validated | invalid amount | yes |",
	],
	["Glossary", "| Term | Definition |\n|---|---|\n| Expense | A single spending record. |"],
	["Change Log", "- 2026-09-12 velpari initial draft"],
];

function buildDoc(opts: {
	numbered?: boolean;
	skipSections?: string[];
	extraRows?: Partial<Record<string, string>>;
}): string {
	const parts: string[] = [FRONTMATTER];
	let n = 1;
	for (const [heading, defaultBody] of SECTION_BODIES) {
		if (opts.skipSections?.includes(heading)) continue;
		const title = opts.numbered ? `## ${n}. ${heading}` : `## ${heading}`;
		n += 1;
		parts.push(`${title}\n${opts.extraRows?.[heading] ?? defaultBody}\n`);
	}
	return parts.join("\n");
}

describe("validatePsrs — strict 20-section structure", () => {
	it("full 20-section document with numbered headings passes clean", () => {
		const result = validatePsrs(buildDoc({ numbered: true }));
		assert.equal(result.ok, true);
		assert.equal(result.errorCount, 0);
		assert.equal(result.sections["User Stories"]?.uniqueIds.length, 1);
		assert.equal(result.sections["Success Metrics"]?.uniqueIds.length, 1);
	});

	it("every one of the 20 sections is required (strict)", () => {
		for (const heading of ["User Stories", "Success Metrics", "Glossary", "Problem"]) {
			const result = validatePsrs(buildDoc({ skipSections: [heading] }));
			assert.equal(result.ok, false, `missing ${heading} must fail`);
			assert.ok(
				result.issues.some(
					(i) => i.code === "psrs-section-missing" && i.section === heading && i.severity === "error",
				),
			);
		}
	});
});

describe("validatePsrs — status lifecycle column", () => {
	it("missing Status column on the FR table is an error", () => {
		const doc = buildDoc({
			extraRows: {
				"Functional Requirements":
					"| ID | Requirement | Priority | Phase | Acceptance | Verification |\n|---|---|---|---|---|---|\n| FR-01 | Add expense | must | 1 | expense saved | Integration test |",
			},
		});
		const result = validatePsrs(doc);
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.code === "psrs-fr-status-column-missing"));
	});

	it("invalid status value is an error", () => {
		const doc = buildDoc({
			extraRows: {
				"Functional Requirements":
					"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |\n|---|---|---|---|---|---|---|\n| FR-01 | Add expense | must | 1 | expense saved | Integration test | maybe |",
			},
		});
		const result = validatePsrs(doc);
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.code === "psrs-fr-status-invalid"));
	});

	it("every lifecycle status value is accepted", () => {
		for (const status of ["proposed", "approved", "implemented", "verified", "deferred", "deprecated"]) {
			const doc = buildDoc({
				extraRows: {
					"Functional Requirements":
						`| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |\n|---|---|---|---|---|---|---|\n| FR-01 | Add expense | must | 1 | expense saved | Integration test | ${status} |`,
				},
			});
			const result = validatePsrs(doc);
			assert.equal(result.ok, true, `status ${status} must pass`);
		}
	});

	it("status is enforced on US/SM/NFR tables too", () => {
		const doc = buildDoc({
			extraRows: {
				"User Stories": "| ID | Actor | Story | Source |\n|---|---|---|---|\n| US-01 | user | story | FR-01 |",
				"Success Metrics": "| ID | Metric | Target | Measurement |\n|---|---|---|---|\n| SM-01 | m | t | x |",
				"Non-Functional Requirements":
					"| ID | Category | Requirement | Verification |\n|---|---|---|---|\n| NFR-01 | performance | fast | Performance test |",
			},
		});
		const result = validatePsrs(doc);
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.code === "psrs-us-status-column-missing"));
		assert.ok(result.issues.some((i) => i.code === "psrs-sm-status-column-missing"));
		assert.ok(result.issues.some((i) => i.code === "psrs-nfr-status-column-missing"));
	});
});

describe("validatePsrs — duplicate ids", () => {
	it("duplicate US ids are errors", () => {
		const doc = buildDoc({
			extraRows: {
				"User Stories":
					"| ID | Actor | Story | Source | Status |\n|---|---|---|---|---|\n| US-01 | user | story one | FR-01 | proposed |\n| US-01 | admin | story two | FR-01 | proposed |",
			},
		});
		const result = validatePsrs(doc);
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.code === "psrs-us-duplicate"));
	});

	it("duplicate SM ids are errors", () => {
		const doc = buildDoc({
			extraRows: {
				"Success Metrics":
					"| ID | Metric | Target | Measurement | Status |\n|---|---|---|---|---|\n| SM-01 | m1 | t1 | x | proposed |\n| SM-01 | m2 | t2 | y | proposed |",
			},
		});
		const result = validatePsrs(doc);
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.code === "psrs-sm-duplicate"));
	});
});

describe("referencedIds — US/SM prefixes", () => {
	it("picks up US and SM references", () => {
		const ids = referencedIds("see US-01 and SM-02, plus FR-03");
		assert.ok(ids.includes("US-01"));
		assert.ok(ids.includes("SM-02"));
		assert.ok(ids.includes("FR-03"));
	});
});

describe("readSectionBody — numbered headings", () => {
	it("matches both plain and numbered headings", () => {
		const plain = readSectionBody(buildDoc({}), "Objective");
		const numbered = readSectionBody(buildDoc({ numbered: true }), "Objective");
		assert.equal(plain, "One paragraph summary of the objective.");
		assert.equal(numbered, plain);
	});
});

describe("findFrRowsMissingKeywords (RFC 2119, Phase 4)", () => {
	it("flags FR rows whose requirement cell has no keyword", () => {
		const doc = buildDoc({
			extraRows: {
				"Functional Requirements":
					"| ID | Requirement | Priority | Acceptance | Verification | Status |\n|---|---|---|---|---|---|\n| FR-01 | Add expense | must | expense saved | Integration test | proposed |\n| FR-02 | When a user logs in, the system SHALL create a session | must | session created | Integration test | proposed |",
			},
		});
		assert.deepEqual(findFrRowsMissingKeywords(doc), ["FR-01"]);
	});

	it("accepts SHOULD/MAY and is case-insensitive", () => {
		const doc = buildDoc({
			extraRows: {
				"Functional Requirements":
					"| ID | Requirement | Priority | Acceptance | Verification | Status |\n|---|---|---|---|---|---|\n| FR-01 | The system SHOULD cache results | should | cache hit | Unit test | proposed |\n| FR-02 | Users MAY export data | may | csv exported | Integration test | proposed |",
			},
		});
		assert.deepEqual(findFrRowsMissingKeywords(doc), []);
	});

	it("returns empty when the FR section is absent", () => {
		assert.deepEqual(findFrRowsMissingKeywords("# bare doc\n"), []);
	});
});
