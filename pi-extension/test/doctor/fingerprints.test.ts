/**
 * Doctor fingerprint check tests (RTM traceability upgrade, Phase 3).
 *
 * Covers:
 *   - skip when PSRS or RTM JSON sidecar is missing
 *   - ok when all rows match the PSRS
 *   - error on suspect rows (requirement changed after linking)
 *   - error on orphan PSRS requirements
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFingerprintsSection } from "../../src/doctor/checks/fingerprints.js";
import { extractRequirementFingerprints, stampFingerprints } from "../../src/core/fingerprints.js";
import type { RtmData } from "../../src/core/rtm-data.js";

const PSRS = [
	"# PSRS",
	"",
	"## Functional Requirements",
	"",
	"| ID | Requirement | Priority | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|",
	"| FR-01 | Add expense | must | expense saved | Integration test | proposed |",
	"",
].join("\n");

function setup(options: { fingerprint?: string } = {}): string {
	const cwd = mkdtempSync(join(tmpdir(), "velpari-fp-"));
	mkdirSync(join(cwd, "Doc", "requirements"), { recursive: true });
	writeFileSync(join(cwd, "Doc", "requirements", "PRD_TestApp.md"), PSRS);
	const fps = extractRequirementFingerprints(PSRS);
	const rows = stampFingerprints(
		[
			{
				id: "FR-01",
				title: "Add expense",
				phase: 1,
				design: "expenses.add",
				implementation: "",
				tests: ["TC-1"],
				status: "proposed",
				coverage: "covered",
			},
		],
		fps,
	);
	if (options.fingerprint) rows[0]!.fingerprint = options.fingerprint;
	const data: RtmData = { project: "TestApp", version: "1.0.0", rows };
	writeFileSync(join(cwd, "Doc", "requirements", "RTM_TestApp.json"), JSON.stringify(data));
	writeFileSync(join(cwd, "Doc", "requirements", "RTM_TestApp.md"), "# RTM\n");
	return cwd;
}

describe("checkFingerprintsSection", () => {
	it("skips with info when the sidecar is missing", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-fp-"));
		const section = checkFingerprintsSection(cwd, "TestApp");
		assert.equal(section.items[0]!.status, "info");
	});

	it("reports ok when rows match the PSRS", () => {
		const section = checkFingerprintsSection(setup(), "TestApp");
		assert.equal(section.items[0]!.status, "ok");
	});

	it("errors on a suspect row after the requirement text changed", () => {
		const section = checkFingerprintsSection(setup({ fingerprint: "0".repeat(64) }), "TestApp");
		assert.equal(section.items[0]!.status, "error");
		assert.match(section.items[0]!.message, /changed after linking/);
	});

	it("errors on an orphan PSRS requirement", () => {
		const cwd = setup();
		writeFileSync(
			join(cwd, "Doc", "requirements", "PRD_TestApp.md"),
			PSRS.replace(
				"| FR-01 | Add expense | must | expense saved | Integration test | proposed |",
				"| FR-01 | Add expense | must | expense saved | Integration test | proposed |\n| FR-02 | List expenses | should | list shown | Unit test | proposed |",
			),
		);
		const section = checkFingerprintsSection(cwd, "TestApp");
		assert.ok(section.items.some((i) => i.status === "error" && /FR-02.*no RTM row/.test(i.message)));
	});
});
