/**
 * Requirements profile — persistence + types + version.
 *
 * Phase C split:
 *   - core/profile.ts          (this file) — types, enums, version, load/save/validate
 *   - core/profiles-library.ts — built-in profile library + scoring
 *
 * Adding a new field to RequirementsProfile = edit THIS file's interface,
 * bump REQUIREMENTS_PROFILE_VERSION, and update validateRequirementsProfile.
 *
 * Adding a new built-in profile = edit profiles-library.ts only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/**
 * Profile schema version. Bump when the persisted shape changes; doctor
 * validates that the persisted profile version is supported.
 *
 * v1.x keeps the contract: deterministic suggestion, exact-match library,
 * no silent invention.
 */
export const REQUIREMENTS_PROFILE_VERSION = "1.1.0" as const;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Supported application types. */
export const APPLICATION_TYPES = [
	"web",
	"mobile",
	"desktop",
	"api",
	"ai",
	"iot",
	"cloud-platform",
	"other",
] as const;
export type ApplicationType = (typeof APPLICATION_TYPES)[number];

/** Supported domain areas. */
export const DOMAINS = [
	"general",
	"healthcare",
	"automotive",
	"aerospace",
	"banking",
	"government",
	"education",
	"retail",
	"other",
] as const;
export type Domain = (typeof DOMAINS)[number];

/** Supported development methods. */
export const DEVELOPMENT_METHODS = [
	"agile",
	"waterfall",
	"hybrid",
	"safety-critical",
	"regulated",
] as const;
export type DevelopmentMethod = (typeof DEVELOPMENT_METHODS)[number];

/** Required sections a profile can demand. */
export const PROFILE_SECTIONS = [
	"security",
	"audit",
	"transaction-integrity",
	"safety",
	"privacy",
	"accessibility",
	"performance",
	"scalability",
	"internationalization",
	"compliance",
	"data-retention",
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** Output variant suggested by the profile. */
export type OutputVariant = "compact" | "standard" | "compliance" | "feature";

/** Security levels that influence required sections. */
export type SecurityLevel = "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// Profile shapes
// ---------------------------------------------------------------------------

/**
 * Distinct profile kinds surfaced during selection.
 *
 *   - `common-core` — the baseline PSRS structure every project should
 *     have. A real, valid selection — not a "fallback because nothing
 *     matched".
 *   - `built-in`     — a specialized profile in the built-in library.
 */
export type ProfileKind = "common-core" | "built-in";

/** Stable id for the common PSRS core profile. */
export const COMMON_PSRS_CORE_PROFILE_ID = "core-psrs-v1" as const;

/** Compact answers the configure-requirements handler collects. */
export interface RequirementsAnswers {
	what: string;
	who: string;
	problem: string;
	novelty: "new-product" | "new-feature" | "existing-change";
	platforms: string[];
	sensitiveData: boolean;
	externalSystems: boolean;
	existingCodebase: boolean;
	applicationType: ApplicationType;
	domain: Domain;
	developmentMethod: DevelopmentMethod;
	securityLevel: SecurityLevel;
	regulated: boolean;
}

/** Persisted requirements profile shape. */
export interface RequirementsProfile {
	version: typeof REQUIREMENTS_PROFILE_VERSION;
	profileId: string;
	/** Common core or built-in profile. Persisted for forward compatibility. */
	profileKind: ProfileKind;
	applicationType: ApplicationType;
	domain: Domain;
	developmentMethod: DevelopmentMethod;
	regulated: boolean;
	securityLevel: SecurityLevel;
	requiredSections: ProfileSection[];
	conditionalQuestions: string[];
	outputVariant: OutputVariant;
	createdAt: string;
	researchConsent: boolean;
	researchSources: string[];
}

/** Built-in profile library entry (deterministic). */
export interface BuiltInProfile {
	profileId: string;
	applicationType: ApplicationType;
	domain: Domain;
	developmentMethod: DevelopmentMethod;
	regulated: boolean;
	securityLevel: SecurityLevel;
	requiredSections: ProfileSection[];
	outputVariant: OutputVariant;
	reason: string;
}

/** Profile recommendation surfaced to the user before selection. */
export interface ProfileRecommendation {
	kind: ProfileKind;
	profileId: string;
	label: string;
	/** 0–100 score. Higher means stronger match against the answers. */
	score: number;
	/** Short reasons explaining why this profile is recommended. */
	reasons: string[];
	/** Known trade-offs the user should weigh before picking. */
	tradeoffs: string[];
	/** Concrete built-in profile when `kind === "built-in"`. */
	builtIn?: BuiltInProfile;
}

/** Compact projection of a profile used inside stage prompts. */
export interface CompactProfileMetadata {
	profileId: string;
	profileKind: ProfileKind;
	profileVersion: string;
	applicationType: ApplicationType;
	domain: Domain;
	developmentMethod: DevelopmentMethod;
	regulated: boolean;
	outputVariant: OutputVariant;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Where the profile lives under the project config dir. */
export const REQUIREMENTS_PROFILE_FILE = "requirements-profile.json" as const;

/** Load a persisted profile, or null when missing/invalid. */
export function loadRequirementsProfile(cwd: string = process.cwd()): RequirementsProfile | null {
	const filePath = join(cwd, ".pi", "velpari", REQUIREMENTS_PROFILE_FILE);
	if (!existsSync(filePath)) return null;
	try {
		const raw = readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (validateRequirementsProfile(parsed)) return parsed as RequirementsProfile;
		const migrated = migrateLegacyProfile(parsed);
		if (migrated) return migrated;
		return null;
	} catch {
		return null;
	}
}

/** Persist the profile. */
export function saveRequirementsProfile(profile: RequirementsProfile, cwd: string = process.cwd()): void {
	const filePath = join(cwd, ".pi", "velpari", REQUIREMENTS_PROFILE_FILE);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(profile, null, 2), "utf8");
}

/** Strict validator. Returns true when the input is a valid profile. */
export function validateRequirementsProfile(input: Partial<RequirementsProfile>): input is RequirementsProfile {
	if (input.version !== REQUIREMENTS_PROFILE_VERSION) return false;
	if (typeof input.profileId !== "string" || input.profileId.length === 0) return false;
	if (input.profileKind !== "common-core" && input.profileKind !== "built-in") return false;
	if (!APPLICATION_TYPES.includes(input.applicationType as ApplicationType)) return false;
	if (!DOMAINS.includes(input.domain as Domain)) return false;
	if (!DEVELOPMENT_METHODS.includes(input.developmentMethod as DevelopmentMethod)) return false;
	if (typeof input.regulated !== "boolean") return false;
	if (!["low", "medium", "high"].includes(input.securityLevel as string)) return false;
	if (!Array.isArray(input.requiredSections)) return false;
	for (const s of input.requiredSections) {
		if (!PROFILE_SECTIONS.includes(s as ProfileSection)) return false;
	}
	if (!Array.isArray(input.conditionalQuestions)) return false;
	for (const q of input.conditionalQuestions) {
		if (typeof q !== "string") return false;
	}
	if (!["compact", "standard", "compliance", "feature"].includes(input.outputVariant as string)) return false;
	if (typeof input.createdAt !== "string") return false;
	if (typeof input.researchConsent !== "boolean") return false;
	if (!Array.isArray(input.researchSources)) return false;
	for (const s of input.researchSources) {
		if (typeof s !== "string") return false;
	}
	return true;
}

/** Compact projection of a profile for stage prompts. */
export function compactProfileMetadata(profile: RequirementsProfile | null): CompactProfileMetadata | null {
	if (!profile) return null;
	return {
		profileId: profile.profileId,
		profileKind: profile.profileKind,
		profileVersion: profile.version,
		applicationType: profile.applicationType,
		domain: profile.domain,
		developmentMethod: profile.developmentMethod,
		regulated: profile.regulated,
		outputVariant: profile.outputVariant,
	};
}

/** Migrate a v1.0.0 profile to the current schema. */
function migrateLegacyProfile(input: Record<string, unknown>): RequirementsProfile | null {
	if (input.version !== "1.0.0") return null;
	const candidate = {
		...input,
		version: REQUIREMENTS_PROFILE_VERSION,
		profileKind: "built-in",
	} as unknown as Partial<RequirementsProfile>;
	return validateRequirementsProfile(candidate) ? (candidate as RequirementsProfile) : null;
}
