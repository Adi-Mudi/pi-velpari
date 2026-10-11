/**
 * `safeSection` guard tests (P2 hardening — D7).
 *
 * Contract: the orchestrator wraps every check in `safeSection`, so a
 * throwing check must render an error section — never take down
 * `runDoctor`'s "always renders" guarantee.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { safeSection } from "../../src/doctor/safe-section.js";
import type { DiagnosticSection } from "../../src/doctor/_types.js";

describe("safeSection", () => {
	it("returns the section unchanged when the check succeeds", () => {
		const section: DiagnosticSection = { title: "X", items: [] };
		const result = safeSection(() => section);
		assert.equal(result, section);
	});

	it("never throws and returns one error section when the check throws", () => {
		let result: DiagnosticSection | undefined;
		assert.doesNotThrow(() => {
			result = safeSection(() => {
				throw new Error("boom");
			});
		});

		assert.ok(result);
		assert.equal(result.title, "Check failed");
		assert.equal(result.items.length, 1);
		const item = result.items[0];
		assert.ok(item);
		assert.equal(item.status, "error");
		assert.match(item.message, /boom/);
	});

	it("stringifies a non-Error throw into the rendered message", () => {
		const result = safeSection(() => {
			throw "kaboom";
		});
		assert.equal(result.title, "Check failed");
		assert.equal(result.items.length, 1);
		const item = result.items[0];
		assert.ok(item);
		assert.equal(item.status, "error");
		assert.match(item.message, /kaboom/);
	});
});
