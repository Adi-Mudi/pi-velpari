/**
 * Failure-impact tests (DGR P1 — lane 1a, D7).
 *
 * Covers:
 *   - every `FailureClass` in the taxonomy has a non-empty impact sentence;
 *   - `impactFor` returns the classified class impact for a known item;
 *   - `impactFor` falls back to the generic `unknown` text.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { FAILURE_IMPACTS, impactFor } from "../../src/doctor/impact.js";

// ---------------------------------------------------------------------------
// FAILURE_IMPACTS — coverage
// ---------------------------------------------------------------------------

describe("FAILURE_IMPACTS", () => {
	it("covers every failure class with a non-empty sentence", () => {
		for (const [cls, text] of Object.entries(FAILURE_IMPACTS)) {
			assert.ok(text.trim().length > 0, `${cls} impact must be a non-empty sentence`);
		}
	});

	it("covers the full taxonomy (11 classes)", () => {
		assert.equal(Object.keys(FAILURE_IMPACTS).length, 11);
		assert.ok("unknown" in FAILURE_IMPACTS, "the fallback class must be present");
	});
});

// ---------------------------------------------------------------------------
// impactFor
// ---------------------------------------------------------------------------

describe("impactFor", () => {
	it("returns the class impact for a classified item", () => {
		assert.equal(impactFor("store-db-integrity", { message: "checksum mismatch" }), FAILURE_IMPACTS["store-integrity"]);
		assert.equal(impactFor("run-lock-n13", { message: "stale lock" }), FAILURE_IMPACTS["lock-stale"]);
	});

	it("uses the message fallback when the section id is unknown", () => {
		assert.equal(impactFor("mystery-section", { message: "The file is stale" }), FAILURE_IMPACTS["artifact-stale"]);
	});

	it("falls back to the unknown impact for an unclassifiable item", () => {
		assert.equal(impactFor("mystery-section", { message: "something entirely unrelated" }), FAILURE_IMPACTS.unknown);
	});
});
