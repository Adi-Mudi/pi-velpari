/**
 * Atomic-tier schema — the single source of truth for the 4-tier atomic-function
 * configuration adopted from ISO/IEC 29110 + the IEC 61508 / IEC 62304 criticality
 * classification.
 *
 *   Entry         — 1 developer, prototype (ISO/IEC 29110 entry profile)
 *   Basic         — small team, single project (29110 basic)
 *   Intermediate  — multi-module, CI, regression (29110 intermediate)
 *   Advanced      — regulated industry, full schema (29110 advanced)
 *
 * The 8 base-core fields are mandatory at every tier. Higher tiers add more.
 * The doctor gate (doctor/checks/atomic-tier.ts) enforces tier-aware rigor.
 *
 * Layer 0 — domain primitive. Imports nothing else from src/.
 */

import type { FilesConfig } from "./config.js";

/** ISO/IEC 29110 tier (the industry-standard tiered profile). */
export type AtomicTier = "entry" | "basic" | "intermediate" | "advanced";

/** IEC 62304 software safety class A/B/C (loss-of-comfort / money / life). */
export type SafetyClass = "A" | "B" | "C";

/** IEC 61508 SIL 1-4 for industrial / functional-safety contexts.
 *  `none` is the default for non-safety projects. */
export type Sil = "none" | "1" | "2" | "3" | "4";

/** Atomic-function profile persisted to `.pi/velpari/files.json`. */
export interface AtomicProfile {
	tier: AtomicTier;
	safetyClass: SafetyClass;
	sil: Sil;
	/** Standards-overlay id from `skills/standards/catalogue.json` (or null). */
	overlayId: string | null;
	/** Per-project reviewer mode (Phase 2 of reviewer plan). Default = tier-driven. */
	reviewerMode?: ReviewerMode;
}

/** The 8 base-core fields — every atomic function MUST declare these at every tier.
 *  Sources: IEEE 29148 (traceability, verification), Yourdon & Constantine 1979
 *  (cohesion), INCOSE C5 singular (purpose), Clean Code + ISO 25010 (testable),
 *  Velpari zero-hallucination rule (source). */
export const BASE_CORE_FIELDS = [
	"afId",
	"name",
	"purpose",
	"signature",
	"source",
	"cohesion",
	"verification",
	"testable",
] as const satisfies readonly AtomicFieldName[];

/** Tier-specific fields layered on top of the base core. */
export const TIER_FIELDS: Record<AtomicTier, readonly AtomicFieldName[]> = {
	entry: [],
	basic: ["calledByFrIds", "designRef", "extractedFrom", "satisfactionFrId", "feasibilityRef"],
	intermediate: [
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
	],
	advanced: [
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
	],
};

/** Every supported atomic-function field name (for compile-time checks). */
export type AtomicFieldName =
	| "afId"
	| "name"
	| "purpose"
	| "signature"
	| "source"
	| "cohesion"
	| "verification"
	| "testable"
	| "calledByFrIds"
	| "designRef"
	| "extractedFrom"
	| "satisfactionFrId"
	| "feasibilityRef"
	| "earsPattern"
	| "inputs"
	| "outputs"
	| "errors"
	| "dependencies"
	| "dbOrIo"
	| "complexity"
	| "coupling"
	| "argCount"
	| "oneLevelAbstr"
	| "nameIntent"
	| "owner"
	| "priority"
	| "securityClass"
	| "risk"
	| "reusability"
	| "modifiabilityNote"
	| "storyPoints"
	| "acceptanceRef"
	| "testRef"
	| "rationale"
	| "changeLog";

/** Cumulative tier fields — higher tiers inherit lower-tier fields.
 *  Entry ⊂ Basic ⊂ Intermediate ⊂ Advanced. */
const TIER_ORDER: readonly AtomicTier[] = [
	"entry",
	"basic",
	"intermediate",
	"advanced",
];

/** Is the field required for the given profile?
 *  Higher tiers inherit lower-tier fields (e.g. intermediate requires
 *  everything basic does, plus 11 intermediate-specific fields). */
export function fieldRequiredFor(profile: AtomicProfile, field: AtomicFieldName): boolean {
	if ((BASE_CORE_FIELDS as readonly AtomicFieldName[]).includes(field)) return true;
	const targetIndex = TIER_ORDER.indexOf(profile.tier);
	for (let i = 0; i <= targetIndex; i++) {
		const tierFields = TIER_FIELDS[TIER_ORDER[i]!] as readonly AtomicFieldName[];
		if (tierFields.includes(field)) return true;
	}
	return false;
}

/** All fields required at the given tier (base-core + tier-specific + lower tiers). */
export function requiredFieldsFor(tier: AtomicTier): readonly AtomicFieldName[] {
	const targetIndex = TIER_ORDER.indexOf(tier);
	const out: AtomicFieldName[] = [...BASE_CORE_FIELDS];
	for (let i = 0; i <= targetIndex; i++) {
		out.push(...TIER_FIELDS[TIER_ORDER[i]!]);
	}
	return out;
}

/** Pull the atomic profile out of a FilesConfig (with defaults). */
export function deriveAtomicProfile(config: Partial<FilesConfig>): AtomicProfile {
	const raw = (config as { atomic?: Partial<AtomicProfile> }).atomic ?? {};
	return {
		tier: isAtomicTier(raw.tier) ? raw.tier : DEFAULT_ATOMIC_PROFILE.tier,
		safetyClass: isSafetyClass(raw.safetyClass) ? raw.safetyClass : DEFAULT_ATOMIC_PROFILE.safetyClass,
		sil: isSil(raw.sil) ? raw.sil : DEFAULT_ATOMIC_PROFILE.sil,
		overlayId: typeof raw.overlayId === "string" ? raw.overlayId : null,
		reviewerMode: isReviewerMode(raw.reviewerMode) ? raw.reviewerMode : DEFAULT_REVIEWER_MODE,
	};
}

/** Validate a profile (returns error strings; empty array = valid). */
export function validateAtomicProfile(profile: AtomicProfile): string[] {
	const errors: string[] = [];
	if (!isAtomicTier(profile.tier)) errors.push(`Invalid tier: ${String(profile.tier)}`);
	if (!isSafetyClass(profile.safetyClass))
		errors.push(`Invalid safetyClass: ${String(profile.safetyClass)}`);
	if (!isSil(profile.sil)) errors.push(`Invalid sil: ${String(profile.sil)}`);
	if (profile.overlayId !== null && typeof profile.overlayId !== "string")
		errors.push(`overlayId must be string or null, got ${typeof profile.overlayId}`);
	return errors;
}

export function isAtomicTier(x: unknown): x is AtomicTier {
	return x === "entry" || x === "basic" || x === "intermediate" || x === "advanced";
}
export function isSafetyClass(x: unknown): x is SafetyClass {
	return x === "A" || x === "B" || x === "C";
}
export function isSil(x: unknown): x is Sil {
	return x === "none" || x === "1" || x === "2" || x === "3" || x === "4";
}

// ---------------------------------------------------------------------------
// Reviewer gate (Phase 2 of reviewer plan)
// ---------------------------------------------------------------------------
// The reviewer sub-agent is the only adversarial critic in Velpari.
// Tier gate: required at advanced, opt-in at intermediate via the
// --velpari-run-reviewer flag, skip at entry. Overlay gate: required
// when the active standards overlay declares requiresReviewer: true.
// User override (per-project) is captured by reviewerMode below.

/** Tiers where the reviewer is gated on by default. */
export const REVIEWER_GATE_RULES: ReadonlySet<AtomicTier> = new Set([
	"intermediate",
	"advanced",
]);

/** Per-project reviewer mode (persisted in files.json:atomic.reviewerMode). */
export type ReviewerMode = "tier-default" | "always" | "never";
export function isReviewerMode(x: unknown): x is ReviewerMode {
	return x === "tier-default" || x === "always" || x === "never";
}
export const DEFAULT_REVIEWER_MODE: ReviewerMode = "tier-default";

/**
 * Single source of truth for "does the reviewer run for this stage iteration".
 *
 * Decision order (later wins):
 *   1. user reviewerMode = "never"  → false (never wins over tier/overlay)
 *   2. user reviewerMode = "always" → true  (always wins over tier)
 *   3. overlay.requiresReviewer === true → true (overlay wins over tier default)
 *   4. tier ∈ REVIEWER_GATE_RULES    → true
 *   5. otherwise                     → false (Entry, Basic without overlay)
 */
interface ReviewerGateInput {
	profile: AtomicProfile;
	overlayRequiresReviewer?: boolean;
	reviewerMode?: ReviewerMode;
}

export function shouldRunReviewer(input: ReviewerGateInput): boolean {
	const mode = input.reviewerMode ?? DEFAULT_REVIEWER_MODE;
	if (mode === "never") return false;
	if (mode === "always") return true;
	if (input.overlayRequiresReviewer === true) return true;
	return REVIEWER_GATE_RULES.has(input.profile.tier);
}

/** Default profile — applied when `.pi/velpari/files.json` carries no atomic
 *  fields (backward-compatible: every existing run starts here). */
export const DEFAULT_ATOMIC_PROFILE: AtomicProfile = {
	tier: "basic",
	safetyClass: "A",
	sil: "none",
	overlayId: null,
	reviewerMode: DEFAULT_REVIEWER_MODE,
};

/** Human-readable label for a tier (UI / docs). */
export function tierLabel(tier: AtomicTier): string {
	switch (tier) {
		case "entry":
			return "Entry — 1 developer, prototype (ISO/IEC 29110 entry profile)";
		case "basic":
			return "Basic — small team, single project (ISO/IEC 29110 basic profile)";
		case "intermediate":
			return "Intermediate — multi-module, CI, regression (ISO/IEC 29110 intermediate)";
		case "advanced":
			return "Advanced — regulated industry, full schema (ISO/IEC 29110 advanced)";
	}
}
