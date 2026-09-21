/**
 * Layer-2 ID coverage (A4) — publish-gate branch + doctor section tests.
 *
 * Gate (doctor/gate.ts:runPublishGate): publishing artifact X runs the
 * coverage rules where X is downstream — missing → error (blocks),
 * not-checkable → warning (D1, publish continues), duplicates → warning
 * (D2). Doctor (checks/id-coverage.ts) renders the same engine's results
 * with the matching severities.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runPublishGate } from "../../src/doctor/gate.js";
import { checkIdCoverageSection } from "../../src/doctor/checks/id-coverage.js";

let tmpDir: string;

const PRD = [
	"# PSRS",
	"",
	"## Functional Requirements",
	"",
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|---|",
	"| FR-1 | The system SHALL save | must | 1 | saved | test | proposed |",
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

function writeDoc(rel: string, content: string): void {
	const abs = path.join(tmpDir, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf8");
}

/** Declared inputs shared by the pseudocode / dev-order freshness gate. */
function seedDeclaredInputs(kind: "pseudocode" | "development-order"): void {
	writeDoc("Doc/design/design_TestApp.md", "# Design\n");
	if (kind === "development-order") {
		writeDoc("Doc/requirements/PRD_TestApp.md", "# PRD\n");
		writeDoc("Doc/requirements/RTM_TestApp.md", "# RTM\n");
		writeDoc("Doc/feasibility/feasibility-study_TestApp.md", "# Feasibility\n");
		writeDoc("Doc/pseudocode/pseudocode_TestApp.md", "# Pseudocode\n");
		writeDoc("Doc/tests/test-plan_TestApp.md", "# Test Plan\n");
		writeDoc("Doc/tests/test-cases_TestApp.md", "# Test Cases\n");
	}
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-id-coverage-gate-"));
	writeDoc(".pi/velpari/files.json", JSON.stringify({ version: 4, projectName: "TestApp" }));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runPublishGate — id-coverage branch", () => {
	it("missing AF references block a pseudocode publish with the rule id", () => {
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		seedDeclaredInputs("pseudocode");
		const gate = runPublishGate({
			artifact: "pseudocode",
			workingContent: "# Pseudocode\n\n## validateEmail\n\nAF: AF-1\n",
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.ok(
			gate.errors.some((e) => e.includes("id-coverage:af-to-pseudocode") && e.includes("AF-2")),
			`expected an id-coverage error naming AF-2, got: ${gate.errors.join(" | ")}`,
		);
	});

	it("not-checkable legacy working copy warns but does not block (D1)", () => {
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		seedDeclaredInputs("pseudocode");
		const gate = runPublishGate({
			artifact: "pseudocode",
			workingContent: "# Pseudocode\n\n## validateEmail\n\n```\ncode\n```\n",
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.equal(gate.errors.length, 0, `unexpected errors: ${gate.errors.join(" | ")}`);
		assert.ok(
			gate.warnings.some((w) => w.includes("id-coverage:af-to-pseudocode") && w.includes("not machine-checkable")),
			`expected a not-checkable warning, got: ${gate.warnings.join(" | ")}`,
		);
	});

	it("duplicate AF in a dev-order publish warns, does not block (D2)", () => {
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		seedDeclaredInputs("development-order");
		const gate = runPublishGate({
			artifact: "development-order",
			workingContent: "# Development Order\n\n## Step 1\n\nAFs: AF-1, AF-2\n\n## Step 2\n\nAFs: AF-1\n",
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.equal(gate.errors.length, 0, `unexpected errors: ${gate.errors.join(" | ")}`);
		assert.ok(
			gate.warnings.some((w) => w.includes("id-coverage:af-to-dev-order") && w.includes("AF-1")),
			`expected a duplicate warning naming AF-1, got: ${gate.warnings.join(" | ")}`,
		);
	});

	it("full coverage publishes clean", () => {
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		seedDeclaredInputs("pseudocode");
		const gate = runPublishGate({
			artifact: "pseudocode",
			workingContent: "# Pseudocode\n\n## a\n\nAF: AF-1\n\n## b\n\nAF: AF-2\n",
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.equal(gate.errors.length, 0, `unexpected errors: ${gate.errors.join(" | ")}`);
		assert.ok(!gate.warnings.some((w) => w.includes("id-coverage")), `unexpected warnings: ${gate.warnings.join(" | ")}`);
	});

	it("rule skipped when the upstream artifact is absent", () => {
		// The freshness branch still demands the declared input; the
		// ID-coverage rule itself must stay silent.
		seedDeclaredInputs("pseudocode");
		const gate = runPublishGate({
			artifact: "pseudocode",
			workingContent: "# Pseudocode\n\n## a\n\nAF: AF-1\n",
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.ok(!gate.errors.some((e) => e.includes("id-coverage")), `unexpected errors: ${gate.errors.join(" | ")}`);
		assert.ok(!gate.warnings.some((w) => w.includes("id-coverage")), `unexpected warnings: ${gate.warnings.join(" | ")}`);
	});
});

describe("checkIdCoverageSection — severity mapping", () => {
	it("missing → error, not-checkable → warning, duplicates → warning, plus summary", () => {
		writeDoc("Doc/requirements/PRD_TestApp.md", PRD);
		writeDoc("Doc/atomic-functions/atomic-functions_TestApp.md", AF_DOC);
		// design: covers nothing parseable → not-checkable (warning).
		writeDoc("Doc/design/design_TestApp.md", "# Design\n\n## 1. Module Breakdown\n\nNo tables.\n");
		// pseudocode: some refs, AF-2 missing → error.
		writeDoc("Doc/pseudocode/pseudocode_TestApp.md", "# Pseudocode\n\nAF: AF-1\n");
		// dev-order: complete but AF-1 twice → duplicate warning.
		writeDoc(
			"Doc/development-order/development-order_TestApp.md",
			"# Development Order\n\n## Step 1\n\nAFs: AF-1, AF-2\n\n## Step 2\n\nAFs: AF-1\n",
		);
		const section = checkIdCoverageSection(tmpDir);
		assert.equal(section.title, "ID coverage");
		const errors = section.items.filter((i) => i.status === "error");
		const warnings = section.items.filter((i) => i.status === "warning");
		assert.ok(
			errors.some((i) => i.message.includes("af-to-pseudocode") && i.message.includes("AF-2")),
			`expected an af-to-pseudocode error, got: ${errors.map((i) => i.message).join(" | ")}`,
		);
		assert.ok(
			warnings.some((i) => i.message.includes("prd-to-design") && i.message.includes("not machine-checkable")),
			`expected a not-checkable warning, got: ${warnings.map((i) => i.message).join(" | ")}`,
		);
		assert.ok(
			warnings.some((i) => i.message.includes("af-to-dev-order") && i.message.includes("duplicate")),
			`expected a duplicate warning, got: ${warnings.map((i) => i.message).join(" | ")}`,
		);
		const summary = section.items[section.items.length - 1]!;
		assert.match(summary.message, /uncovered \/ \d+ rule evaluation/);
	});

	it("empty cwd → ok summary, no issues", () => {
		const section = checkIdCoverageSection(tmpDir);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "ok");
		assert.match(section.items[0]!.message, /No checkable artifact pairs/);
	});
});
