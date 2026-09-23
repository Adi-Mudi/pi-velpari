/**
 * Atomic-function registry + reviewer-tier-gate tests (Phase 3 of reviewer plan).
 *
 * Covers:
 *   - STAGE_REGISTRY["atomic-function"].scouts now contains 5 entries including "reviewer"
 *   - filterReviewerSlot keeps reviewer when shouldRunReviewer returns true
 *   - filterReviewerSlot removes reviewer when shouldRunReviewer returns false
 *   - filterReviewerSlot is a pass-through for non-atomic-function stages
 *   - filterReviewerSlot is a pass-through when the slot list lacks "reviewer"
 *   - overlayRequiresReviewerFor reads the catalogue.json correctly
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { STAGE_REGISTRY, filterReviewerSlot, overlayRequiresReviewerFor } from "../../src/stages/registry.js";
import { DEFAULT_ATOMIC_PROFILE, type AtomicProfile } from "../../src/core/atomic-tier.js";

function profile(tier: AtomicProfile["tier"], reviewerMode?: AtomicProfile["reviewerMode"]): AtomicProfile {
	return {
		...DEFAULT_ATOMIC_PROFILE,
		tier,
		safetyClass: "A",
		sil: "none",
		overlayId: null,
		reviewerMode: reviewerMode ?? "tier-default",
	};
}

const fakeScouts = [
	{ name: "af-source-rtm", reportPath: "/tmp/af-source-rtm-report.json" },
	{ name: "af-source-design", reportPath: "/tmp/af-source-design-report.json" },
	{ name: "af-source-prd", reportPath: "/tmp/af-source-prd-report.json" },
	{ name: "af-source-feas", reportPath: "/tmp/af-source-feas-report.json" },
	{ name: "reviewer", reportPath: "/tmp/reviewer-report.json" },
];

describe("STAGE_REGISTRY atomic-function — 5-scout pattern", () => {
	it("has 5 scouts including reviewer", () => {
		const entry = STAGE_REGISTRY["atomic-function"];
		assert.equal(entry.scouts.length, 5);
		assert.ok(entry.scouts.includes("reviewer"), "reviewer missing from scouts");
	});

	it("preserves the 4 source scouts (rtm, design, prd, feas)", () => {
		const entry = STAGE_REGISTRY["atomic-function"];
		for (const required of ["af-source-rtm", "af-source-design", "af-source-prd", "af-source-feas"]) {
			assert.ok(entry.scouts.includes(required), `missing source scout ${required}`);
		}
	});

	it("places reviewer after the 4 source scouts (spawned last by parent LLM)", () => {
		const entry = STAGE_REGISTRY["atomic-function"];
		assert.equal(entry.scouts[entry.scouts.length - 1], "reviewer");
	});
});

describe("filterReviewerSlot — pass-through rules", () => {
	it("passes through when stage is not atomic-function (no filter applied)", () => {
		const result = filterReviewerSlot(fakeScouts, "prd", profile("entry"), false);
		assert.equal(result.length, 5);
		assert.ok(result.some((s) => s.name === "reviewer"));
	});

	it("passes through when the slot list lacks reviewer (no-op)", () => {
		const noReviewer = fakeScouts.filter((s) => s.name !== "reviewer");
		const result = filterReviewerSlot(noReviewer, "atomic-function", profile("entry"), false);
		assert.equal(result.length, 4);
		assert.ok(!result.some((s) => s.name === "reviewer"));
	});
});

describe("filterReviewerSlot — tier + overlay gate", () => {
	it("Entry tier + no overlay → reviewer removed", () => {
		const result = filterReviewerSlot(fakeScouts, "atomic-function", profile("entry"), false);
		assert.equal(result.length, 4);
		assert.ok(!result.some((s) => s.name === "reviewer"));
	});

	it("Basic tier + no overlay → reviewer removed", () => {
		const result = filterReviewerSlot(fakeScouts, "atomic-function", profile("basic"), false);
		assert.equal(result.length, 4);
	});

	it("Intermediate tier + no overlay → reviewer kept (tier default)", () => {
		const result = filterReviewerSlot(fakeScouts, "atomic-function", profile("intermediate"), false);
		assert.equal(result.length, 5);
		assert.ok(result.some((s) => s.name === "reviewer"));
	});

	it("Advanced tier + no overlay → reviewer kept (tier default)", () => {
		const result = filterReviewerSlot(fakeScouts, "atomic-function", profile("advanced"), false);
		assert.equal(result.length, 5);
	});

	it("Entry tier + overlay.requiresReviewer=true → reviewer kept (overlay wins)", () => {
		const result = filterReviewerSlot(fakeScouts, "atomic-function", profile("entry"), true);
		assert.equal(result.length, 5);
		assert.ok(result.some((s) => s.name === "reviewer"));
	});

	it("Basic tier + overlay.requiresReviewer=true → reviewer kept", () => {
		const result = filterReviewerSlot(fakeScouts, "atomic-function", profile("basic"), true);
		assert.equal(result.length, 5);
	});

	it("reviewerMode=always wins regardless of tier", () => {
		const result = filterReviewerSlot(fakeScouts, "atomic-function", profile("entry", "always"), false);
		assert.equal(result.length, 5);
	});

	it("reviewerMode=never wins even on Advanced tier", () => {
		const result = filterReviewerSlot(fakeScouts, "atomic-function", profile("advanced", "never"), true);
		assert.equal(result.length, 4);
		assert.ok(!result.some((s) => s.name === "reviewer"));
	});

	it("reviewerMode=never wins even with overlay.requiresReviewer=true", () => {
		const result = filterReviewerSlot(fakeScouts, "atomic-function", profile("entry", "never"), true);
		assert.equal(result.length, 4);
	});
});

describe("filterReviewerSlot — order preservation", () => {
	it("removes reviewer but keeps the 4 source scouts in original order", () => {
		const result = filterReviewerSlot(fakeScouts, "atomic-function", profile("entry"), false);
		assert.deepEqual(
			result.map((s) => s.name),
			["af-source-rtm", "af-source-design", "af-source-prd", "af-source-feas"],
		);
	});
});

describe("overlayRequiresReviewerFor — catalogue lookup", () => {
	it("returns true for medical-device-b", () => {
		assert.equal(overlayRequiresReviewerFor("/tmp", "medical-device-b"), true);
	});

	it("returns true for industrial-ot", () => {
		assert.equal(overlayRequiresReviewerFor("/tmp", "industrial-ot"), true);
	});

	it("returns true for financial-payments", () => {
		assert.equal(overlayRequiresReviewerFor("/tmp", "financial-payments"), true);
	});

	it("returns true for cloud-saas", () => {
		assert.equal(overlayRequiresReviewerFor("/tmp", "cloud-saas"), true);
	});

	it("returns false for none (explicit requiresReviewer: false)", () => {
		assert.equal(overlayRequiresReviewerFor("/tmp", "none"), false);
	});

	it("returns false for unknown overlay id (safe default)", () => {
		assert.equal(overlayRequiresReviewerFor("/tmp", "does-not-exist"), false);
	});
});
