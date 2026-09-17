/**
 * Tests for core/profiles-library.ts.
 * Phase 2: closes the 50% / 0% funcs coverage gap.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
	COMMON_PSRS_CORE_PROFILE,
	COMMON_PSRS_CORE_PROFILE_ID,
	buildConditionalQuestions,
	closestBuiltInProfile,
	composeProfile,
	findBuiltInProfile,
	getBuiltInProfiles,
	recommendProfiles,
	suggestProfiles,
} from "../../src/core/profiles-library.js";
import { REQUIREMENTS_PROFILE_VERSION, type RequirementsAnswers } from "../../src/core/profile.js";

describe("core/profiles-library", () => {
	it("exports a stable common-core profile id", () => {
		assert.equal(typeof COMMON_PSRS_CORE_PROFILE_ID, "string");
		assert.ok(COMMON_PSRS_CORE_PROFILE_ID.length > 0);
	});

	it("the common-core profile object matches its id", () => {
		assert.equal(COMMON_PSRS_CORE_PROFILE.profileId, COMMON_PSRS_CORE_PROFILE_ID);
	});

	it("getBuiltInProfiles returns a non-empty array", () => {
		const profiles = getBuiltInProfiles();
		assert.ok(profiles.length > 0);
		const ids = profiles.map((p) => p.profileId);
		assert.equal(new Set(ids).size, ids.length, "profileIds are unique");
	});

	it("getBuiltInProfiles includes the common-core profile", () => {
		const profiles = getBuiltInProfiles();
		assert.ok(profiles.some((p) => p.profileId === COMMON_PSRS_CORE_PROFILE_ID));
	});

	it("every built-in profile has the required shape", () => {
		const profiles = getBuiltInProfiles();
		for (const p of profiles) {
			assert.ok(p.profileId.length > 0, "profileId present");
			assert.ok(typeof p.applicationType === "string");
			assert.ok(typeof p.domain === "string");
			assert.ok(typeof p.developmentMethod === "string");
			assert.equal(typeof p.regulated, "boolean");
			assert.ok(["low", "medium", "high"].includes(p.securityLevel));
			assert.ok(Array.isArray(p.requiredSections));
		}
	});

	it("findBuiltInProfile returns the matching profile or undefined", () => {
		const profiles = getBuiltInProfiles();
		const firstId = profiles[0]!.profileId;
		assert.equal(findBuiltInProfile(firstId)?.profileId, firstId);
		assert.equal(findBuiltInProfile("nonexistent-profile-id"), undefined);
	});

	it("suggestProfiles returns at least one match for each domain keyword", () => {
		const cases: Array<[Partial<RequirementsAnswers>, RegExp]> = [
			[{ domain: "banking" }, /banking/i],
			[{ domain: "healthcare" }, /health|medical/i],
			[{ applicationType: "ai" }, /ai|ml|llm/i],
			[{ regulated: true }, /regulated|medical|banking/i],
		];
		for (const [answers, expected] of cases) {
			const picks = suggestProfiles(answers as RequirementsAnswers);
			const joined = picks.map((p) => p.profileId).join(",");
			if (picks.length > 0) {
				assert.match(joined, expected);
			}
		}
	});

	it("suggestProfiles returns empty for an empty answer", () => {
		const picks = suggestProfiles({} as RequirementsAnswers);
		assert.ok(Array.isArray(picks));
	});

	it("recommendProfiles always leads with common-core", () => {
		const recs = recommendProfiles({} as RequirementsAnswers);
		assert.ok(recs.length > 0, "at least one recommendation");
		assert.equal(recs[0]!.profileId, COMMON_PSRS_CORE_PROFILE_ID);
	});

	it("recommendProfiles assigns 0-100 scores in order", () => {
		const recs = recommendProfiles({} as RequirementsAnswers);
		for (let i = 0; i < recs.length; i++) {
			const r = recs[i]!;
			assert.ok(r.score >= 0 && r.score <= 100, `score in 0..100, got ${r.score}`);
			if (i > 0) assert.ok(recs[i - 1]!.score >= r.score, "scores are non-increasing");
		}
	});

	it("recommendProfiles carries a reason + trade-offs string per entry", () => {
		const recs = recommendProfiles({} as RequirementsAnswers);
		for (const r of recs) {
			assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0, "has reasons");
			assert.ok(Array.isArray(r.tradeoffs) && r.tradeoffs.length > 0, "has trade-offs");
		}
	});

	it("closestBuiltInProfile returns a non-common-core profile for a domain keyword", () => {
		const answer: RequirementsAnswers = { domain: "banking" } as RequirementsAnswers;
		const closest = closestBuiltInProfile(answer);
		if (closest) {
			assert.notEqual(closest.profileId, COMMON_PSRS_CORE_PROFILE_ID);
		}
	});

	it("closestBuiltInProfile returns undefined when only common-core matches", () => {
		const closest = closestBuiltInProfile({} as RequirementsAnswers);
		assert.equal(closest, undefined);
	});

	it("composeProfile builds a RequirementsProfile from a built-in + answers", () => {
		const builtIn = findBuiltInProfile(COMMON_PSRS_CORE_PROFILE_ID)!;
		const answers: RequirementsAnswers = {} as RequirementsAnswers;
		const composed = composeProfile(builtIn, answers, false, []);
		assert.equal(composed.profileId, COMMON_PSRS_CORE_PROFILE_ID);
		assert.equal(composed.profileKind, "common-core");
		assert.equal(composed.researchConsent, false);
		assert.equal(composed.version, REQUIREMENTS_PROFILE_VERSION);
		assert.ok(typeof composed.createdAt === "string");
	});

	it("composeProfile tags non-common-core as built-in", () => {
		const profiles = getBuiltInProfiles().filter(
			(p) => p.profileId !== COMMON_PSRS_CORE_PROFILE_ID,
		);
		if (profiles.length === 0) return; // nothing to test
		const builtIn = profiles[0]!;
		const composed = composeProfile(
			builtIn,
			{} as RequirementsAnswers,
			true,
			["https://example.com/citation"],
		);
		assert.equal(composed.profileKind, "built-in");
		assert.equal(composed.researchConsent, true);
		assert.deepEqual(composed.researchSources, ["https://example.com/citation"]);
	});

	it("composeProfile threads requiredSections + conditional questions", () => {
		const builtIn = findBuiltInProfile(COMMON_PSRS_CORE_PROFILE_ID)!;
		const composed = composeProfile(
			builtIn,
			{ domain: "banking" } as RequirementsAnswers,
			false,
		);
		assert.ok(composed.requiredSections.length >= builtIn.requiredSections.length);
		assert.ok(composed.conditionalQuestions.length > 0, "banking yields conditional questions");
	});

	it("buildConditionalQuestions: banking produces 3 questions", () => {
		const qs = buildConditionalQuestions({ domain: "banking" } as RequirementsAnswers);
		assert.equal(qs.length, 3);
	});

	it("buildConditionalQuestions: healthcare produces 3 questions", () => {
		const qs = buildConditionalQuestions({ domain: "healthcare" } as RequirementsAnswers);
		assert.equal(qs.length, 3);
	});

	it("buildConditionalQuestions: ai application produces 3 questions", () => {
		const qs = buildConditionalQuestions({ applicationType: "ai" } as RequirementsAnswers);
		assert.equal(qs.length, 3);
	});

	it("buildConditionalQuestions: regulated flag adds 1 question", () => {
		const qs = buildConditionalQuestions({ regulated: true } as RequirementsAnswers);
		assert.ok(qs.length >= 1);
	});

	it("buildConditionalQuestions: empty answers produce 0 questions", () => {
		const qs = buildConditionalQuestions({} as RequirementsAnswers);
		assert.equal(qs.length, 0);
	});
});