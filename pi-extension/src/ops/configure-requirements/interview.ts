/**
 * Interview step — 7-step native Pi UI ask.
 *
 * Phase C split: pulled out of the configure-requirements.ts monolith.
 * Owns the question constants, low-level input/select/yes-no helpers, and
 * the ask* question helpers. The orchestrator (index.ts) calls these in
 * sequence; recommend.ts builds fallbacks; research.ts composes the
 * pre-selection research prompt.
 *
 * Native Pi selectors are used for every fixed-choice prompt. Free-text
 * answers use ctx.ui.input(title, placeholder). Yes/no consent uses
 * ctx.ui.confirm(title, message).
 *
 * No silent invention: missing answer → abort. Empty free-text optional
 * field → empty value (handler treats as "none").
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	APPLICATION_TYPES,
	DEVELOPMENT_METHODS,
	DOMAINS,
	type ApplicationType,
	type DevelopmentMethod,
	type Domain,
	type RequirementsAnswers,
	type SecurityLevel,
} from "../../core/profile.js";

// ---------------------------------------------------------------------------
// Question constants
// ---------------------------------------------------------------------------

const CORE_QUESTIONS: ReadonlyArray<{ key: keyof RequirementsAnswers; prompt: string; required: boolean }> = [
	{ key: "what", prompt: "What are you building? (one sentence)", required: true },
	{ key: "who", prompt: "Who is it for?", required: true },
	{ key: "problem", prompt: "What problem does it solve?", required: true },
];
/** Exported for the orchestrator in ./index.ts. */
export { CORE_QUESTIONS };

const NOVELTY_OPTIONS = ["new-product", "new-feature", "existing-change"] as const;
const NOVELTY_LABELS = {
	"new-product": "New product",
	"new-feature": "New feature",
	"existing-change": "Change to an existing product",
} as const;

const SECURITY_OPTIONS = ["low", "medium", "high"] as const;
const SECURITY_LABELS = {
	low: "Low",
	medium: "Medium",
	high: "High",
} as const;

/** Fallback options surfaced when no exact built-in profile matches. */
export const FALLBACK_OPTIONS = [
	"Use common PSRS core",
	"Use closest built-in profile",
	"Update Velpari with a new profile",
	"Stop",
] as const;

// ---------------------------------------------------------------------------
// Low-level UI helpers
// ---------------------------------------------------------------------------

/** Native Pi selection prompt that returns the picked label (mapped back by caller). */
export async function askSelect<T extends string>(
	ctx: ExtensionCommandContext,
	title: string,
	options: ReadonlyArray<string>,
): Promise<T | undefined> {
	const labels = options.length > 0 ? options : ["(no options)"];
	const picked = await ctx.ui.select(title, labels as string[]);
	if (picked === undefined) return undefined;
	return picked as T;
}

/** Native Pi input. Re-prompt up to MAX_ATTEMPTS times when `required`. */
export async function askInput(
	ctx: ExtensionCommandContext,
	title: string,
	placeholder: string,
	required: boolean,
): Promise<string> {
	const MAX_ATTEMPTS = 3;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const answer = await ctx.ui.input(title, placeholder);
		if (answer === undefined) return "";
		const trimmed = answer.trim();
		if (!required || trimmed.length > 0) return trimmed;
		ctx.ui.notify("This field is required. Please provide a value.", "error");
	}
	ctx.ui.notify(
		`Aborted after ${MAX_ATTEMPTS} empty attempts. Please run the command again.`,
		"error",
	);
	return "";
}

/** Native Pi confirm. Returns defaultValue when user dismisses (Esc). */
export async function askYesNo(
	ctx: ExtensionCommandContext,
	title: string,
	message: string,
	defaultValue = false,
): Promise<boolean> {
	const answer = await ctx.ui.confirm(title, message);
	if (answer === undefined) return defaultValue;
	return answer;
}

function titleize(token: string): string {
	return token
		.split(/[-_\s]+/)
		.map((p) => (p.length === 0 ? "" : p.charAt(0).toUpperCase() + p.slice(1)))
		.join(" ");
}

// ---------------------------------------------------------------------------
// Higher-level ask* helpers (one per interview question)
// ---------------------------------------------------------------------------

export async function askApplicationType(ctx: ExtensionCommandContext): Promise<ApplicationType | undefined> {
	const labels: string[] = APPLICATION_TYPES.map((t) => titleize(t));
	const picked = await askSelect<string>(ctx, "Application type", labels);
	if (picked === undefined) return undefined;
	const idx = labels.indexOf(picked);
	return APPLICATION_TYPES[idx];
}

export async function askDomain(ctx: ExtensionCommandContext): Promise<Domain | undefined> {
	const labels: string[] = DOMAINS.map((d) => titleize(d));
	const picked = await askSelect<string>(ctx, "Domain", labels);
	if (picked === undefined) return undefined;
	const idx = labels.indexOf(picked);
	return DOMAINS[idx];
}

export async function askDevelopmentMethod(
	ctx: ExtensionCommandContext,
): Promise<DevelopmentMethod | undefined> {
	const labels: string[] = DEVELOPMENT_METHODS.map((m) => titleize(m));
	const picked = await askSelect<string>(ctx, "Development method", labels);
	if (picked === undefined) return undefined;
	const idx = labels.indexOf(picked);
	return DEVELOPMENT_METHODS[idx];
}

export async function askSecurityLevel(ctx: ExtensionCommandContext): Promise<SecurityLevel | undefined> {
	const labels: string[] = SECURITY_OPTIONS.map((o) => SECURITY_LABELS[o]);
	const picked = await askSelect<string>(ctx, "Security level", labels);
	if (picked === undefined) return undefined;
	const idx = labels.indexOf(picked);
	return SECURITY_OPTIONS[idx];
}

export async function askNovelty(
	ctx: ExtensionCommandContext,
): Promise<RequirementsAnswers["novelty"] | undefined> {
	const labels: string[] = NOVELTY_OPTIONS.map((o) => NOVELTY_LABELS[o]);
	const picked = await askSelect<string>(ctx, "Novelty", labels);
	if (picked === undefined) return undefined;
	const idx = labels.indexOf(picked);
	return NOVELTY_OPTIONS[idx];
}

export async function askRegulated(
	ctx: ExtensionCommandContext,
	securityLevel: SecurityLevel,
): Promise<boolean> {
	return askYesNo(
		ctx,
		"Regulated?",
		"Is this project formally regulated (e.g. banking, healthcare, automotive)?",
		securityLevel === "high",
	);
}

export async function askPlatforms(ctx: ExtensionCommandContext): Promise<string[]> {
	const raw = await askInput(
		ctx,
		"Platforms / deployment",
		"web, ios, android (comma-separated; blank to skip)",
		false,
	);
	if (!raw) return [];
	return raw
		.split(",")
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
}

// ---------------------------------------------------------------------------
// Validation + summary
// ---------------------------------------------------------------------------

/** Validate that all required answers are present. Returns null when ok, else error string. */
export function validateAnswers(answers: Partial<RequirementsAnswers>): string | null {
	for (const q of CORE_QUESTIONS) {
		const v = answers[q.key];
		if (typeof v !== "string" || v.length === 0) {
			return `Missing required answer: ${q.key}`;
		}
	}
	if (!answers.novelty) return "Missing novelty choice.";
	if (!answers.applicationType) return "Missing application type.";
	if (!answers.domain) return "Missing domain.";
	if (!answers.developmentMethod) return "Missing development method.";
	if (!answers.securityLevel) return "Missing security level.";
	return null;
}

/** Render the captured answers as a multi-line summary shown to the user. */
export function renderAnswersSummary(answers: RequirementsAnswers): string {
	return [
		`What: ${answers.what}`,
		`Who: ${answers.who}`,
		`Problem: ${answers.problem}`,
		`Novelty: ${answers.novelty}`,
		`Platforms: ${answers.platforms.join(", ") || "(none)"}`,
		`Sensitive data: ${answers.sensitiveData ? "yes" : "no"}`,
		`External systems: ${answers.externalSystems ? "yes" : "no"}`,
		`Existing codebase: ${answers.existingCodebase ? "yes" : "no"}`,
		`Application type: ${answers.applicationType}`,
		`Domain: ${answers.domain}`,
		`Development method: ${answers.developmentMethod}`,
		`Security level: ${answers.securityLevel}`,
		`Regulated: ${answers.regulated ? "yes" : "no"}`,
	].join("\n");
}
