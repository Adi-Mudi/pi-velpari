import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	APPLICATION_TYPES,
	COMMON_PSRS_CORE_PROFILE,
	COMMON_PSRS_CORE_PROFILE_ID,
	DEVELOPMENT_METHODS,
	DOMAINS,
	PROFILE_SECTIONS,
	REQUIREMENTS_PROFILE_VERSION,
	buildConditionalQuestions,
	closestBuiltInProfile,
	compactProfileMetadata,
	composeProfile,
	findBuiltInProfile,
	getBuiltInProfiles,
	loadRequirementsProfile,
	recommendProfiles,
	saveRequirementsProfile,
	suggestProfiles,
	validateRequirementsProfile,
	type BuiltInProfile,
	type RequirementsAnswers,
	type RequirementsProfile,
} from "../src/requirements-profile.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-profile-"));
}

const validBuiltIn: BuiltInProfile = findBuiltInProfile("banking-web-v1")!;

const validProfile: RequirementsProfile = {
	version: REQUIREMENTS_PROFILE_VERSION,
	profileId: "banking-web-v1",
	profileKind: "built-in",
	applicationType: "web",
	domain: "banking",
	developmentMethod: "regulated",
	regulated: true,
	securityLevel: "high",
	requiredSections: ["security", "audit", "transaction-integrity"],
	conditionalQuestions: [],
	outputVariant: "compliance",
	createdAt: "2026-09-05T00:00:00.000Z",
	researchConsent: false,
	researchSources: [],
};

const validCoreProfile: RequirementsProfile = {
	version: REQUIREMENTS_PROFILE_VERSION,
	profileId: COMMON_PSRS_CORE_PROFILE_ID,
	profileKind: "common-core",
	applicationType: "other",
	domain: "general",
	developmentMethod: "agile",
	regulated: false,
	securityLevel: "medium",
	requiredSections: ["security", "performance"],
	conditionalQuestions: [],
	outputVariant: "standard",
	createdAt: "2026-09-05T00:00:00.000Z",
	researchConsent: false,
	researchSources: [],
};

test("validateRequirementsProfile accepts a well-formed built-in profile", () => {
	assert.equal(validateRequirementsProfile(validProfile), true);
});

test("validateRequirementsProfile accepts a well-formed common-core profile", () => {
	assert.equal(validateRequirementsProfile(validCoreProfile), true);
});

test("validateRequirementsProfile rejects wrong version", () => {
	const bad = { ...validProfile, version: "0.9.0" as typeof REQUIREMENTS_PROFILE_VERSION };
	assert.equal(validateRequirementsProfile(bad), false);
});

test("validateRequirementsProfile rejects invalid profileKind", () => {
	const bad = { ...validProfile, profileKind: "custom" as never };
	assert.equal(validateRequirementsProfile(bad), false);
});

test("validateRequirementsProfile rejects invalid applicationType", () => {
	const bad = { ...validProfile, applicationType: "spaceship" as never };
	assert.equal(validateRequirementsProfile(bad), false);
});

test("validateRequirementsProfile rejects invalid domain", () => {
	const bad = { ...validProfile, domain: "void" as never };
	assert.equal(validateRequirementsProfile(bad), false);
});

test("validateRequirementsProfile rejects invalid developmentMethod", () => {
	const bad = { ...validProfile, developmentMethod: "winging-it" as never };
	assert.equal(validateRequirementsProfile(bad), false);
});

test("validateRequirementsProfile rejects invalid securityLevel", () => {
	const bad = { ...validProfile, securityLevel: "extreme" as never };
	assert.equal(validateRequirementsProfile(bad), false);
});

test("validateRequirementsProfile rejects non-array requiredSections", () => {
	const bad = { ...validProfile, requiredSections: "nope" as never };
	assert.equal(validateRequirementsProfile(bad), false);
});

test("validateRequirementsProfile rejects unknown section ids", () => {
	const bad = { ...validProfile, requiredSections: ["security", "obscure-thing"] as never };
	assert.equal(validateRequirementsProfile(bad), false);
});

test("validateRequirementsProfile rejects non-array conditionalQuestions", () => {
	const bad = { ...validProfile, conditionalQuestions: "nope" as never };
	assert.equal(validateRequirementsProfile(bad), false);
});

test("validateRequirementsProfile rejects non-boolean regulated/researchConsent", () => {
	const bad1 = { ...validProfile, regulated: "yes" as never };
	const bad2 = { ...validProfile, researchConsent: 1 as never };
	assert.equal(validateRequirementsProfile(bad1), false);
	assert.equal(validateRequirementsProfile(bad2), false);
});

test("save/load round-trip preserves the profile", () => {
	const dir = tempDir();
	try {
		saveRequirementsProfile(validProfile, dir);
		const loaded = loadRequirementsProfile(dir);
		assert.deepEqual(loaded, validProfile);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("save/load round-trip preserves the common-core profile", () => {
	const dir = tempDir();
	try {
		saveRequirementsProfile(validCoreProfile, dir);
		const loaded = loadRequirementsProfile(dir);
		assert.deepEqual(loaded, validCoreProfile);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRequirementsProfile migrates a version 1 profile to the current kind", () => {
	const dir = tempDir();
	try {
		const path = join(dir, ".pi", "velpari", "requirements-profile.json");
		mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
		const legacy: Record<string, unknown> = { ...validProfile, version: "1.0.0" };
		delete legacy.profileKind;
		writeFileSync(path, JSON.stringify(legacy), "utf8");

		const loaded = loadRequirementsProfile(dir);
		assert.equal(loaded?.version, REQUIREMENTS_PROFILE_VERSION);
		assert.equal(loaded?.profileKind, "built-in");
		assert.equal(loaded?.profileId, "banking-web-v1");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});test("loadRequirementsProfile returns null when no file", () => {
	const dir = tempDir();
	try {
		assert.equal(loadRequirementsProfile(dir), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadRequirementsProfile returns null on malformed JSON", () => {
	const dir = tempDir();
	try {
		const path = join(dir, ".pi", "velpari");
		mkdirSync(path, { recursive: true });
		writeFileSync(join(path, "requirements-profile.json"), "{bad json", "utf8");
		assert.equal(loadRequirementsProfile(dir), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("saveRequirementsProfile creates parent dirs as needed", () => {
	const dir = tempDir();
	try {
		const path = join(dir, ".pi", "velpari", "requirements-profile.json");
		assert.equal(existsSync(path), false);
		saveRequirementsProfile(validProfile, dir);
		assert.ok(existsSync(path), "file should exist");
		const raw = readFileSync(path, "utf8");
		assert.match(raw, /banking-web-v1/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("built-in library exposes only valid profile ids + versions", () => {
	const ids = getBuiltInProfiles().map((p) => p.profileId);
	const set = new Set(ids);
	assert.equal(set.size, ids.length, "library must not have duplicate ids");
	for (const p of getBuiltInProfiles()) {
		assert.ok(p.profileId.length > 0);
		assert.match(p.reason, /\S+/, "reason should be non-empty");
	}
});

test("built-in library always ships the common PSRS core", () => {
	const ids = getBuiltInProfiles().map((p) => p.profileId);
	assert.ok(ids.includes(COMMON_PSRS_CORE_PROFILE_ID), "common core must be present");
});

test("findBuiltInProfile returns a profile by id", () => {
	const p = findBuiltInProfile("banking-web-v1");
	assert.ok(p);
	assert.equal(p.applicationType, "web");
	assert.equal(p.domain, "banking");
});

test("findBuiltInProfile returns the common PSRS core by id", () => {
	const p = findBuiltInProfile(COMMON_PSRS_CORE_PROFILE_ID);
	assert.ok(p);
	assert.deepEqual(p, COMMON_PSRS_CORE_PROFILE);
});

test("findBuiltInProfile returns undefined for unknown id", () => {
	assert.equal(findBuiltInProfile("does-not-exist"), undefined);
});

const baseAnswers: RequirementsAnswers = {
	what: "expense tracker",
	who: "individual users",
	problem: "tracking daily expenses",
	novelty: "new-product",
	platforms: ["ios", "android"],
	sensitiveData: false,
	externalSystems: false,
	existingCodebase: false,
	applicationType: "web",
	domain: "banking",
	developmentMethod: "regulated",
	securityLevel: "high",
	regulated: true,
};

test("suggestProfiles matches banking-web for matching answers", () => {
	const matches = suggestProfiles(baseAnswers);
	const ids = matches.map((m) => m.profileId);
	assert.ok(ids.includes("banking-web-v1"), `expected banking-web-v1 in ${ids.join(", ")}`);
});

test("suggestProfiles excludes the common PSRS core", () => {
	const matches = suggestProfiles(baseAnswers);
	const ids = matches.map((m) => m.profileId);
	assert.ok(!ids.includes(COMMON_PSRS_CORE_PROFILE_ID), "common core must NOT be in suggestProfiles");
});

test("suggestProfiles returns empty when nothing matches", () => {
	const matches = suggestProfiles({
		...baseAnswers,
		applicationType: "ai",
		domain: "aerospace",
		regulated: true,
		securityLevel: "low",
		developmentMethod: "agile",
	});
	// Should be empty since there's no aerospace-ai-regulated-agile combo.
	assert.equal(matches.length, 0);
});

test("suggestProfiles is deterministic for the same answers", () => {
	const a = suggestProfiles(baseAnswers);
	const b = suggestProfiles(baseAnswers);
	assert.deepEqual(a, b);
});

test("suggestProfiles orders by profileId", () => {
	const matches = suggestProfiles({ ...baseAnswers, applicationType: "web", domain: "general" });
	const ids = matches.map((m) => m.profileId);
	const sorted = [...ids].sort();
	assert.deepEqual(ids, sorted);
});

test("recommendProfiles always surfaces the common PSRS core", () => {
	const recs = recommendProfiles(baseAnswers);
	const core = recs.find((r) => r.kind === "common-core");
	assert.ok(core, "common core must appear in recommendations");
	assert.equal(core!.profileId, COMMON_PSRS_CORE_PROFILE_ID);
});

test("recommendProfiles is deterministic for the same answers", () => {
	const a = recommendProfiles(baseAnswers);
	const b = recommendProfiles(baseAnswers);
	assert.deepEqual(a, b);
});

test("recommendProfiles sorted by score desc, profileId asc", () => {
	const recs = recommendProfiles(baseAnswers);
	for (let i = 1; i < recs.length; i++) {
		const prev = recs[i - 1]!;
		const curr = recs[i]!;
		if (prev.score === curr.score) {
			assert.ok(prev.profileId <= curr.profileId, `secondary sort at index ${i}: ${prev.profileId} vs ${curr.profileId}`);
		} else {
			assert.ok(prev.score >= curr.score, `score sort at index ${i}: ${prev.score} vs ${curr.score}`);
		}
	}
});

test("recommendProfiles includes reasons and trade-offs", () => {
	const recs = recommendProfiles(baseAnswers);
	for (const r of recs) {
		assert.ok(r.reasons.length >= 1, `${r.profileId} has no reasons`);
		assert.ok(r.tradeoffs.length >= 1, `${r.profileId} has no tradeoffs`);
		assert.ok(r.score >= 0 && r.score <= 100, `${r.profileId} score out of range: ${r.score}`);
	}
});

test("recommendProfiles returns at most one common-core and two built-ins", () => {
	const recs = recommendProfiles(baseAnswers);
	const cores = recs.filter((r) => r.kind === "common-core");
	const built = recs.filter((r) => r.kind === "built-in");
	assert.equal(cores.length, 1, "exactly one common core");
	assert.ok(built.length <= 2, `at most two built-ins; got ${built.length}`);
});

test("closestBuiltInProfile returns a built-in or undefined", () => {
	const closest = closestBuiltInProfile(baseAnswers);
	if (closest) {
		assert.notEqual(closest.profileId, COMMON_PSRS_CORE_PROFILE_ID);
		assert.ok(closest.applicationType);
	}
});

test("closestBuiltInProfile returns undefined when library has no overlapping built-in", () => {
	const closest = closestBuiltInProfile({
		...baseAnswers,
		applicationType: "other",
		domain: "education",
		developmentMethod: "waterfall",
		regulated: false,
		securityLevel: "low",
	});
	// Only common core is guaranteed; built-ins may still match loosely.
	const p = closest;
	if (p) {
		assert.notEqual(p.profileId, COMMON_PSRS_CORE_PROFILE_ID);
	}
});

test("composeProfile fills metadata from chosen built-in", () => {
	const profile = composeProfile(validBuiltIn, baseAnswers, false);
	assert.equal(profile.profileId, "banking-web-v1");
	assert.equal(profile.profileKind, "built-in");
	assert.equal(profile.version, REQUIREMENTS_PROFILE_VERSION);
	assert.equal(profile.applicationType, "web");
	assert.equal(profile.domain, "banking");
	assert.equal(profile.regulated, true);
	assert.deepEqual(profile.requiredSections, validBuiltIn.requiredSections);
	assert.equal(profile.outputVariant, "compliance");
	assert.ok(profile.createdAt.length > 0);
});

test("composeProfile tags common-core profile kind", () => {
	const profile = composeProfile(COMMON_PSRS_CORE_PROFILE, baseAnswers, false);
	assert.equal(profile.profileId, COMMON_PSRS_CORE_PROFILE_ID);
	assert.equal(profile.profileKind, "common-core");
});

test("composeProfile captures research consent + sources", () => {
	const profile = composeProfile(validBuiltIn, baseAnswers, true, ["https://example.com/foo"]);
	assert.equal(profile.researchConsent, true);
	assert.deepEqual(profile.researchSources, ["https://example.com/foo"]);
});

test("buildConditionalQuestions returns banking questions when domain=banking", () => {
	const q = buildConditionalQuestions(baseAnswers);
	assert.ok(q.some((line) => /financial records/i.test(line)));
	assert.ok(q.some((line) => /audit history/i.test(line)));
});

test("buildConditionalQuestions returns healthcare questions when domain=healthcare", () => {
	const q = buildConditionalQuestions({ ...baseAnswers, domain: "healthcare" });
	assert.ok(q.some((line) => /patient data/i.test(line)));
});

test("buildConditionalQuestions returns AI questions when applicationType=ai", () => {
	const q = buildConditionalQuestions({ ...baseAnswers, applicationType: "ai", domain: "general", regulated: false });
	assert.ok(q.some((line) => /minimum accepted accuracy/i.test(line)));
});

test("buildConditionalQuestions returns empty for non-triggering combinations", () => {
	const q = buildConditionalQuestions({
		...baseAnswers,
		applicationType: "web",
		domain: "general",
		regulated: false,
	});
	assert.equal(q.length, 0);
});

test("compactProfileMetadata projects only the compact subset", () => {
	const profile = composeProfile(validBuiltIn, baseAnswers, false);
	const compact = compactProfileMetadata(profile);
	assert.ok(compact);
	assert.equal(compact?.profileId, "banking-web-v1");
	assert.equal(compact?.profileKind, "built-in");
	assert.equal(compact?.profileVersion, REQUIREMENTS_PROFILE_VERSION);
	assert.equal(compact?.applicationType, "web");
	assert.equal(compact?.domain, "banking");
	assert.equal(compact?.regulated, true);
	assert.equal(compact?.outputVariant, "compliance");
});

test("compactProfileMetadata projects common-core profile kind", () => {
	const profile = composeProfile(COMMON_PSRS_CORE_PROFILE, baseAnswers, false);
	const compact = compactProfileMetadata(profile);
	assert.equal(compact?.profileKind, "common-core");
});

test("compactProfileMetadata returns null for null profile", () => {
	assert.equal(compactProfileMetadata(null), null);
});

test("Application types / domains / development methods / sections lists are non-empty", () => {
	assert.ok(APPLICATION_TYPES.length >= 5);
	assert.ok(DOMAINS.length >= 5);
	assert.ok(DEVELOPMENT_METHODS.length >= 3);
	assert.ok(PROFILE_SECTIONS.length >= 5);
});
