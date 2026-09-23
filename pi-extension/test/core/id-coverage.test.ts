/**
 * Layer-2 ID coverage (A4) — core/id-coverage.ts tests.
 *
 * Per-rule coverage: full coverage → ok; missing downstream ids → missing
 * with the exact id list; zero parseable refs → not-checkable (D1);
 * duplicate AF in dev-order → duplicateIds (D2); design §7 prose never
 * scanned (D4); missing upstream/downstream artifact → rule skipped.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { COVERAGE_RULES, checkIdCoverage, extractIds } from "../../src/core/id-coverage.js";

let tmpDir: string;

const PRD = [
	"# PSRS",
	"",
	"## Functional Requirements",
	"",
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|---|",
	"| FR-1 | The system SHALL save | must | 1 | saved | test | proposed |",
	"| FR-2 | The system SHALL list | must | 1 | listed | test | proposed |",
	"",
	"## Non-Functional Requirements",
	"",
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|---|",
	"| NFR-1 | The system SHALL be fast | must | 1 | fast | test | proposed |",
	"",
].join("\n");

const AF_DOC = [
	"# Atomic Functions",
	"",
	"## Atomic Functions",
	"",
	"| AF ID | Name | File Path |",
	"|---|---|---|",
	"| AF-1 | validateEmail | src/utils/validate-email.ts |",
	"| AF-2 | saveExpense | src/core/save-expense.ts |",
	"",
].join("\n");

function designDoc(sourceFrs: string, nfrId: string, sourcePrdRow: string): string {
	return [
		"# Design",
		"",
		"## 1. Module Breakdown",
		"",
		"| Module | Purpose | Source FRs | Maturity | Depends on |",
		"|---|---|---|---|---|",
		`| core | does things | ${sourceFrs} | proposed | — |`,
		"",
		"## 5. Quality Attribute Scenarios",
		"",
		"| NFR ID | Source | Stimulus | Environment | Artifact | Response | Response measure | Approach | Source PRD row |",
		"|---|---|---|---|---|---|---|---|---|",
		`| ${nfrId} | user | spike | peak | core | scales | 100rps | tactic | ${sourcePrdRow} |`,
		"",
		"## 7. Traceability",
		"",
		"Prose only — no ids here.",
		"",
	].join("\n");
}

function writeDoc(rel: string, content: string): void {
	const abs = path.join(tmpDir, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf8");
}

function seedConfig(): void {
	writeDoc(".pi/velpari/files.json", JSON.stringify({ version: 4, projectName: "TestApp" }));
}

function resultsFor(ruleId: string) {
	return checkIdCoverage(tmpDir).results.filter((r) => r.rule.id === ruleId);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-id-coverage-"));
	seedConfig();
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("extractIds", () => {
	it("finds prefixed ids, keeps duplicates, ignores lookalikes", () => {
		const text = "FR-1 and NFR-2, AF-3 again FR-1; not AFR-9 or FR- or XFR-4";
		assert.deepEqual(extractIds(text, ["FR", "NFR", "AF"]), ["FR-1", "NFR-2", "AF-3", "FR-1"]);
		assert.deepEqual(extractIds("", ["FR"]), []);
		assert.deepEqual(extractIds(text, []), []);
	});
});

describe("checkIdCoverage — prd-to-design", () => {
	it("ok when every FR/NFR appears in §1 + §5", () => {
		writeDoc("Doc/requirements/PRD_TestApp.md", PRD);
		writeDoc("Doc/design/design_TestApp.md", designDoc("FR-1, FR-2", "NFR-1", "NFR-1"));
		const results = resultsFor("prd-to-design");
		assert.equal(results.length, 1);
		assert.equal(results[0]!.status, "ok");
		assert.deepEqual(results[0]!.missingIds, []);
	});

	it("missing lists the exact uncovered upstream ids", () => {
		writeDoc("Doc/requirements/PRD_TestApp.md", PRD);
		writeDoc("Doc/design/design_TestApp.md", designDoc("FR-1", "NFR-1", "NFR-1"));
		const results = resultsFor("prd-to-design");
		assert.equal(results[0]!.status, "missing");
		assert.deepEqual(results[0]!.missingIds, ["FR-2"]);
	});

	it("not-checkable when the design carries zero parseable refs (D1)", () => {
		writeDoc("Doc/requirements/PRD_TestApp.md", PRD);
		writeDoc("Doc/design/design_TestApp.md", "# Design\n\n## 1. Module Breakdown\n\nNo tables yet.\n");
		assert.equal(resultsFor("prd-to-design")[0]!.status, "not-checkable");
	});

	it("D4: ids in §7 Traceability prose do not count", () => {
		writeDoc("Doc/requirements/PRD_TestApp.md", PRD);
		const design = designDoc("—", "—", "—").replace(
			"Prose only — no ids here.",
			"FR-1, FR-2, NFR-1 are traced in prose.",
		);
		writeDoc("Doc/design/design_TestApp.md", design);
		assert.equal(resultsFor("prd-to-design")[0]!.status, "not-checkable");
	});

	it("resolves legacy flat Doc layout too", () => {
		writeDoc("Doc/PRD_TestApp.md", PRD);
		writeDoc("Doc/design_TestApp.md", designDoc("FR-1, FR-2", "NFR-1", "NFR-1"));
		const results = resultsFor("prd-to-design");
		assert.equal(results.length, 1);
		assert.equal(results[0]!.status, "ok");
	});
});

describe("checkIdCoverage — af-to-pseudocode", () => {
	it("ok / missing by AF reference", () => {
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		writeDoc(
			"Doc/pseudocode/pseudocode_TestApp.md",
			"# Pseudocode\n\n## validateEmail\n\nAF: AF-1\n\n```\nfunction ...\n```\n",
		);
		const results = resultsFor("af-to-pseudocode");
		assert.equal(results[0]!.status, "missing");
		assert.deepEqual(results[0]!.missingIds, ["AF-2"]);
	});

	it("not-checkable for a pre-A4 pseudocode doc (no AF refs)", () => {
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		writeDoc("Doc/pseudocode/pseudocode_TestApp.md", "# Pseudocode\n\n## validateEmail\n\n```\ncode\n```\n");
		assert.equal(resultsFor("af-to-pseudocode")[0]!.status, "not-checkable");
	});

	it("D7: AF ids come from the sidecar when one exists (sidecar-first)", () => {
		// The markdown lists only AF-1; the sidecar is the source of
		// truth and lists AF-1..AF-3 — the check must demand all three.
		writeDoc(
			"Doc/atomic-functions/atomic-functions_TestApp.md",
			"# Atomic Functions\n\n| AF ID | Name |\n|---|---|\n| AF-1 | validateEmail |\n",
		);
		writeDoc(
			"Doc/atomic-functions/atomic-functions_TestApp.yaml",
			[
				"project: TestApp",
				"version: 1.0.0",
				"functions:",
				"  - afId: AF-1",
				"  - afId: AF-2",
				"  - afId: AF-3",
				"",
			].join("\n"),
		);
		writeDoc("Doc/pseudocode/pseudocode_TestApp.md", "# Pseudocode\n\n## validateEmail\n\nAF: AF-1\n");
		const results = resultsFor("af-to-pseudocode");
		assert.equal(results[0]!.status, "missing");
		assert.deepEqual(results[0]!.missingIds, ["AF-2", "AF-3"]);
	});

	it("D7: malformed sidecar falls back to markdown scraping", () => {
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.yaml", "not: [an af doc]\n");
		writeDoc("Doc/pseudocode/pseudocode_TestApp.md", "# Pseudocode\n\n## validateEmail\n\nAF: AF-1\n");
		const results = resultsFor("af-to-pseudocode");
		assert.equal(results[0]!.status, "missing");
		assert.deepEqual(results[0]!.missingIds, ["AF-2"]);
	});
});

describe("checkIdCoverage — fr-af-to-test-cases", () => {
	it("covers FR and AF upstreams together", () => {
		writeDoc("Doc/requirements/PRD_TestApp.md", PRD);
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		writeDoc(
			"Doc/tests/test-cases_TestApp.md",
			[
				"# Test Cases",
				"",
				"| TC ID | Name | Traces |",
				"|---|---|---|",
				"| TC-1 | saves | FR-1, AF-2 |",
				"| TC-2 | lists | FR-2 |",
				"",
			].join("\n"),
		);
		const results = resultsFor("fr-af-to-test-cases");
		assert.equal(results[0]!.status, "missing");
		assert.deepEqual(results[0]!.missingIds, ["AF-1"]);
	});

	it("rule skipped when an upstream artifact is absent", () => {
		writeDoc("Doc/requirements/PRD_TestApp.md", PRD);
		writeDoc("Doc/tests/test-cases_TestApp.md", "# Test Cases\n\n| TC ID | Traces |\n|---|---|\n| TC-1 | FR-1 |\n");
		assert.equal(resultsFor("fr-af-to-test-cases").length, 0);
	});
});

describe("checkIdCoverage — af-to-dev-order", () => {
	it("missing = error status, duplicate AF = duplicateIds warning (D2)", () => {
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		writeDoc(
			"Doc/development-order/development-order_TestApp.md",
			"# Development Order\n\n## Step 1\n\nAFs: AF-1\n\n## Step 2\n\nAFs: AF-1\n",
		);
		const results = resultsFor("af-to-dev-order");
		assert.equal(results[0]!.status, "missing");
		assert.deepEqual(results[0]!.missingIds, ["AF-2"]);
		assert.deepEqual(results[0]!.duplicateIds, ["AF-1"]);
	});

	it("clean DAG → ok, no duplicates", () => {
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		writeDoc(
			"Doc/development-order/development-order_TestApp.md",
			"# Development Order\n\n## Step 1\n\nAFs: AF-1\n\n## Step 2\n\nAFs: AF-2\n",
		);
		const results = resultsFor("af-to-dev-order");
		assert.equal(results[0]!.status, "ok");
		assert.deepEqual(results[0]!.duplicateIds, []);
	});
});

describe("checkIdCoverage — skips", () => {
	it("no artifacts → empty report", () => {
		assert.deepEqual(checkIdCoverage(tmpDir).results, []);
	});

	it("downstream without upstream → rule skipped, not an issue", () => {
		writeDoc("Doc/design/design_TestApp.md", designDoc("FR-1", "NFR-1", "NFR-1"));
		assert.equal(resultsFor("prd-to-design").length, 0);
	});
});

describe("COVERAGE_RULES", () => {
	it("declares the 4 A4 rules with distinct ids", () => {
		assert.equal(COVERAGE_RULES.length, 4);
		assert.equal(new Set(COVERAGE_RULES.map((r) => r.id)).size, 4);
	});
});
