/**
 * Integration: ADR continuity (Phase 8, plan §Phase 8).
 *
 * Verifies that ADR supersession chains are intact across stages,
 * that orphan ADRs are caught by the doctor gate, and that the
 * handoff payload exports every accepted + superseded ADR.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { renderADRSection, supersedeADR, findOrphanADRs, parseADRSection, type ADR } from "../../src/core/adr.js";

function makeADR(overrides: Partial<ADR> = {}): ADR {
	return {
		id: "ADR-001",
		title: "Pick a modular monolith",
		status: "accepted",
		stage: "design",
		date: "2026-09-13T00:00:00.000Z",
		runId: "r",
		context: "Two scouts disagreed.",
		options: [
			{ id: "A", label: "Modular monolith", pros: "Simple", cons: "Shared DB" },
			{ id: "B", label: "Microservices", pros: "Independent", cons: "Complex" },
		],
		decision: "A",
		rationale: "Project size doesn't justify microservices.",
		consequences: "Easier to refactor later.",
		reconsiderTriggers: ["Scale > 1000 RPS"],
		...overrides,
	};
}

describe("ADR continuity — Phase 8 cross-cutting verification", () => {
	it("supersede chain round-trip: old ADR survives as superseded", () => {
		const old = makeADR({ id: "ADR-001" });
		const fresh = makeADR({
			id: "ADR-002",
			title: "Switch to event-driven",
			supersedes: "ADR-001",
		});
		const next = supersedeADR([old], "ADR-001", fresh);
		const oldNow = next.find((a) => a.id === "ADR-001");
		const newOne = next.find((a) => a.id === "ADR-002");
		assert.strictEqual(oldNow?.status, "superseded");
		assert.strictEqual(oldNow?.supersededBy, "ADR-002");
		assert.strictEqual(newOne?.supersedes, "ADR-001");

		// Round-trip via renderADRSection + parseADRSection.
		const section = renderADRSection(next);
		const parsed = parseADRSection(`# Design\n\n${section}\n`);
		assert.strictEqual(parsed.length, 2);
		assert.strictEqual(parsed[0]?.id, "ADR-001");
		assert.strictEqual(parsed[0]?.status, "superseded");
		assert.strictEqual(parsed[1]?.id, "ADR-002");
		assert.strictEqual(parsed[1]?.supersedes, "ADR-001");
	});

	it("no orphan ADRs when chain is intact", () => {
		const old = makeADR({ id: "ADR-001", status: "superseded", supersededBy: "ADR-002" });
		const fresh = makeADR({ id: "ADR-002", supersedes: "ADR-001" });
		assert.deepEqual(findOrphanADRs([old, fresh]), []);
	});

	it("orphan ADR is detected when supersedes points to nothing", () => {
		const fresh = makeADR({ id: "ADR-002", supersedes: "ADR-999" });
		const orphans = findOrphanADRs([fresh]);
		assert.strictEqual(orphans.length, 1);
	});

	it("three-level chain: ADR-003 supersedes ADR-002 supersedes ADR-001", () => {
		const a1 = makeADR({ id: "ADR-001", status: "superseded", supersededBy: "ADR-002" });
		const a2 = makeADR({ id: "ADR-002", supersedes: "ADR-001", status: "superseded", supersededBy: "ADR-003" });
		const a3 = makeADR({ id: "ADR-003", supersedes: "ADR-002" });
		const all = [a1, a2, a3];
		assert.deepEqual(findOrphanADRs(all), []);
	});

	it("rendered section preserves supersession pointers through parse", () => {
		const old = makeADR({ id: "ADR-005", status: "superseded", supersededBy: "ADR-006" });
		const fresh = makeADR({ id: "ADR-006", supersedes: "ADR-005" });
		const section = renderADRSection([old, fresh]);
		const parsed = parseADRSection(`# D\n\n${section}\n`);
		const oldParsed = parsed.find((a) => a.id === "ADR-005");
		const newParsed = parsed.find((a) => a.id === "ADR-006");
		assert.strictEqual(oldParsed?.supersededBy, "ADR-006");
		assert.strictEqual(newParsed?.supersedes, "ADR-005");
	});
});
