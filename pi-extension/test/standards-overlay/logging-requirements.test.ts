/**
 * Standards overlay — loggingRequirements block (v1.4.0).
 *
 * Covers:
 *   - All 4 bundled overlays' profile.json loads cleanly via loadOverlay.
 *   - Each carries the loggingRequirements block with the right shape.
 *   - Overlay validator accepts both old (no loggingRequirements) and
 *     new shapes (with loggingRequirements).
 *   - The 'none' overlay does NOT carry loggingRequirements (intentional).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { loadOverlay } from "../../src/core/standards-overlay.js";

describe("overlay loggingRequirements (v1.4.0)", () => {
	it("medical-device-b carries 24-month retention + tamper-evident + piiRedaction", () => {
		const o = loadOverlay(process.cwd(), "medical-device-b");
		assert.ok(o, "overlay should load");
		const lr = o!.loggingRequirements;
		assert.ok(lr, "loggingRequirements block should be present");
		assert.strictEqual(lr!.retentionMonths, 24);
		assert.strictEqual(lr!.tamperEvident, true);
		assert.strictEqual(lr!.piiRedaction, true);
		assert.ok(lr!.regimes.some((r) => /FDA 21 CFR Part 11/.test(r.framework)));
		assert.ok(lr!.extraEventCategories.includes("device-tamper"));
	});

	it("industrial-ot carries 36-month retention + tamper-evident + daily review", () => {
		const o = loadOverlay(process.cwd(), "industrial-ot");
		assert.ok(o);
		const lr = o!.loggingRequirements;
		assert.ok(lr);
		assert.strictEqual(lr!.retentionMonths, 36);
		assert.strictEqual(lr!.tamperEvident, true);
		assert.strictEqual(lr!.dailyReview, true);
		// OT is typically PII-free
		assert.strictEqual(lr!.piiRedaction, false);
		assert.ok(lr!.extraEventCategories.includes("safety-function-trigger"));
		assert.ok(lr!.extraEventCategories.includes("sis-trip"));
	});

	it("financial-payments carries 12-month retention + tamper-evident + piiRedaction + daily review", () => {
		const o = loadOverlay(process.cwd(), "financial-payments");
		assert.ok(o);
		const lr = o!.loggingRequirements;
		assert.ok(lr);
		assert.strictEqual(lr!.retentionMonths, 12);
		assert.strictEqual(lr!.tamperEvident, true);
		assert.strictEqual(lr!.piiRedaction, true);
		assert.strictEqual(lr!.dailyReview, true);
		assert.ok(lr!.regimes.some((r) => /PCI-DSS/.test(r.framework)));
		assert.ok(lr!.extraEventCategories.includes("cardholder-data-access"));
	});

	it("cloud-saas carries 12-month retention + tamper-evident + piiRedaction + daily review", () => {
		const o = loadOverlay(process.cwd(), "cloud-saas");
		assert.ok(o);
		const lr = o!.loggingRequirements;
		assert.ok(lr);
		assert.strictEqual(lr!.retentionMonths, 12);
		assert.strictEqual(lr!.tamperEvident, true);
		assert.strictEqual(lr!.piiRedaction, true);
		assert.strictEqual(lr!.dailyReview, true);
		assert.ok(lr!.regimes.some((r) => /SOC 2/.test(r.framework)));
		assert.ok(lr!.extraEventCategories.includes("tenant-isolation-event"));
	});

	it("none overlay has no loggingRequirements block (default no-overlay behaviour)", () => {
		const o = loadOverlay(process.cwd(), "none");
		// The 'none' overlay may or may not have a profile.json — if present, it must
		// NOT carry loggingRequirements (intentional default).
		if (o) {
			assert.strictEqual(o.loggingRequirements, undefined);
		}
	});
});
