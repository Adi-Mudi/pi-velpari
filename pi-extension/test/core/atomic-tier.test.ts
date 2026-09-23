/**
 * Atomic-tier schema tests (ISO/IEC 29110 + IEC 61508/IEC 62304).
 *
 * Covers:
 *   - BASE_CORE_FIELDS = 8 fields (mandatory at every tier)
 *   - TIER_FIELDS map: entry=[], basic=[5], intermediate=[11], advanced=[27 total]
 *   - fieldRequiredFor: base-core always required; tier-specific only at its tier
 *   - requiredFieldsFor: union of base-core + tier-specific
 *   - validateAtomicProfile: rejects invalid tier / safetyClass / sil
 *   - deriveAtomicProfile: pulls fields from FilesConfig with safe defaults
 *   - tierLabel: human-readable labels
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	BASE_CORE_FIELDS,
	DEFAULT_ATOMIC_PROFILE,
	TIER_FIELDS,
	deriveAtomicProfile,
	fieldRequiredFor,
	isAtomicTier,
	isSafetyClass,
	isSil,
	requiredFieldsFor,
	tierLabel,
	validateAtomicProfile,
} from "../../src/core/atomic-tier.js";

describe("atomic-tier schema (ISO/IEC 29110 + IEC 61508/IEC 62304)", () => {
	describe("BASE_CORE_FIELDS", () => {
		it("contains the 8 universal base-core fields", () => {
			assert.equal(BASE_CORE_FIELDS.length, 8);
			assert.deepEqual(
				[...BASE_CORE_FIELDS].sort(),
				["afId", "cohesion", "name", "purpose", "signature", "source", "testable", "verification"].sort(),
			);
		});
	});

	describe("TIER_FIELDS", () => {
		it("entry has 0 tier-specific fields (base-core only)", () => {
			assert.equal(TIER_FIELDS.entry.length, 0);
		});
		it("basic has 5 cross-reference fields", () => {
			assert.equal(TIER_FIELDS.basic.length, 5);
			const expected = ["calledByFrIds", "designRef", "extractedFrom", "satisfactionFrId", "feasibilityRef"] as const;
			for (const f of expected) {
				assert.ok((TIER_FIELDS.basic as readonly string[]).includes(f), `missing ${f}`);
			}
		});
		it("intermediate adds 11 EARS / V-Model / Clean Code fields", () => {
			assert.equal(TIER_FIELDS.intermediate.length, 11);
			const expected = [
				"earsPattern",
				"inputs",
				"outputs",
				"errors",
				"dependencies",
				"dbOrIo",
				"complexity",
				"coupling",
				"argCount",
				"oneLevelAbstr",
				"nameIntent",
			] as const;
			for (const f of expected) {
				assert.ok((TIER_FIELDS.intermediate as readonly string[]).includes(f), `missing ${f}`);
			}
		});
		it("advanced adds 11 INCOSE / PMBOK / maintenance fields", () => {
			assert.equal(TIER_FIELDS.advanced.length, 11);
			const expected = [
				"owner",
				"priority",
				"securityClass",
				"risk",
				"reusability",
				"modifiabilityNote",
				"storyPoints",
				"acceptanceRef",
				"testRef",
				"rationale",
				"changeLog",
			] as const;
			for (const f of expected) {
				assert.ok((TIER_FIELDS.advanced as readonly string[]).includes(f), `missing ${f}`);
			}
		});
	});

	describe("fieldRequiredFor", () => {
		it("returns true for every base-core field at every tier", () => {
			for (const tier of ["entry", "basic", "intermediate", "advanced"] as const) {
				for (const f of BASE_CORE_FIELDS) {
					assert.ok(
						fieldRequiredFor({ tier, safetyClass: "A", sil: "none", overlayId: null }, f),
						`${f} must be required at ${tier}`,
					);
				}
			}
		});
		it("returns true for tier-specific fields only at their tier or higher", () => {
			const profile = (tier: "entry" | "basic" | "intermediate" | "advanced") => ({
				tier,
				safetyClass: "A" as const,
				sil: "none" as const,
				overlayId: null,
			});
			assert.equal(fieldRequiredFor(profile("entry"), "calledByFrIds" as never), false);
			assert.equal(fieldRequiredFor(profile("basic"), "calledByFrIds" as never), true);
			assert.equal(fieldRequiredFor(profile("intermediate"), "calledByFrIds" as never), true);
			assert.equal(fieldRequiredFor(profile("advanced"), "calledByFrIds" as never), true);

			assert.equal(fieldRequiredFor(profile("basic"), "earsPattern" as never), false);
			assert.equal(fieldRequiredFor(profile("intermediate"), "earsPattern" as never), true);

			assert.equal(fieldRequiredFor(profile("intermediate"), "owner" as never), false);
			assert.equal(fieldRequiredFor(profile("advanced"), "owner" as never), true);
		});
	});

	describe("requiredFieldsFor", () => {
		it("entry returns 8 fields (base-core only)", () => {
			assert.equal(requiredFieldsFor("entry").length, 8);
		});
		it("basic returns 13 (8 base + 5 basic)", () => {
			assert.equal(requiredFieldsFor("basic").length, 13);
		});
		it("intermediate returns 24 (8 base + 5 basic + 11 intermediate)", () => {
			assert.equal(requiredFieldsFor("intermediate").length, 24);
		});
		it("advanced returns 35 (8 base + 5 basic + 11 intermediate + 11 advanced)", () => {
			assert.equal(requiredFieldsFor("advanced").length, 35);
		});
	});

	describe("validateAtomicProfile", () => {
		it("accepts a fully valid profile", () => {
			assert.deepEqual(validateAtomicProfile(DEFAULT_ATOMIC_PROFILE), []);
		});
		it("rejects an invalid tier", () => {
			const errors = validateAtomicProfile({
				tier: "expert" as never,
				safetyClass: "A",
				sil: "none",
				overlayId: null,
			});
			assert.ok(errors.some((e) => /tier/i.test(e)));
		});
		it("rejects an invalid safetyClass", () => {
			const errors = validateAtomicProfile({
				tier: "basic",
				safetyClass: "D" as never,
				sil: "none",
				overlayId: null,
			});
			assert.ok(errors.some((e) => /safetyClass/i.test(e)));
		});
		it("rejects an invalid sil", () => {
			const errors = validateAtomicProfile({
				tier: "basic",
				safetyClass: "A",
				sil: "5" as never,
				overlayId: null,
			});
			assert.ok(errors.some((e) => /sil/i.test(e)));
		});
	});

	describe("deriveAtomicProfile", () => {
		it("returns DEFAULT_ATOMIC_PROFILE when no atomic field is present", () => {
			const profile = deriveAtomicProfile({ projectName: "x" });
			assert.deepEqual(profile, DEFAULT_ATOMIC_PROFILE);
		});
		it("preserves a valid atomic block", () => {
			const profile = deriveAtomicProfile({
				projectName: "x",
				atomic: { tier: "advanced", safetyClass: "C", sil: "3", overlayId: "industrial-ot" },
			});
			assert.equal(profile.tier, "advanced");
			assert.equal(profile.safetyClass, "C");
			assert.equal(profile.sil, "3");
			assert.equal(profile.overlayId, "industrial-ot");
		});
		it("falls back to defaults for invalid atomic values", () => {
			const profile = deriveAtomicProfile({
				projectName: "x",
				atomic: { tier: "invalid" as never, safetyClass: "A", sil: "none", overlayId: null },
			});
			assert.equal(profile.tier, "basic");
			assert.equal(profile.safetyClass, "A");
		});
	});

	describe("type guards", () => {
		it("isAtomicTier accepts the 4 valid tiers", () => {
			assert.ok(isAtomicTier("entry"));
			assert.ok(isAtomicTier("basic"));
			assert.ok(isAtomicTier("intermediate"));
			assert.ok(isAtomicTier("advanced"));
			assert.ok(!isAtomicTier("expert"));
			assert.ok(!isAtomicTier(""));
		});
		it("isSafetyClass accepts A/B/C only", () => {
			assert.ok(isSafetyClass("A"));
			assert.ok(isSafetyClass("B"));
			assert.ok(isSafetyClass("C"));
			assert.ok(!isSafetyClass("D"));
		});
		it("isSil accepts none / 1 / 2 / 3 / 4", () => {
			assert.ok(isSil("none"));
			assert.ok(isSil("1"));
			assert.ok(isSil("2"));
			assert.ok(isSil("3"));
			assert.ok(isSil("4"));
			assert.ok(!isSil("5"));
		});
	});

	describe("tierLabel", () => {
		it("returns a non-empty string for every tier", () => {
			for (const tier of ["entry", "basic", "intermediate", "advanced"] as const) {
				const label = tierLabel(tier);
				assert.ok(label.length > 10);
				assert.ok(/ISO\/IEC 29110/i.test(label));
			}
		});
	});
});
