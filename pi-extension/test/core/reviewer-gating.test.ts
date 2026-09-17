/**
 * Reviewer gating tests (Phase 2 of reviewer plan).
 *
 * Covers:
 *   - REVIEWER_GATE_RULES contains intermediate + advanced only
 *   - DEFAULT_REVIEWER_MODE = "tier-default"
 *   - shouldRunReviewer decision order:
 *     1. reviewerMode="never" always wins (overrides tier + overlay)
 *     2. reviewerMode="always" always runs (overrides tier)
 *     3. overlay.requiresReviewer=true runs regardless of tier
 *     4. tier ∈ {intermediate, advanced} runs (tier-default)
 *     5. tier ∈ {entry, basic} without overlay skip
 *   - isReviewerMode type guard
 *   - deriveAtomicProfile preserves reviewerMode
 *   - DEFAULT_ATOMIC_PROFILE.reviewerMode = "tier-default"
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	DEFAULT_ATOMIC_PROFILE,
	DEFAULT_REVIEWER_MODE,
	REVIEWER_GATE_RULES,
	deriveAtomicProfile,
	isReviewerMode,
	shouldRunReviewer,
	type AtomicProfile,
	type AtomicTier,
} from "../../src/core/atomic-tier.js";

function profile(tier: AtomicTier, overrides: Partial<AtomicProfile> = {}): AtomicProfile {
	return {
		...DEFAULT_ATOMIC_PROFILE,
		tier,
		safetyClass: "A",
		sil: "none",
		overlayId: null,
		reviewerMode: DEFAULT_REVIEWER_MODE,
		...overrides,
	};
}

describe("reviewer gating — gate rules", () => {
	it("REVIEWER_GATE_RULES contains intermediate + advanced only", () => {
		assert.ok(REVIEWER_GATE_RULES.has("intermediate"));
		assert.ok(REVIEWER_GATE_RULES.has("advanced"));
		assert.ok(!REVIEWER_GATE_RULES.has("entry"));
		assert.ok(!REVIEWER_GATE_RULES.has("basic"));
		assert.equal(REVIEWER_GATE_RULES.size, 2);
	});

	it("DEFAULT_REVIEWER_MODE is tier-default", () => {
		assert.equal(DEFAULT_REVIEWER_MODE, "tier-default");
	});

	it("DEFAULT_ATOMIC_PROFILE has reviewerMode = tier-default", () => {
		assert.equal(DEFAULT_ATOMIC_PROFILE.reviewerMode, "tier-default");
	});
});

describe("reviewer gating — type guard", () => {
	it("isReviewerMode accepts the 3 valid modes", () => {
		assert.ok(isReviewerMode("tier-default"));
		assert.ok(isReviewerMode("always"));
		assert.ok(isReviewerMode("never"));
	});
	it("isReviewerMode rejects everything else", () => {
		assert.ok(!isReviewerMode(""));
		assert.ok(!isReviewerMode("sometimes"));
		assert.ok(!isReviewerMode("off"));
		assert.ok(!isReviewerMode(undefined));
		assert.ok(!isReviewerMode(null));
		assert.ok(!isReviewerMode(0));
	});
});

describe("reviewer gating — shouldRunReviewer decision order", () => {
	describe("tier-default mode", () => {
		it("Entry tier + no overlay → false", () => {
			assert.equal(
				shouldRunReviewer({ profile: profile("entry") }),
				false,
			);
		});

		it("Basic tier + no overlay → false", () => {
			assert.equal(
				shouldRunReviewer({ profile: profile("basic") }),
				false,
			);
		});

		it("Intermediate tier + no overlay → true (tier default)", () => {
			assert.equal(
				shouldRunReviewer({ profile: profile("intermediate") }),
				true,
			);
		});

		it("Advanced tier + no overlay → true (tier default)", () => {
			assert.equal(
				shouldRunReviewer({ profile: profile("advanced") }),
				true,
			);
		});

		it("Entry tier + overlay requiresReviewer → true (overlay wins over tier)", () => {
			assert.equal(
				shouldRunReviewer({
					profile: profile("entry"),
					overlayRequiresReviewer: true,
				}),
				true,
			);
		});

		it("Basic tier + overlay requiresReviewer → true", () => {
			assert.equal(
				shouldRunReviewer({
					profile: profile("basic"),
					overlayRequiresReviewer: true,
				}),
				true,
			);
		});

		it("Intermediate tier + overlay requiresReviewer=false → still true (tier default)", () => {
			assert.equal(
				shouldRunReviewer({
					profile: profile("intermediate"),
					overlayRequiresReviewer: false,
				}),
				true,
			);
		});
	});

	describe("explicit mode", () => {
		it("reviewerMode=never wins over Advanced tier (never wins)", () => {
			assert.equal(
				shouldRunReviewer({
					profile: profile("advanced"),
					reviewerMode: "never",
				}),
				false,
			);
		});

		it("reviewerMode=never wins over overlay.requiresReviewer (never wins)", () => {
			assert.equal(
				shouldRunReviewer({
					profile: profile("entry"),
					overlayRequiresReviewer: true,
					reviewerMode: "never",
				}),
				false,
			);
		});

		it("reviewerMode=always runs even on Entry tier (always wins)", () => {
			assert.equal(
				shouldRunReviewer({
					profile: profile("entry"),
					reviewerMode: "always",
				}),
				true,
			);
		});

		it("reviewerMode=always runs even on Basic tier", () => {
			assert.equal(
				shouldRunReviewer({
					profile: profile("basic"),
					reviewerMode: "always",
				}),
				true,
			);
		});

		it("reviewerMode=always runs even with no overlay", () => {
			assert.equal(
				shouldRunReviewer({
					profile: profile("advanced"),
					overlayRequiresReviewer: false,
					reviewerMode: "always",
				}),
				true,
			);
		});

		it("explicit tier-default reviewerMode + tier-default behaviour (control)", () => {
			assert.equal(
				shouldRunReviewer({
					profile: profile("entry"),
					reviewerMode: "tier-default",
				}),
				false,
			);
		});
	});
});

describe("reviewer gating — deriveAtomicProfile", () => {
	it("preserves reviewerMode=always when set", () => {
		const profile = deriveAtomicProfile({
			projectName: "x",
			atomic: {
				tier: "basic",
				safetyClass: "A",
				sil: "none",
				overlayId: null,
				reviewerMode: "always",
			},
		});
		assert.equal(profile.reviewerMode, "always");
	});

	it("preserves reviewerMode=never when set", () => {
		const profile = deriveAtomicProfile({
			projectName: "x",
			atomic: {
				tier: "advanced",
				safetyClass: "C",
				sil: "3",
				overlayId: "medical-device-b",
				reviewerMode: "never",
			},
		});
		assert.equal(profile.reviewerMode, "never");
		assert.equal(profile.tier, "advanced");
		assert.equal(profile.overlayId, "medical-device-b");
	});

	it("falls back to tier-default when reviewerMode is missing", () => {
		const profile = deriveAtomicProfile({
			projectName: "x",
			atomic: {
				tier: "basic",
				safetyClass: "A",
				sil: "none",
				overlayId: null,
			},
		});
		assert.equal(profile.reviewerMode, "tier-default");
	});

	it("falls back to tier-default when reviewerMode is invalid", () => {
		const profile = deriveAtomicProfile({
			projectName: "x",
			atomic: {
				tier: "basic",
				safetyClass: "A",
				sil: "none",
				overlayId: null,
				reviewerMode: "sometimes" as never,
			},
		});
		assert.equal(profile.reviewerMode, "tier-default");
	});

	it("fall-back to defaults when no atomic block at all", () => {
		const profile = deriveAtomicProfile({ projectName: "x" });
		assert.equal(profile.reviewerMode, "tier-default");
		assert.equal(profile.tier, "basic");
		assert.equal(profile.safetyClass, "A");
	});
});
