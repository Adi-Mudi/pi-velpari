/**
 * Built-in profile library + scoring engine.
 *
 * Phase C split: types/persistence moved to core/profile.ts; this file owns
 * the deterministic built-in library + recommendation algorithm.
 *
 * Adding a new built-in profile = add one entry to DEFAULT_PROFILE_LIBRARY
 * below. No other file needs to change.
 */

import type {
	BuiltInProfile,
	ProfileRecommendation,
	RequirementsAnswers,
	RequirementsProfile,
} from "./profile.js";
import { COMMON_PSRS_CORE_PROFILE_ID, REQUIREMENTS_PROFILE_VERSION } from "./profile.js";

/** Stable id for the common PSRS core profile (re-exported for callers). */
export { COMMON_PSRS_CORE_PROFILE_ID };

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

interface Scored {
	score: number;
	reasons: string[];
	tradeoffs: string[];
}

interface ScoredBuiltIn extends Scored {
	builtIn: BuiltInProfile;
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
	built.sort((a, b) => b.score - a.score || a.builtIn.profileId.localeCompare(b.builtIn.profileId));
	for (const b of built.slice(0, 2)) {
		recs.push({
			kind: "built-in",
			profileId: b.builtIn.profileId,
			label: `Use built-in profile: ${b.builtIn.profileId}`,
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

/** Find the closest (highest-score) built-in profile, regardless of exact match. */
export function closestBuiltInProfile(answers: RequirementsAnswers): BuiltInProfile | undefined {
	const recommended = recommendProfiles(answers).find(
		(r) => r.kind === "built-in" && r.builtIn !== undefined,
	);
	return recommended?.builtIn;
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
function scoreBuiltIn(p: BuiltInProfile, answers: RequirementsAnswers): ScoredBuiltIn {
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
