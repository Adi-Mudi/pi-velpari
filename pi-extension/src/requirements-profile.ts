/**
 * Requirements profile module (Velpari Requirements Factory).
 *
 * Profiles capture the user-confirmed selection of application type,
 * domain, development method, regulated flag, and required sections.
 * They are stored at `.pi/velpari/requirements-profile.json` (separate
 * from `files.json` per the design). The PRD handler reads the profile
 * to compose a PSRS-shaped working copy.
 *
 * The shape is intentionally versioned and validated.
 *
 * v1.x kept the contract: deterministic suggestion, exact-match
 * library, no silent invention. The v1.x library is preserved for
 * backward compatibility. Versioning is kept at `1.x.y` so existing
 * saved profiles still load and validate.
 *
 * The persisted profile shape remains the same. The handler returns
 * `ProfileRecommendation[]` with score/reasons/trade-offs so the user
 * can compare candidates. Recommendation is independent of selection:
 * the user can pick a built-in profile, the common PSRS core, or stop.
 *
 * PSRS core profile is a first-class, versioned, deterministic choice.
 * It represents the baseline PSRS structure every project should have
 * regardless of application type. It is not a "fallback because
 * nothing matched"; a user may select it explicitly even when other
 * profiles match.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Profile schema version. Bump when the shape changes; doctor validates
 * that the persisted profile version is supported.
 */
export const REQUIREMENTS_PROFILE_VERSION = "1.1.0" as const;

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

/**
 * Distinct profile kinds. The handler surfaces them in a single
 * recommendation list so the user can compare across kinds.
 *
 * - `common-core` — the baseline PSRS structure every project should
 *   have (Objective, Problem, Actors, Scope, MVP, Phases, FR, NFR,
 *   Data and Interfaces, Errors and Edge Cases, Constraints,
 *   Dependencies and Risks, Out of Scope, Open Questions, Acceptance
 *   Criteria, Helper Function Candidates). It is a real, valid
 *   selection — not a fallback because nothing matched.
 * - `built-in` — a specialized profile in the built-in library.
 */
export type ProfileKind = "common-core" | "built-in";

/** Profile recommendation surfaced to the user before selection. */
export interface ProfileRecommendation {
	kind: ProfileKind;
	/** Concrete profile identifier (e.g. `core-psrs-v1` or `banking-web-v1`). */
	profileId: string;
	/** Human-readable label shown in `ctx.ui.select` options. */
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

/** Built-in profile library (deterministic). */
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

/**
 * Compact answers the configure-requirements handler collects.
 * Every field is required; the handler validates before suggesting.
 */
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

/** Stable id for the common PSRS core profile. */
export const COMMON_PSRS_CORE_PROFILE_ID = "core-psrs-v1" as const;

/** Common PSRS core profile definition. */
export const COMMON_PSRS_CORE_PROFILE: BuiltInProfile = {
	profileId: COMMON_PSRS_CORE_PROFILE_ID,
	applicationType: "other",
	domain: "general",
	developmentMethod: "agile",
	regulated: false,
	securityLevel: "medium",
	requiredSections: ["security", "performance"],
	outputVariant: "standard",
	reason:
		"Common PSRS core: Objective, Problem, Actors, Scope, MVP, Phases, " +
		"FR, NFR, Data and Interfaces, Errors and Edge Cases, Constraints, " +
		"Dependencies and Risks, Out of Scope, Open Questions, Acceptance " +
		"Criteria, Helper Function Candidates. Baseline for any project.",
};

/** Built-in profile library (deterministic, sorted by profileId). */
const DEFAULT_PROFILE_LIBRARY: ReadonlyArray<BuiltInProfile> = [
	COMMON_PSRS_CORE_PROFILE,
	{
		profileId: "banking-web-v1",
		applicationType: "web",
		domain: "banking",
		developmentMethod: "regulated",
		regulated: true,
		securityLevel: "high",
		requiredSections: ["security", "audit", "transaction-integrity", "compliance", "privacy"],
		outputVariant: "compliance",
		reason: "Banking web applications require audit history, transaction integrity, and compliance controls.",
	},
	{
		profileId: "healthcare-ai-v1",
		applicationType: "ai",
		domain: "healthcare",
		developmentMethod: "safety-critical",
		regulated: true,
		securityLevel: "high",
		requiredSections: ["safety", "privacy", "audit", "data-retention", "compliance"],
		outputVariant: "compliance",
		reason: "Healthcare AI applications handle patient data and require safety, privacy, and audit controls.",
	},
	{
		profileId: "web-general-v1",
		applicationType: "web",
		domain: "general",
		developmentMethod: "agile",
		regulated: false,
		securityLevel: "medium",
		requiredSections: ["security", "performance", "accessibility"],
		outputVariant: "standard",
		reason: "General web applications benefit from baseline security, performance, and accessibility controls.",
	},
	{
		profileId: "api-general-v1",
		applicationType: "api",
		domain: "general",
		developmentMethod: "agile",
		regulated: false,
		securityLevel: "medium",
		requiredSections: ["security", "performance", "scalability"],
		outputVariant: "standard",
		reason: "General APIs require security, performance, and scalability controls.",
	},
	{
		profileId: "mobile-general-v1",
		applicationType: "mobile",
		domain: "general",
		developmentMethod: "agile",
		regulated: false,
		securityLevel: "medium",
		requiredSections: ["security", "performance", "accessibility", "privacy"],
		outputVariant: "standard",
		reason: "Mobile applications require platform security, performance, accessibility, and privacy controls.",
	},
	{
		profileId: "automotive-safety-v1",
		applicationType: "iot",
		domain: "automotive",
		developmentMethod: "safety-critical",
		regulated: true,
		securityLevel: "high",
		requiredSections: ["safety", "audit", "compliance"],
		outputVariant: "compliance",
		reason: "Automotive systems require safety and compliance controls.",
	},
	{
		profileId: "government-web-v1",
		applicationType: "web",
		domain: "government",
		developmentMethod: "waterfall",
		regulated: true,
		securityLevel: "high",
		requiredSections: ["security", "audit", "compliance", "accessibility", "data-retention"],
		outputVariant: "compliance",
		reason: "Government web applications require audit, compliance, accessibility, and data retention controls.",
	},
	{
		profileId: "ai-general-v1",
		applicationType: "ai",
		domain: "general",
		developmentMethod: "agile",
		regulated: false,
		securityLevel: "medium",
		requiredSections: ["security", "performance", "privacy"],
		outputVariant: "feature",
		reason: "AI applications require security, performance, and privacy controls.",
	},
];

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

/** Migrate a version 1 profile to the current profileKind field. */
function migrateLegacyProfile(input: Record<string, unknown>): RequirementsProfile | null {
	if (input.version !== "1.0.0") return null;
	const candidate = {
		...input,
		version: REQUIREMENTS_PROFILE_VERSION,
		profileKind: "built-in",
	} as unknown as Partial<RequirementsProfile>;
	return validateRequirementsProfile(candidate) ? candidate as RequirementsProfile : null;
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

/**
 * Suggest matching built-in profiles from the library. Deterministic
 * ordering by profileId. Returns an empty array when nothing matches.
 * Never invents profiles: when nothing matches the caller MUST surface
 * the gap rather than silently continue. Common PSRS core is always
 * surfaced through `recommendProfiles`, NOT through this function.
 */
export function suggestProfiles(answers: RequirementsAnswers): BuiltInProfile[] {
	const matches: BuiltInProfile[] = [];
	for (const p of DEFAULT_PROFILE_LIBRARY) {
		if (p.profileId === COMMON_PSRS_CORE_PROFILE_ID) continue;
		if (p.applicationType !== answers.applicationType) continue;
		if (p.domain !== answers.domain) continue;
		if (p.regulated !== answers.regulated) continue;
		// accept if development method matches OR the library profile
		// represents a safer default for the regulated/securityLevel combo.
		if (p.developmentMethod !== answers.developmentMethod) {
			// allow waterfall/agile overlap when domain is general
			if (answers.domain !== "general") continue;
		}
		matches.push(p);
	}
	matches.sort((a, b) => a.profileId.localeCompare(b.profileId));
	return matches;
}

/**
 * Build the deterministic recommendation list shown to the user before
 * final selection. Always includes the common PSRS core. Includes up
 * to two matching built-in profiles. Each entry carries a 0–100 score,
 * reasons, and trade-offs. Sort order: score desc, then profileId.
 */
export function recommendProfiles(answers: RequirementsAnswers): ProfileRecommendation[] {
	const recs: ProfileRecommendation[] = [];

	// Common PSRS core is always surfaced as a real candidate.
	const coreScore = scoreCommonCore(answers);
	recs.push({
		kind: "common-core",
		profileId: COMMON_PSRS_CORE_PROFILE_ID,
		label: "Use common PSRS core",
		score: coreScore.score,
		reasons: coreScore.reasons,
		tradeoffs: coreScore.tradeoffs,
		builtIn: COMMON_PSRS_CORE_PROFILE,
	});

	// Closest built-in profiles (top 2 by score, then by profileId).
	const built = suggestProfiles(answers).map((p) => scoreBuiltIn(p, answers));
	built.sort((a, b) => b.score - a.score || a.builtIn!.profileId.localeCompare(b.builtIn!.profileId));
	for (const b of built.slice(0, 2)) {
		recs.push({
			kind: "built-in",
			profileId: b.builtIn!.profileId,
			label: `Use built-in profile: ${b.builtIn!.profileId}`,
			score: b.score,
			reasons: b.reasons,
			tradeoffs: b.tradeoffs,
			builtIn: b.builtIn,
		});
	}

	// Sort by score desc, then profileId asc (deterministic).
	recs.sort((a, b) => b.score - a.score || a.profileId.localeCompare(b.profileId));
	return recs;
}

interface Scored {
	score: number;
	reasons: string[];
	tradeoffs: string[];
}

/** Score the common PSRS core against the captured answers. */
function scoreCommonCore(answers: RequirementsAnswers): Scored {
	const score = 60;
	const reasons: string[] = [
		"Common PSRS core defines the baseline structure every project gets.",
		"Includes Objective, Problem, Actors, Scope, MVP, Phases, FR, NFR, Data and Interfaces, Errors and Edge Cases, Constraints, Dependencies and Risks, Out of Scope, Open Questions, Acceptance Criteria, Helper Function Candidates.",
	];
	const tradeoffs: string[] = [
		"Does not include specialized sections (audit, transaction-integrity, safety, compliance, etc.).",
		"Best when the project has no clear regulatory or industry-specific obligations.",
	];
	if (answers.regulated) {
		tradeoffs.push(
			"This project is regulated; the common core is still a valid choice but lacks the regulated sections you may need.",
		);
	}
	if (answers.domain !== "general") {
		tradeoffs.push(
			`Domain is "${answers.domain}"; the common core is more generic than a domain-specific built-in.`,
		);
	}
	if (answers.securityLevel === "high") {
		tradeoffs.push(
			"Security level is high; the common core may not satisfy stricter security review checklists.",
		);
	}
	return { score, reasons, tradeoffs };
}

/** Score a built-in profile against the captured answers. */
function scoreBuiltIn(p: BuiltInProfile, answers: RequirementsAnswers): Scored & { builtIn: BuiltInProfile } {
	let score = 50;
	const reasons: string[] = [];
	const tradeoffs: string[] = [];

	if (p.applicationType === answers.applicationType) {
		score += 15;
		reasons.push(`Application type "${answers.applicationType}" matches.`);
	}
	if (p.domain === answers.domain) {
		score += 15;
		reasons.push(`Domain "${answers.domain}" matches.`);
	}
	if (p.regulated === answers.regulated) {
		score += 10;
		reasons.push(`Regulated flag (${answers.regulated ? "yes" : "no"}) matches.`);
	}
	if (p.developmentMethod === answers.developmentMethod) {
		score += 5;
		reasons.push(`Development method "${answers.developmentMethod}" matches.`);
	}
	if (p.securityLevel === answers.securityLevel) {
		score += 5;
		reasons.push(`Security level "${answers.securityLevel}" matches.`);
	}

	if (p.requiredSections.length > 0) {
		tradeoffs.push(
			`Adds required sections: ${p.requiredSections.join(", ")}.`,
		);
	}
	if (p.outputVariant === "compliance" && !answers.regulated) {
		tradeoffs.push(
			"Output variant is compliance-oriented even though the project is not flagged as regulated.",
		);
	}

	return { score: Math.min(100, score), reasons, tradeoffs, builtIn: p };
}

/** Find the closest (highest-score) built-in profile, regardless of exact match. */
export function closestBuiltInProfile(answers: RequirementsAnswers): BuiltInProfile | undefined {
	const recommended = recommendProfiles(answers).find(
		(r) => r.kind === "built-in" && r.builtIn !== undefined,
	);
	return recommended?.builtIn;
}

/** Built-in profile library (read-only). */
export function getBuiltInProfiles(): ReadonlyArray<BuiltInProfile> {
	return DEFAULT_PROFILE_LIBRARY;
}

/** Look up a built-in profile by id. */
export function findBuiltInProfile(profileId: string): BuiltInProfile | undefined {
	return DEFAULT_PROFILE_LIBRARY.find((p) => p.profileId === profileId);
}

/**
 * Compose the persisted profile from a chosen built-in profile plus
 * the answers that produced it. `researchSources` is empty unless the
 * user later pastes research citations.
 */
export function composeProfile(
	builtIn: BuiltInProfile,
	answers: RequirementsAnswers,
	researchConsent: boolean,
	researchSources: string[] = [],
): RequirementsProfile {
	const now = new Date().toISOString();
	return {
		version: REQUIREMENTS_PROFILE_VERSION,
		profileId: builtIn.profileId,
		profileKind: builtIn.profileId === COMMON_PSRS_CORE_PROFILE_ID ? "common-core" : "built-in",
		applicationType: builtIn.applicationType,
		domain: builtIn.domain,
		developmentMethod: builtIn.developmentMethod,
		regulated: builtIn.regulated,
		securityLevel: builtIn.securityLevel,
		requiredSections: [...builtIn.requiredSections],
		conditionalQuestions: buildConditionalQuestions(answers),
		outputVariant: builtIn.outputVariant,
		createdAt: now,
		researchConsent,
		researchSources,
	};
}

/** Build a short list of conditional questions based on the answers. */
export function buildConditionalQuestions(answers: RequirementsAnswers): string[] {
	const out: string[] = [];
	if (answers.domain === "banking") {
		out.push("Does it process money or financial records?");
		out.push("Are transactions reversible?");
		out.push("Is an audit history required?");
	}
	if (answers.domain === "healthcare") {
		out.push("Does it store patient data?");
		out.push("Who can access patient records?");
		out.push("What retention rules apply?");
	}
	if (answers.applicationType === "ai") {
		out.push("What data does the model receive?");
		out.push("What is the minimum accepted accuracy?");
		out.push("Is human review required?");
	}
	if (answers.regulated) {
		out.push("Which regulations must this product comply with?");
	}
	return out;
}

/** Compact profile metadata (subset safe to inject into stage prompts). */
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
