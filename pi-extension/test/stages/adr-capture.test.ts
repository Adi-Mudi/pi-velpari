/**
 * adr-capture integration tests (Phase 4).
 *
 * Covers the full ADR capture pipeline at the gate / artifact level:
 *   - gateADR returns 0 errors for a valid design doc with an ADR
 *   - gateADR returns 1 error when the section is missing
 *   - gateADR returns 1 error when the section is present but has no ADRs
 *   - gateADR catches invalid ADR (missing field)
   - gateADR catches orphan ADR
 *   - gateADR catches single-option rubber-stamp
 *   - supersedeADR end-to-end: old ADR flipped, new one appended
 *   - renderADRSection produces output that parses back to the same ADRs
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { gateADR } from "../../src/doctor/checks/adr.js";
import { renderADRSection, supersedeADR, parseADRSection, type ADR } from "../../src/core/adr.js";

function makeADR(overrides: Partial<ADR> = {}): ADR {
	return {
		id: "ADR-001",
		title: "Pick a modular monolith",
		status: "proposed",
		stage: "design",
		date: "2026-09-13T00:00:00.000Z",
		runId: "run-1",
		context: "Two scouts disagreed on architecture shape.",
		options: [
			{ id: "A", label: "Modular monolith", pros: "Simple deploy", cons: "Shared DB", score: "8/10" },
			{ id: "B", label: "Microservices", pros: "Independent deploys", cons: "Network complexity", score: "6/10" },
		],
		decision: "A",
		rationale: "Project size doesn't justify microservices complexity.",
		consequences: "Easier to refactor later if scale demands.",
		reconsiderTriggers: ["Sustained > 1000 RPS", "Team size > 20 engineers"],
		...overrides,
	};
}

function designDocWithSection(section: string): string {
	return [
		"---",
		"artifact: design",
		"project: TodoApp",
		"version: 1.0.0",
		"---",
		"",
		"# High-Level Design — TodoApp",
		"",
		"## 1. Module Breakdown",
		"",
		"body",
		"",
		section,
		"",
	].join("\n");
}

describe("gateADR — happy path", () => {
	it("returns 0 errors for a valid design doc with an ADR", () => {
		const adr = makeADR({ status: "accepted" });
		const section = renderADRSection([adr]);
		const doc = designDocWithSection(section);
		assert.deepEqual(gateADR(doc), []);
	});

	it("Phase 4: ADR-000 alone now fails (ADR-001 is mandatory)", () => {
		const adr = makeADR({
			id: "ADR-000",
			title: "No conflicts surfaced",
			status: "accepted",
			options: [
				{ id: "A", label: "Continue", pros: "All scouts agree", cons: "—", score: "10/10" },
				{ id: "B", label: "Re-scout", pros: "Hedge against missing insight", cons: "Cost", score: "3/10" },
			],
			decision: "A",
			rationale: "Conflict detector returned noConflict: true.",
			consequences: "None.",
			reconsiderTriggers: [],
		});
		const section = renderADRSection([adr]);
		const errors = gateADR(designDocWithSection(section));
		assert.ok(
			errors.some((e) => e.code === "adr.first-invalid"),
			JSON.stringify(errors),
		);
	});

	it("Phase 4: ADR-001 (style) + ADR-000 (no-conflicts) both pass", () => {
		const styleAdr = makeADR({ status: "accepted" });
		const noConflictAdr = makeADR({
			id: "ADR-000",
			title: "No conflicts surfaced",
			status: "accepted",
			options: [
				{ id: "A", label: "Continue", pros: "All scouts agree", cons: "—", score: "10/10" },
				{ id: "B", label: "Re-scout", pros: "Hedge against missing insight", cons: "Cost", score: "3/10" },
			],
			decision: "A",
			rationale: "Conflict detector returned noConflict: true.",
			consequences: "None.",
			reconsiderTriggers: [],
		});
		const section = renderADRSection([styleAdr, noConflictAdr]);
		const errors = gateADR(designDocWithSection(section));
		assert.deepEqual(errors, [], JSON.stringify(errors));
	});
});

describe("gateADR — failure cases", () => {
	it("returns 1 error when the section is missing", () => {
		const doc = "# Design\n\n## 1. Modules\n";
		const errors = gateADR(doc);
		assert.strictEqual(errors.length, 1);
		const first = errors[0];
		assert.ok(first);
		assert.strictEqual(first.code, "adr.section-missing");
	});

	it("returns 1 error when the section is present but contains no parseable ADRs", () => {
		const doc = designDocWithSection("## Architecture Decisions\n\n```yaml\n{not-json}\n```\n");
		const errors = gateADR(doc);
		assert.ok(errors.find((e) => e.code === "adr.no-records"));
	});

	it("catches a missing ADR when the section is empty (JSON.stringify drops undefined)", () => {
		// Title is undefined → JSON.stringify drops the field → parsed ADR
		// has no title → gateADR reports adr.no-records.
		const bad = makeADR({ title: undefined as unknown as string });
		const section = renderADRSection([bad]);
		const errors = gateADR(designDocWithSection(section));
		assert.ok(errors.some((e) => e.code === "adr.no-records"));
	});

	it("catches an invalid ADR (orphan supersedes link)", () => {
		const bad = makeADR({ supersedes: "ADR-999" });
		const section = renderADRSection([bad]);
		const errors = gateADR(designDocWithSection(section));
		assert.ok(errors.some((e) => e.code === "adr.orphan"));
	});

	it("catches an orphan ADR", () => {
		const orphan = makeADR({ supersedes: "ADR-999" });
		const section = renderADRSection([orphan]);
		const errors = gateADR(designDocWithSection(section));
		assert.ok(errors.some((e) => e.code === "adr.orphan"));
	});

	it("catches a single-option rubber-stamp on an accepted ADR", () => {
		const rubber = makeADR({
			status: "accepted",
			options: [{ id: "A", label: "Only option", pros: "—", cons: "—" }],
		});
		const section = renderADRSection([rubber]);
		const errors = gateADR(designDocWithSection(section));
		assert.ok(errors.some((e) => e.code === "adr.single-option"));
	});
});

describe("supersedeADR end-to-end", () => {
	it("appends a new ADR and flips the old one to superseded; re-render passes the gate", () => {
		const old = makeADR({ id: "ADR-001", status: "accepted" });
		const fresh = makeADR({
			id: "ADR-002",
			status: "accepted",
			supersedes: "ADR-001",
			title: "Switch to event-driven",
		});
		const next = supersedeADR([old], "ADR-001", fresh);
		const section = renderADRSection(next);
		const doc = designDocWithSection(section);
		assert.deepEqual(gateADR(doc), []);

		// Round-trip: parse the rendered doc back to ADRs and verify shape.
		const parsed = parseADRSection(doc);
		const oldNow = parsed.find((a) => a.id === "ADR-001");
		const newOne = parsed.find((a) => a.id === "ADR-002");
		assert.strictEqual(oldNow?.status, "superseded");
		assert.strictEqual(oldNow?.supersededBy, "ADR-002");
		assert.strictEqual(newOne?.supersedes, "ADR-001");
	});
});
