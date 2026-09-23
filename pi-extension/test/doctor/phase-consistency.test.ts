/**
 * Doctor phase-consistency check tests (MVP/phase traceability, Phase 3).
 *
 * Covers:
 *   - skip when PSRS or RTM JSON sidecar is missing
 *   - ok when RTM phases match the PRD Phase column
 *   - error when a row's phase differs from the PRD
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPhaseConsistencySection } from "../../src/doctor/checks/phase-consistency.js";
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

function row(id: string, phase: number): RtmRow {
	return {
		id,
		title: id,
		phase,
		design: "",
		implementation: "",
		tests: [],
		status: "proposed",
		coverage: "covered",
	};
}

function setup(rows: RtmRow[]): string {
	const cwd = mkdtempSync(join(tmpdir(), "velpari-phase-"));
	mkdirSync(join(cwd, "Doc", "requirements"), { recursive: true });
	writeFileSync(join(cwd, "Doc", "requirements", "PRD_TestApp.md"), PSRS);
	const data: RtmData = { project: "TestApp", version: "1.0.0", rows };
	writeFileSync(join(cwd, "Doc", "requirements", "RTM_TestApp.json"), JSON.stringify(data));
	writeFileSync(join(cwd, "Doc", "requirements", "RTM_TestApp.md"), "# RTM\n");
	return cwd;
}

describe("checkPhaseConsistencySection", () => {
	it("skips with info when the sidecar is missing", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-phase-"));
		const section = checkPhaseConsistencySection(cwd, "TestApp");
		assert.equal(section.items[0]!.status, "info");
	});

	it("reports ok when all phases match the PRD", () => {
		const section = checkPhaseConsistencySection(
			setup([row("FR-01", 1), row("FR-02", 2), row("NFR-01", 1)]),
			"TestApp",
		);
		assert.equal(section.items[0]!.status, "ok");
		assert.match(section.items[0]!.message, /3 RTM row/);
	});

	it("errors on a phase mismatch", () => {
		const section = checkPhaseConsistencySection(setup([row("FR-01", 2)]), "TestApp");
		assert.ok(section.items.some((i) => i.status === "error" && /FR-01: RTM phase 2 ≠ PRD phase 1/.test(i.message)));
	});

	it("ignores rows whose id is absent from the PRD (fingerprint check's job)", () => {
		const section = checkPhaseConsistencySection(setup([row("FR-99", 5)]), "TestApp");
		assert.equal(section.items[0]!.status, "ok");
		assert.match(section.items[0]!.message, /All 0 RTM row/);
	});
});
