import { test } from "node:test";
import assert from "node:assert/strict";
import {
	extractIdRows,
	extractIdsFromTable,
	findDuplicateIds,
	listHeadings,
	readFrontmatter,
	readSectionBody,
	referencedIds,
	renderPsrsSummary,
	validatePsrs,
	bodyHasPlaceholder,
} from "../src/psrs.js";

const VALID_PSRS = `---
documentType: product-software-requirements
version: 1.0.0
status: draft
profile: banking-web-v1
profileVersion: 1.0.0
mission: expense-tracker
projectName: ExpenseTracker
---

# Product and Software Requirements Specification — ExpenseTracker

## Objective
Build an expense tracker.

## Problem
Tracking expenses is hard.

## System Actors
- Individual user

## Scope
In scope: tracking expenses, monthly report.

## MVP
### MVP Goal
Smallest useful version.

### MVP Users
Primary users.

### MVP Requirements
- FR-01
- FR-02

### Explicitly Not in MVP
- Bank sync

### MVP Exit Criteria
- All FRs pass.

## Phases
### Phase 0 — Foundation
#### Goal
Foundation.

#### Requirements
- FR-01

#### Acceptance Criteria
- Tests pass.

#### Dependencies
- None.

#### Risks
- Schedule.

#### Out of Scope
- None.

### Phase 1 — MVP
#### Goal
MVP.

#### Requirements
- FR-01, FR-02

#### Acceptance Criteria
- Tests pass.

#### Dependencies
- Foundation.

#### Risks
- None.

#### Out of Scope
- Bank sync.

## Functional Requirements

| ID | Requirement | Priority | Acceptance | Verification |
|---|---|---|---|---|
| FR-01 | A user can add an expense. | must | The expense is stored. | Integration test |
| FR-02 | A user can categorize an expense. | must | The category is stored. | Integration test |

## Non-Functional Requirements

| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-01 | Performance | Monthly report < 2s. | Performance test |

## Data and Interfaces

| ID | Type | Name | Requirement | Source |
|---|---|---|---|---|
| DATA-01 | Entity | Expense | amount + category + owner + ts | FR-01 |

## Errors and Edge Cases

| ID | Condition | Expected Behavior |
|---|---|---|
| ERR-01 | amount <= 0 | reject |

## Constraints
- TypeScript only.

## Dependencies and Risks
- none significant

## Out of Scope
- Bank sync

## Open Questions

| ID | Question | Impact | Owner | Status |
|---|---|---|---|---|
| Q-01 | Offline support? | Changes scope. | PO | Open |

## Acceptance Criteria
- FR-01 pass
- NFR-01 pass

## Helper Function Candidates

| ID | Name | Purpose | Source Requirements | Inputs | Outputs | Errors | Testable |
|---|---|---|---|---|---|---|---|
| HF-01 | validateExpense | Validate expense data. | FR-01 | amount | validated data | invalid | yes |

## Change Log
- Initial PSRS draft.
`;

test("validatePsrs returns ok=true for a complete PSRS", () => {
	const result = validatePsrs(VALID_PSRS);
	assert.equal(result.ok, true, `errors: ${result.issues.map((i) => i.code).join(", ")}`);
	assert.equal(result.metadata?.profile, "banking-web-v1");
	assert.equal(result.metadata?.profileVersion, "1.0.0");
	assert.equal(result.metadata?.projectName, "ExpenseTracker");
});

test("validatePsrs detects missing required sections", () => {
	const minimal = `---\ndocumentType: psrs\nversion: 1.0.0\nstatus: draft\nprofile: p\nprofileVersion: 1.0.0\nmission: m\nprojectName: p\n---\n`;
	const result = validatePsrs(minimal);
	assert.equal(result.ok, false);
	assert.ok(result.missingRequiredSections.includes("Functional Requirements"));
	assert.ok(result.missingRequiredSections.includes("Open Questions"));
});

test("validatePsrs detects duplicate FR ids", () => {
	const body = `## Functional Requirements\n\n| ID | Requirement | Priority | Acceptance | Verification |\n|---|---|---|---|---|\n| FR-01 | A | must | a | test |\n| FR-01 | B | must | b | test |\n`;
	const result = validatePsrs(body);
	assert.ok(result.issues.some((i) => i.code === "psrs-fr-duplicate"));
	assert.equal(result.ok, false);
});

test("validatePsrs detects duplicate NFR ids", () => {
	const body = `## Non-Functional Requirements\n\n| ID | Category | Requirement | Verification |\n|---|---|---|---|\n| NFR-01 | Perf | a | test |\n| NFR-01 | Perf | b | test |\n`;
	const result = validatePsrs(body);
	assert.ok(result.issues.some((i) => i.code === "psrs-nfr-duplicate"));
});

test("validatePsrs detects duplicate HF ids", () => {
	const body = `## Helper Function Candidates\n\n| ID | Name | Purpose | Source Requirements | Inputs | Outputs | Errors | Testable |\n|---|---|---|---|---|---|---|---|\n| HF-01 | a | a | FR-01 | a | a | a | yes |\n| HF-01 | b | b | FR-02 | b | b | b | yes |\n`;
	const result = validatePsrs(body);
	assert.ok(result.issues.some((i) => i.code === "psrs-hf-duplicate"));
});

test("validatePsrs warns when a helper candidate has no source requirement", () => {
	const body = `## Helper Function Candidates\n\n| ID | Name | Purpose | Source Requirements | Inputs | Outputs | Errors | Testable |\n|---|---|---|---|---|---|---|---|\n| HF-01 | a | a | (none) | a | a | a | yes |\n`;
	const result = validatePsrs(body);
	assert.ok(result.issues.some((i) => i.code === "psrs-helper-no-source"));
});

test("validatePsrs warns when FR section is present but empty", () => {
	const body = `## Functional Requirements\n\nNo rows yet.\n`;
	const result = validatePsrs(body);
	assert.ok(result.issues.some((i) => i.code === "psrs-fr-empty"));
});

test("validatePsrs detects placeholder text in FR body", () => {
	const body = `## Functional Requirements\n\nTODO: write requirements.\n`;
	const result = validatePsrs(body);
	assert.ok(result.issues.some((i) => i.code === "psrs-fr-placeholder"));
});

test("validatePsrs warns when MVP section is too short", () => {
	const body = `## MVP\n\nTiny.\n`;
	const result = validatePsrs(body);
	assert.ok(result.issues.some((i) => i.code === "psrs-mvp-thin"));
});

test("validatePsrs warns when Phases section is too short", () => {
	const body = `## Phases\n\nshort\n`;
	const result = validatePsrs(body);
	assert.ok(result.issues.some((i) => i.code === "psrs-phases-thin"));
});

test("validatePsrs flags missing frontmatter metadata", () => {
	const body = `## Objective\nx\n`;
	const result = validatePsrs(body);
	assert.ok(result.issues.some((i) => i.code === "psrs-metadata-missing"));
	assert.equal(result.metadata, null);
});

test("validatePsrs extracts Q-ids from Open Questions", () => {
	const body = `## Open Questions\n\n| ID | Question | Impact | Owner | Status |\n|---|---|---|---|---|\n| Q-01 | A? | a | PO | Open |\n| Q-02 | B? | b | PO | Open |\n`;
	const result = validatePsrs(body);
	assert.equal(result.openQuestions.length, 2);
	assert.equal(result.openQuestions[0]?.id, "Q-01");
});

test("validatePsrs aggregates acceptance ids from acceptance + phases", () => {
	const result = validatePsrs(VALID_PSRS);
	assert.ok(result.acceptanceIds.includes("FR-01"));
	assert.ok(result.acceptanceIds.includes("NFR-01"));
	assert.ok(result.verificationIds.includes("FR-01"));
});

test("readFrontmatter parses scalar key/value pairs", () => {
	const fm = readFrontmatter("---\nkey1: value1\nkey2: value2\n---\nbody");
	assert.equal(fm.key1, "value1");
	assert.equal(fm.key2, "value2");
});

test("readFrontmatter returns empty when no frontmatter", () => {
	assert.deepEqual(readFrontmatter("# no frontmatter\n"), {});
});

test("listHeadings returns H2 headings in order, skips H1", () => {
	const headings = listHeadings("# H1\n## A\n## B\nbody\n");
	assert.deepEqual(headings, ["A", "B"]);
});

test("listHeadings skips frontmatter", () => {
	const md = "---\ntitle: foo\n---\n# H1\n## Real\n";
	assert.deepEqual(listHeadings(md), ["Real"]);
});

test("readSectionBody returns body text of a section", () => {
	const md = "## X\n\nbody\n\n## Y\nother\n";
	assert.match(readSectionBody(md, "X"), /body/);
	assert.equal(readSectionBody(md, "Z"), "");
});

test("extractIdsFromTable matches row first columns by prefix", () => {
	const rows = extractIdsFromTable("| FR-01 | A | x |\n| FR-02 | B | y |", ["FR-"]);
	assert.equal(rows.length, 2);
	assert.equal(rows[0]?.id, "FR-01");
	assert.equal(rows[0]?.title, "A");
});

test("extractIdsFromTable ignores rows that do not start with the prefix", () => {
	const rows = extractIdsFromTable("| NFR-01 | x |\n| FR-01 | y |", ["FR-"]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.id, "FR-01");
});

test("extractIdRows returns full row data", () => {
	const rows = extractIdRows("| Q-01 | Foo | open |", ["Q-"]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.rest.join("|"), "Foo|open");
});

test("findDuplicateIds returns duplicates sorted", () => {
	assert.deepEqual(findDuplicateIds(["a", "b", "a", "c", "b"]), ["a", "b"]);
	assert.deepEqual(findDuplicateIds(["a", "b", "c"]), []);
});

test("referencedIds finds FR/NFR/HF/ERR/DATA/IF/Q tokens", () => {
	const ids = referencedIds("see FR-01, FR-02 and HF-01 vs Q-03");
	assert.ok(ids.includes("FR-01"));
	assert.ok(ids.includes("FR-02"));
	assert.ok(ids.includes("HF-01"));
	assert.ok(ids.includes("Q-03"));
});

test("bodyHasPlaceholder flags common placeholder hints", () => {
	assert.equal(bodyHasPlaceholder("TODO: write more"), true);
	assert.equal(bodyHasPlaceholder("see TBD notes"), true);
	assert.equal(bodyHasPlaceholder("Real prose without markers."), false);
});

test("renderPsrsSummary includes header and issues", () => {
	const result = validatePsrs(VALID_PSRS);
	const summary = renderPsrsSummary(result);
	assert.match(summary, /PSRS validation:/);
	assert.match(summary, /Profile: banking-web-v1/);
});