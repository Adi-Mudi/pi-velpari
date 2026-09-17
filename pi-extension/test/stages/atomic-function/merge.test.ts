/**
 * PHASE 5 — tier schema tests (Phase 6 of atomic-function-layer plan).
 *
 * Verifies `stages/atomic-function/merge.ts` — every re-export and
 * the tableHeader helper:
 *
 *   - BASE_CORE_FIELDS — 8 fields
 *   - TIER_FIELDS      — tier-specific field lists
 *   - requiredFieldsFor — cumulative tier fields (8 / 13 / 24 / 35)
 *   - tierLabel        — human-readable label per tier
 *   - tableHeader      — pipe-separated column list per tier
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
	BASE_CORE_FIELDS,
	TIER_FIELDS,
	requiredFieldsFor,
	tierLabel,
	tableHeader,
} from "../../../src/stages/atomic-function/merge.js";

describe("BASE_CORE_FIELDS", () => {
	it("has 8 fields, every one required at every tier", () => {
		assert.equal(BASE_CORE_FIELDS.length, 8);
		for (const required of [
			"afId",
			"name",
			"purpose",
			"signature",
			"source",
			"cohesion",
			"verification",
			"testable",
		]) {
			assert.ok(
				(BASE_CORE_FIELDS as readonly string[]).includes(required),
				`base-core missing ${required}`,
			);
		}
	});
});

describe("TIER_FIELDS", () => {
	it("entry has 0 tier-specific fields (just base-core)", () => {
		assert.equal(TIER_FIELDS.entry.length, 0);
	});

	it("basic has 5 cross-reference fields", () => {
		assert.equal(TIER_FIELDS.basic.length, 5);
		for (const required of ["calledByFrIds", "designRef", "extractedFrom", "satisfactionFrId", "feasibilityRef"]) {
			assert.ok(
				(TIER_FIELDS.basic as readonly string[]).includes(required),
				`basic missing ${required}`,
			);
		}
	});

	it("intermediate has 11 V-Model + EARS fields", () => {
		assert.equal(TIER_FIELDS.intermediate.length, 11);
		for (const required of ["earsPattern", "complexity", "coupling", "argCount"]) {
			assert.ok(
				(TIER_FIELDS.intermediate as readonly string[]).includes(required),
				`intermediate missing ${required}`,
			);
		}
	});

	it("advanced has 11 INCOSE + maintenance fields", () => {
		assert.equal(TIER_FIELDS.advanced.length, 11);
		for (const required of ["owner", "priority", "securityClass", "risk", "changeLog"]) {
			assert.ok(
				(TIER_FIELDS.advanced as readonly string[]).includes(required),
				`advanced missing ${required}`,
			);
		}
	});
});

describe("requiredFieldsFor — cumulative per tier", () => {
	it("entry: 8 fields", () => {
		assert.equal(requiredFieldsFor("entry").length, 8);
	});

	it("basic: 13 fields (8 base + 5 cross-refs)", () => {
		assert.equal(requiredFieldsFor("basic").length, 13);
	});

	it("intermediate: 24 fields (8 + 5 + 11)", () => {
		assert.equal(requiredFieldsFor("intermediate").length, 24);
	});

	it("advanced: 35 fields (8 + 5 + 11 + 11)", () => {
		assert.equal(requiredFieldsFor("advanced").length, 35);
	});

	it("higher tiers always include all lower-tier fields (cumulative)", () => {
		const entry = requiredFieldsFor("entry");
		const basic = requiredFieldsFor("basic");
		const intermediate = requiredFieldsFor("intermediate");
		const advanced = requiredFieldsFor("advanced");
		for (const f of entry) {
			assert.ok((basic as readonly string[]).includes(f), `basic missing entry field ${f}`);
			assert.ok(
				(intermediate as readonly string[]).includes(f),
				`intermediate missing entry field ${f}`,
			);
			assert.ok((advanced as readonly string[]).includes(f), `advanced missing entry field ${f}`);
		}
	});
});

describe("tierLabel — human-readable label per tier", () => {
	it("entry mentions ISO/IEC 29110 entry profile", () => {
		assert.match(tierLabel("entry"), /Entry/);
		assert.match(tierLabel("entry"), /ISO\/IEC 29110 entry profile/);
	});

	it("basic mentions ISO/IEC 29110 basic profile", () => {
		assert.match(tierLabel("basic"), /Basic/);
		assert.match(tierLabel("basic"), /29110 basic/);
	});

	it("intermediate mentions ISO/IEC 29110 intermediate", () => {
		assert.match(tierLabel("intermediate"), /Intermediate/);
		assert.match(tierLabel("intermediate"), /29110 intermediate/);
	});

	it("advanced mentions ISO/IEC 29110 advanced", () => {
		assert.match(tierLabel("advanced"), /Advanced/);
		assert.match(tierLabel("advanced"), /29110 advanced/);
	});
});

describe("tableHeader — markdown column header per tier", () => {
	it("entry: 8 columns pipe-separated", () => {
		const header = tableHeader("entry");
		const cols = header.split(" | ");
		assert.equal(cols.length, 8);
		assert.ok(cols.includes("afId"));
		assert.ok(cols.includes("purpose"));
	});

	it("basic: 13 columns pipe-separated", () => {
		const header = tableHeader("basic");
		const cols = header.split(" | ");
		assert.equal(cols.length, 13);
		assert.ok(cols.includes("calledByFrIds"));
	});

	it("intermediate: 24 columns", () => {
		assert.equal(tableHeader("intermediate").split(" | ").length, 24);
	});

	it("advanced: 35 columns", () => {
		assert.equal(tableHeader("advanced").split(" | ").length, 35);
	});
});