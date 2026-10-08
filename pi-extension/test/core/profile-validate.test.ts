/**
 * core/profile.ts branch coverage tests (closes the 33.33% branch gap).
 *
 * The `validateRequirementsProfile` function has 14 distinct rejection
 * branches. This file drives a positive + each rejection branch to
 * bring branch coverage on core/profile.js from 33.33% to ~100%.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	REQUIREMENTS_PROFILE_VERSION,
	REQUIREMENTS_PROFILE_COMMENT,
	validateRequirementsProfile,
	saveRequirementsProfile,
	loadRequirementsProfile,
	type RequirementsProfile,
} from "../../src/core/profile.js";

/** Build a valid baseline profile — caller mutates one field to exercise a branch. */
function validProfile(): Record<string, unknown> {
	return {
		profileId: "test-id",
		profileKind: "common-core",
		version: REQUIREMENTS_PROFILE_VERSION,
		createdAt: new Date().toISOString(),
		requiredSections: [],
		applicationType: "web",
		domain: "general",
		developmentMethod: "agile",
		regulated: false,
		securityLevel: "medium",
		outputVariant: "standard",
		conditionalQuestions: [],
		researchConsent: false,
		researchSources: [],
	};
}

describe("validateRequirementsProfile — branch coverage", () => {
	it("positive: accepts a valid profile", () => {
		assert.equal(validateRequirementsProfile(validProfile()), true);
	});

	it("rejects wrong version", () => {
		const p = validProfile();
		p.version = "0.9.0";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects non-string profileId", () => {
		const p = validProfile();
		p.profileId = 123;
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects empty profileId", () => {
		const p = validProfile();
		p.profileId = "";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects invalid profileKind", () => {
		const p = validProfile();
		p.profileKind = "unknown-kind";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects unknown applicationType", () => {
		const p = validProfile();
		p.applicationType = "unknown-app";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects unknown domain", () => {
		const p = validProfile();
		p.domain = "unknown-domain";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects unknown developmentMethod", () => {
		const p = validProfile();
		p.developmentMethod = "unknown-method";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects non-boolean regulated", () => {
		const p = validProfile();
		p.regulated = "yes";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects invalid securityLevel", () => {
		const p = validProfile();
		p.securityLevel = "extreme";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects non-array requiredSections", () => {
		const p = validProfile();
		p.requiredSections = "general";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects unknown section in requiredSections", () => {
		const p = validProfile();
		p.requiredSections = ["unknown-section"];
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects non-array conditionalQuestions", () => {
		const p = validProfile();
		p.conditionalQuestions = "what";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects non-string item in conditionalQuestions", () => {
		const p = validProfile();
		p.conditionalQuestions = [42];
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects invalid outputVariant", () => {
		const p = validProfile();
		p.outputVariant = "huge";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects non-string createdAt", () => {
		const p = validProfile();
		p.createdAt = 12345;
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects non-boolean researchConsent", () => {
		const p = validProfile();
		p.researchConsent = "true";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects non-array researchSources", () => {
		const p = validProfile();
		p.researchSources = "google";
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("rejects non-string item in researchSources", () => {
		const p = validProfile();
		p.researchSources = [42];
		assert.equal(validateRequirementsProfile(p), false);
	});

	it("accepts requiredSections with known sections", () => {
		const p = validProfile();
		p.requiredSections = ["security", "audit"];
		assert.equal(validateRequirementsProfile(p), true);
	});

	it("accepts conditionalQuestions and researchSources with strings", () => {
		const p = validProfile();
		p.conditionalQuestions = ["q1", "q2"];
		p.researchSources = ["https://example.com"];
		assert.equal(validateRequirementsProfile(p), true);
	});
});

describe("N35: requirements-profile _comment round-trip", () => {
	it("save writes _comment first; load strips it; profile data otherwise round-trips", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-profile-n35-"));
		try {
			const profile = validProfile() as unknown as RequirementsProfile;
			saveRequirementsProfile(profile, cwd);
			const filePath = join(cwd, ".pi", "velpari", "requirements-profile.json");
			const rawText = readFileSync(filePath, "utf8");
			const parsed = JSON.parse(rawText) as Record<string, unknown>;
			assert.equal(parsed._comment, REQUIREMENTS_PROFILE_COMMENT, "marker written on save");
			assert.equal(Object.keys(parsed)[0], "_comment", "marker leads the file");
			const loaded = loadRequirementsProfile(cwd);
			assert.ok(loaded !== null, "saved profile loads back");
			assert.equal("_comment" in loaded, false, "loader strips the marker");
			assert.deepEqual({ ...loaded }, { ...profile }, "profile data otherwise equal");
			// Second save (of the loaded object) keeps exactly one marker.
			saveRequirementsProfile(profile, cwd);
			assert.equal(
				(readFileSync(filePath, "utf8").match(/_comment/g) ?? []).length,
				1,
				"round-trip never duplicates the marker",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
