/**
 * tactic-catalog tests (Phase 5).
 *
 *   - Catalog includes all five SEI tactic families
 *       (performance, availability, security, modifiability, testability)
 *   - Tactic ids are kebab-case
 *   - isKnownTactic matches TACTIC_BY_ID membership
 *   - tacticsForQA returns at least one tactic per family
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	TACTIC_CATALOG,
	TACTIC_BY_ID,
	TACTIC_IDS,
	isKnownTactic,
	tacticsForQA,
} from "../../src/core/tactic-catalog.js";

describe("TACTIC_CATALOG", () => {
	it("includes tactics from every SEI family", () => {
		const categories = new Set(TACTIC_CATALOG.map((t) => t.category));
		const expected: Array<Parameters<typeof categories.has>[0]> = [
			"performance",
			"availability",
			"security",
			"modifiability",
			"testability",
		];
		for (const e of expected) {
			assert.ok(categories.has(e), `missing family "${e}"`);
		}
	});

	it("has unique tactic ids", () => {
		assert.equal(new Set(TACTIC_IDS).size, TACTIC_IDS.length);
	});

	it("has well-formed kebab-case ids", () => {
		const kebab = /^[a-z][a-z0-9-]*$/;
		for (const id of TACTIC_IDS) {
			assert.match(id, kebab, `tactic id "${id}" is not kebab-case`);
		}
	});

	it("every tactic has a category + ≥1 targeted QA", () => {
		for (const t of TACTIC_CATALOG) {
			assert.ok(t.targetsQA.length >= 1, `${t.id} must target ≥1 QA`);
			assert.ok(t.label.length >= 1);
		}
	});

	it("TACTIC_BY_ID membership matches TACTIC_IDS", () => {
		for (const id of TACTIC_IDS) {
			assert.ok(TACTIC_BY_ID.has(id), `${id} should be in TACTIC_BY_ID`);
		}
	});
});

describe("isKnownTactic", () => {
	it("returns true for a known tactic id", () => {
		assert.equal(isKnownTactic("cache"), true);
		assert.equal(isKnownTactic("retry"), true);
		assert.equal(isKnownTactic("encrypt"), true);
		assert.equal(isKnownTactic("inject"), true);
	});

	it("returns false for an unknown tactic id", () => {
		assert.equal(isKnownTactic("magic-cache"), false);
		assert.equal(isKnownTactic(""), false);
	});
});

describe("tacticsForQA", () => {
	it("returns at least one tactic per SEI family", () => {
		assert.ok(tacticsForQA("performance").length >= 1);
		assert.ok(tacticsForQA("availability").length >= 1);
		assert.ok(tacticsForQA("security").length >= 1);
		assert.ok(tacticsForQA("modifiability").length >= 1);
		assert.ok(tacticsForQA("testability").length >= 1);
	});

	it("returned tactics all claim the requested QA category", () => {
		const perfTactics = tacticsForQA("performance");
		for (const t of perfTactics) {
			assert.ok(t.targetsQA.includes("performance"), `${t.id} should target performance`);
		}
	});
});

describe("tacticsForQA with unknown category", () => {
	it("returns an empty array for an unknown category string", () => {
		// TypeScript narrows; the runtime accepts arbitrary strings and
		// returns empties. We cast to test the runtime behaviour.
		const result = tacticsForQA("nonexistent-category" as unknown as Parameters<typeof tacticsForQA>[0]);
		assert.deepEqual(result, []);
	});
});
