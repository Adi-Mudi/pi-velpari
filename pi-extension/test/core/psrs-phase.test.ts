/**
 * Phase column tests (MVP/phase traceability upgrade, Phase 1).
 *
 * The FR/NFR tables must carry a Phase column (positive integer,
 * 1 = MVP); the MVP section's "MVP Requirements" list must only name
 * Phase-1 ids; extractRequirementPhases feeds the RTM consistency check.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractMvpRequirementIds, extractRequirementPhases, validatePsrs } from "../../src/core/psrs.js";

const FR_TABLE =
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |\n" +
	"|---|---|---|---|---|---|---|\n" +
	"| FR-01 | The system SHALL save expenses | must | 1 | expense saved | Integration test | proposed |\n" +
	"| FR-02 | The system SHOULD export CSV | should | 2 | csv downloaded | Integration test | proposed |";

const NFR_TABLE =
	"| ID | Category | Requirement | Phase | Verification | Status |\n" +
	"|---|---|---|---|---|---|\n" +
	"| NFR-01 | performance | p95 SHALL stay < 200ms | 1 | Performance test | proposed |";

function doc(opts: { frTable?: string; nfrTable?: string; mvp?: string }): string {
	return [
		"# PSRS",
		"",
		"## MVP",
		"",
		opts.mvp ?? "### MVP Requirements\n- FR-01\n- NFR-01\n\n### Explicitly Not in MVP\n- FR-02 export",
		"",
		"## Functional Requirements",
		"",
		opts.frTable ?? FR_TABLE,
		"",
		"## Non-Functional Requirements",
		"",
		opts.nfrTable ?? NFR_TABLE,
		"",
	].join("\n");
}

describe("validatePsrs — Phase column", () => {
	it("missing Phase column on the FR table is an error", () => {
		const result = validatePsrs(
			doc({
				frTable:
					"| ID | Requirement | Priority | Acceptance | Verification | Status |\n" +
					"|---|---|---|---|---|---|\n" +
					"| FR-01 | The system SHALL save expenses | must | expense saved | Integration test | proposed |",
			}),
		);
		assert.ok(result.issues.some((i) => i.code === "psrs-fr-phase-column-missing"));
	});

	it("missing Phase column on the NFR table is an error", () => {
		const result = validatePsrs(
			doc({
				nfrTable:
					"| ID | Category | Requirement | Verification | Status |\n" +
					"|---|---|---|---|---|\n" +
					"| NFR-01 | performance | p95 SHALL stay < 200ms | Performance test | proposed |",
			}),
		);
		assert.ok(result.issues.some((i) => i.code === "psrs-nfr-phase-column-missing"));
	});

	it("non-integer phase values are errors", () => {
		for (const bad of ["high", "0", "-1", "1.5", ""]) {
			const result = validatePsrs(
				doc({
					frTable:
						"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |\n" +
						"|---|---|---|---|---|---|---|\n" +
						`| FR-01 | The system SHALL save expenses | must | ${bad} | expense saved | Integration test | proposed |`,
				}),
			);
			assert.ok(
				result.issues.some((i) => i.code === "psrs-fr-phase-invalid"),
				`phase "${bad}" must fail`,
			);
		}
	});

	it("valid phases pass", () => {
		const result = validatePsrs(doc({}));
		assert.ok(!result.issues.some((i) => i.code.includes("phase")));
	});
});

describe("extractRequirementPhases", () => {
	it("reads phases from both FR and NFR tables", () => {
		const phases = extractRequirementPhases(doc({}));
		assert.equal(phases.get("FR-01"), 1);
		assert.equal(phases.get("FR-02"), 2);
		assert.equal(phases.get("NFR-01"), 1);
	});

	it("skips rows with invalid phase cells", () => {
		const phases = extractRequirementPhases(
			doc({
				frTable:
					"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |\n" +
					"|---|---|---|---|---|---|---|\n" +
					"| FR-01 | The system SHALL save expenses | must | high | expense saved | Integration test | proposed |",
			}),
		);
		assert.equal(phases.has("FR-01"), false);
	});
});

describe("MVP consistency", () => {
	it("MVP-listed FR with phase 2 is an error", () => {
		const result = validatePsrs(doc({ mvp: "### MVP Requirements\n- FR-02" }));
		assert.ok(result.issues.some((i) => i.code === "psrs-mvp-phase-mismatch" && i.message.includes("FR-02")));
	});

	it("ids under 'Explicitly Not in MVP' are ignored", () => {
		// default MVP body names FR-02 under "Not in MVP"; FR-02 is Phase 2 — must NOT error
		const result = validatePsrs(doc({}));
		assert.ok(!result.issues.some((i) => i.code === "psrs-mvp-phase-mismatch"));
	});

	it("extractMvpRequirementIds reads only the MVP Requirements subsection", () => {
		const ids = extractMvpRequirementIds(doc({}));
		assert.ok(ids.includes("FR-01"));
		assert.ok(ids.includes("NFR-01"));
		assert.ok(!ids.includes("FR-02"));
	});
});
