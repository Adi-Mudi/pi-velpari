/**
 * comparePsrs tests — the approve-time revision gate.
 *
 * Living-document rules under test (ISO/IEC/IEEE 29148 §6.5):
 *   - revision must validate clean
 *   - append-only IDs: baseline ids may not disappear
 *     (deprecate via Status, never delete)
 *   - version must strictly increase
 *   - Change Log must gain a new line
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { comparePsrs } from "../../src/core/psrs.js";

function doc(opts: { version: string; frRows: string; changelog: string[] }): string {
	return `---
documentType: product-software-requirements
version: ${opts.version}
status: draft
profile: core-psrs-v1
profileVersion: 1.0.0
mission: Test mission
projectName: TestApp
---

# Product and Software Requirements Specification — TestApp

## Objective
One paragraph summary of the objective.

## Problem
What problem this solves.

## System Actors
Primary and secondary users.

## User Stories

| ID | Actor | Story | Source | Status |
|---|---|---|---|---|
| US-01 | user | As a user, I want to add an expense so that I can track spending. | FR-01 | proposed |

## Scope
In-scope and out-of-scope summary.

## MVP
MVP goal, users, requirements, and exit criteria captured here.

## Success Metrics

| ID | Metric | Target | Measurement | Status |
|---|---|---|---|---|
| SM-01 | Weekly active users | 100 in first month | analytics dashboard | proposed |

## Phases
Phase 0 foundation, Phase 1 MVP, each with goals and acceptance.

## Functional Requirements

| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |
|---|---|---|---|---|---|---|
${opts.frRows}

## Non-Functional Requirements

| ID | Category | Requirement | Phase | Verification | Status |
|---|---|---|---|---|---|
| NFR-01 | performance | p95 < 200ms | 1 | Performance test | proposed |

## Data and Interfaces

| ID | Type | Name | Requirement | Source |
|---|---|---|---|---|
| DATA-01 | Entity | Expense | amount + category | FR-01 |

## Errors and Edge Cases

| ID | Condition | Expected Behavior |
|---|---|---|
| ERR-01 | amount <= 0 | reject with validation error |

## Constraints
1. Offline-first storage.

## Dependencies and Risks
1. Depends on local filesystem access.

## Out of Scope
1. Multi-currency support.

## Open Questions

| ID | Question | Impact | Owner | Status |
|---|---|---|---|---|
| Q-01 | Sync strategy? | medium | user | Open |

## Acceptance Criteria
1. FR-01 verified by integration test.

## Helper Function Candidates

| ID | Name | Purpose | Source Requirements | Inputs | Outputs | Errors | Testable |
|---|---|---|---|---|---|---|---|
| HF-01 | validateExpense | Validate expense data. | FR-01 | amount | validated | invalid amount | yes |

## Glossary

| Term | Definition |
|---|---|
| Expense | A single spending record. |

## Change Log
${opts.changelog.join("\n")}
`;
}

const BASELINE = doc({
	version: "1.0.0",
	frRows: "| FR-01 | Add expense | must | 1 | expense saved | Integration test | approved |",
	changelog: ["- 2026-09-01 velpari initial approval"],
});

describe("comparePsrs — revision gate", () => {
	it("clean extension revision passes (added FR, minor bump, changelog)", () => {
		const updated = doc({
			version: "1.1.0",
			frRows:
				"| FR-01 | Add expense | must | 1 | expense saved | Integration test | approved |\n" +
				"| FR-02 | Export CSV | should | 2 | file downloads | Integration test | proposed |",
			changelog: ["- 2026-09-01 velpari initial approval", "- 2026-09-12 velpari added FR-02 CSV export"],
		});
		const result = comparePsrs(BASELINE, updated);
		assert.equal(result.ok, true);
		assert.deepEqual(result.removedIds, []);
		assert.equal(result.versionFrom, "1.0.0");
		assert.equal(result.versionTo, "1.1.0");
	});

	it("removed id without deprecation is blocked", () => {
		const updated = doc({
			version: "1.1.0",
			// FR-01 deleted outright; HF-01/DATA-01 still reference it.
			frRows: "| FR-02 | Export CSV | should | 2 | file downloads | Integration test | proposed |",
			changelog: ["- 2026-09-01 velpari initial approval", "- 2026-09-12 velpari rewrote requirements"],
		});
		const result = comparePsrs(BASELINE, updated);
		assert.equal(result.ok, false);
		assert.ok(result.removedIds.includes("FR-01"));
		assert.ok(result.issues.some((i) => i.code === "psrs-compare-id-removed"));
	});

	it("removed id kept with status deprecated passes", () => {
		const updated = doc({
			version: "2.0.0",
			frRows:
				"| FR-01 | Add expense | must | 1 | expense saved | Integration test | deprecated |\n" +
				"| FR-02 | Export CSV | should | 2 | file downloads | Integration test | proposed |",
			changelog: ["- 2026-09-01 velpari initial approval", "- 2026-09-12 velpari deprecated FR-01 (feature dropped)"],
		});
		const result = comparePsrs(BASELINE, updated);
		assert.equal(result.ok, true);
		assert.deepEqual(result.removedIds, []);
	});

	it("version not bumped is blocked", () => {
		const updated = doc({
			version: "1.0.0",
			frRows:
				"| FR-01 | Add expense | must | 1 | expense saved | Integration test | approved |\n" +
				"| FR-02 | Export CSV | should | 2 | file downloads | Integration test | proposed |",
			changelog: ["- 2026-09-01 velpari initial approval", "- 2026-09-12 velpari added FR-02"],
		});
		const result = comparePsrs(BASELINE, updated);
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.code === "psrs-compare-version-not-bumped"));
	});

	it("no new changelog line is blocked", () => {
		const updated = doc({
			version: "1.1.0",
			frRows:
				"| FR-01 | Add expense | must | 1 | expense saved | Integration test | approved |\n" +
				"| FR-02 | Export CSV | should | 2 | file downloads | Integration test | proposed |",
			changelog: ["- 2026-09-01 velpari initial approval"],
		});
		const result = comparePsrs(BASELINE, updated);
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.code === "psrs-compare-changelog-missing"));
	});

	it("structurally invalid revision is blocked", () => {
		const broken = "---\ndocumentType: product-software-requirements\n---\n\n# Nothing useful\n";
		const result = comparePsrs(BASELINE, broken);
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.code === "psrs-compare-invalid"));
	});
});
