/**
 * MVP coverage tests (MVP/phase traceability upgrade, Phase 4).
 *
 * Covers core/mvp-coverage.ts (the shared computation) and the doctor
 * section adapter (checks/mvp-coverage.ts):
 *   - null when inputs are missing
 *   - no-row / uncovered = error; partial / no-tests = warning
 *   - coverage counting (X/Y fully covered)
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMvpCoverage } from "../../src/core/mvp-coverage.js";
import { checkMvpCoverageSection } from "../../src/doctor/checks/mvp-coverage.js";
import type { RtmData, RtmRow } from "../../src/core/rtm-data.js";

const PSRS = [
	"# PSRS",
	"",
	"## Functional Requirements",
	"",
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|---|",
	"| FR-01 | The system SHALL save expenses | must | 1 | expense saved | Integration test | proposed |",
	"| FR-02 | The system SHOULD export CSV | should | 2 | csv downloaded | Integration test | proposed |",
	"",
	"## Non-Functional Requirements",
	"",
	"| ID | Category | Requirement | Phase | Verification | Status |",
	"|---|---|---|---|---|---|",
	"| NFR-01 | performance | p95 SHALL stay < 200ms | 1 | Performance test | proposed |",
	"",
].join("\n");

function row(id: string, overrides: Partial<RtmRow> = {}): RtmRow {
	return {
		id,
		title: id,
		phase: 1,
		design: "",
		implementation: "",
		tests: ["TC-1"],
		status: "proposed",
		coverage: "covered",
		...overrides,
	};
}

function setup(rows: RtmRow[]): string {
	const cwd = mkdtempSync(join(tmpdir(), "velpari-mvp-"));
	mkdirSync(join(cwd, "Doc", "requirements"), { recursive: true });
	writeFileSync(join(cwd, "Doc", "requirements", "PRD_TestApp.md"), PSRS);
	const data: RtmData = { project: "TestApp", version: "1.0.0", rows };
	writeFileSync(join(cwd, "Doc", "requirements", "RTM_TestApp.json"), JSON.stringify(data));
	writeFileSync(join(cwd, "Doc", "requirements", "RTM_TestApp.md"), "# RTM\n");
	return cwd;
}

describe("checkMvpCoverage", () => {
	it("returns null when the sidecar is missing", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-mvp-"));
		assert.equal(checkMvpCoverage(cwd, "TestApp"), null);
	});

	it("returns null when no Phase-1 requirements exist", () => {
		const cwd = setup([row("FR-01")]);
		writeFileSync(join(cwd, "Doc", "requirements", "PRD_TestApp.md"), PSRS.replaceAll("| 1 |", "| 2 |"));
		assert.equal(checkMvpCoverage(cwd, "TestApp"), null);
	});

	it("full coverage: 2/2 covered, no issues", () => {
		const report = checkMvpCoverage(setup([row("FR-01"), row("FR-02"), row("NFR-01")]), "TestApp");
		assert.ok(report);
		assert.equal(report.total, 2); // FR-01 + NFR-01 (FR-02 is Phase 2)
		assert.equal(report.covered, 2);
		assert.deepEqual(report.issues, []);
	});

	it("no-row is an error", () => {
		const report = checkMvpCoverage(setup([row("FR-01")]), "TestApp");
		assert.ok(report);
		assert.ok(report.issues.some((i) => i.id === "NFR-01" && i.problem === "no-row" && i.severity === "error"));
	});

	it("coverage missing is an error; partial and no-tests are warnings", () => {
		const report = checkMvpCoverage(
			setup([row("FR-01", { coverage: "missing" }), row("NFR-01", { coverage: "partial", tests: [] })]),
			"TestApp",
		);
		assert.ok(report);
		assert.ok(report.issues.some((i) => i.id === "FR-01" && i.problem === "uncovered" && i.severity === "error"));
		assert.ok(report.issues.some((i) => i.id === "NFR-01" && i.problem === "partial" && i.severity === "warning"));
		assert.ok(report.issues.some((i) => i.id === "NFR-01" && i.problem === "no-tests" && i.severity === "warning"));
		assert.equal(report.covered, 0);
	});
});

describe("checkMvpCoverageSection", () => {
	it("skips with info when inputs are missing", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-mvp-"));
		const section = checkMvpCoverageSection(cwd, "TestApp");
		assert.equal(section.items[0]!.status, "info");
	});

	it("reports ok with the coverage ratio when fully covered", () => {
		const section = checkMvpCoverageSection(setup([row("FR-01"), row("FR-02"), row("NFR-01")]), "TestApp");
		assert.equal(section.items[0]!.status, "ok");
		assert.match(section.items[0]!.message, /MVP coverage: 2\/2/);
	});

	it("reports errors with the mvp-incomplete suggestion", () => {
		const section = checkMvpCoverageSection(setup([row("FR-01")]), "TestApp");
		assert.equal(section.items[0]!.status, "error");
		assert.ok(section.items.some((i) => i.status === "error" && /NFR-01/.test(i.message)));
	});
});
