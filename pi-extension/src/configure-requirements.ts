/**
 * /velpari-configure-requirements handler.
 *
 * Captures the project's requirements profile and persists it to
 * `.pi/velpari/requirements-profile.json`. Profile selection follows
 * the Velpari Requirements Factory design §11 and the 2026-09-05
 * research-based profile workflow rules:
 *
 *   1. Ask core project questions (what/who/problem/novelty/platforms/etc.)
 *   2. Ask application-type/domain/development-method/securityLevel
 *   3. Ask for web-research consent (BEFORE recommendations)
 *   4. If consent, hand off a compact research prompt to the parent
 *      LLM via pi.sendUserMessage — but the prompt explicitly says
 *      profile selection is pending and never saves a profile.
 *   5. Compute deterministic recommendations (common PSRS core +
 *      closest built-ins with scores, reasons, trade-offs).
 *   6. User picks a profile via ctx.ui.select.
 *   7. If no built-in matches at all, show fallback actions
 *      (Use common PSRS core / Use closest built-in / Update Velpari /
 *      Stop) via ctx.ui.select. No silent invention.
 *
 * Native Pi selection is used for every fixed-choice prompt (novelty,
 * application type, domain, development method, security level, profile
 * recommendation, fallback action). Free-text answers use
 * `ctx.ui.input(title, placeholder)`. Yes/no consent uses
 * `ctx.ui.confirm(title, message)`.
 *
 * If no profile matches, the handler reports the gap and surfaces
 * the four documented fallback actions. It never invents a profile
 * silently. The common PSRS core is a real, valid selection, not a
 * fallback because nothing matched.
 *
 * The extension never fetches the web itself, never adds dependencies,
 * never spawns subagents from this handler, and never silently mutates
 * the saved profile.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	APPLICATION_TYPES,
	COMMON_PSRS_CORE_PROFILE,
	COMMON_PSRS_CORE_PROFILE_ID,
	DEVELOPMENT_METHODS,
	DOMAINS,
	closestBuiltInProfile,
	composeProfile,
	findBuiltInProfile,
	loadRequirementsProfile,
	recommendProfiles,
	saveRequirementsProfile,
	type ApplicationType,
	type BuiltInProfile,
	type DevelopmentMethod,
	type Domain,
	type ProfileRecommendation,
	type ProfileSection,
	type RequirementsAnswers,
	type RequirementsProfile,
	type SecurityLevel,
} from "./requirements-profile.js";



const CORE_QUESTIONS: ReadonlyArray<{ key: keyof RequirementsAnswers; prompt: string; required: boolean }> = [
	{ key: "what", prompt: "What are you building? (one sentence)", required: true },
	{ key: "who", prompt: "Who is it for?", required: true },
	{ key: "problem", prompt: "What problem does it solve?", required: true },
];

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

const FALLBACK_OPTIONS = [
	"Use common PSRS core",
	"Use closest built-in profile",
	"Update Velpari with a new profile",
	"Stop",
] as const;

/** Native-Pi selection prompt that maps the user's picked option to a value. */
async function askSelect<T extends string>(
	ctx: ExtensionCommandContext,
	title: string,
	options: ReadonlyArray<string>,
): Promise<T | undefined> {
	const labels = options.length > 0 ? options : ["(no options)"];
	const picked = await ctx.ui.select(title, labels as string[]);
	if (picked === undefined) return undefined;
	return picked as T;
}

async function askInput(
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

async function askYesNo(
	ctx: ExtensionCommandContext,
	title: string,
	message: string,
	defaultValue = false,
): Promise<boolean> {
	const answer = await ctx.ui.confirm(title, message);
	if (answer === undefined) return defaultValue;
	return answer;
}

async function askApplicationType(ctx: ExtensionCommandContext): Promise<ApplicationType | undefined> {
	const labels: string[] = APPLICATION_TYPES.map((t) => titleize(t));
	const picked = await askSelect<string>(ctx, "Application type", labels);
	if (picked === undefined) return undefined;
	const idx = labels.indexOf(picked);
	return APPLICATION_TYPES[idx];
}

async function askDomain(ctx: ExtensionCommandContext): Promise<Domain | undefined> {
	const labels: string[] = DOMAINS.map((d) => titleize(d));
	const picked = await askSelect<string>(ctx, "Domain", labels);
	if (picked === undefined) return undefined;
	const idx = labels.indexOf(picked);
	return DOMAINS[idx];
}

async function askDevelopmentMethod(ctx: ExtensionCommandContext): Promise<DevelopmentMethod | undefined> {
	const labels: string[] = DEVELOPMENT_METHODS.map((m) => titleize(m));
	const picked = await askSelect<string>(ctx, "Development method", labels);
	if (picked === undefined) return undefined;
	const idx = labels.indexOf(picked);
	return DEVELOPMENT_METHODS[idx];
}

async function askSecurityLevel(ctx: ExtensionCommandContext): Promise<SecurityLevel | undefined> {
	const labels: string[] = SECURITY_OPTIONS.map((o) => SECURITY_LABELS[o]);
	const picked = await askSelect<string>(ctx, "Security level", labels);
	if (picked === undefined) return undefined;
	const idx = labels.indexOf(picked);
	return SECURITY_OPTIONS[idx];
}

async function askNovelty(ctx: ExtensionCommandContext): Promise<RequirementsAnswers["novelty"] | undefined> {
	const labels: string[] = NOVELTY_OPTIONS.map((o) => NOVELTY_LABELS[o]);
	const picked = await askSelect<string>(ctx, "Novelty", labels);
	if (picked === undefined) return undefined;
	const idx = labels.indexOf(picked);
	return NOVELTY_OPTIONS[idx];
}

async function askRegulated(ctx: ExtensionCommandContext, securityLevel: SecurityLevel): Promise<boolean> {
	const result = await askYesNo(
		ctx,
		"Regulated?",
		"Is this project formally regulated (e.g. banking, healthcare, automotive)?",
		securityLevel === "high",
	);
	return result;
}

async function askPlatforms(ctx: ExtensionCommandContext): Promise<string[]> {
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

function titleize(token: string): string {
	return token
		.split(/[-_\s]+/)
		.map((p) => p.length === 0 ? "" : p.charAt(0).toUpperCase() + p.slice(1))
		.join(" ");
}

function validateAnswers(answers: Partial<RequirementsAnswers>): string | null {
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

function renderAnswersSummary(answers: RequirementsAnswers): string {
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

function renderRecommendation(r: ProfileRecommendation): string {
	const head = `[${r.score}] ${r.profileId} (${r.kind})`;
	const reasons = r.reasons.map((x) => `+ ${x}`).join("\n");
	const tradeoffs = r.tradeoffs.map((x) => `~ ${x}`).join("\n");
	return `${head}\n${reasons}\n${tradeoffs}`.trim();
}

function renderRecommendationsBlock(recs: ReadonlyArray<ProfileRecommendation>): string {
	if (recs.length === 0) return "(no recommendations)";
	return recs.map((r) => renderRecommendation(r)).join("\n\n");
}

/**
 * Build the recommendation labels shown in the select prompt, with
 * an explicit "Stop (cancel)" option at the end. Returns both the
 * labels and a way to map them back to ProfileRecommendation entries.
 */
function buildRecommendationLabels(recs: ReadonlyArray<ProfileRecommendation>): string[] {
	const labels: string[] = [];
	for (const r of recs) {
		labels.push(`${r.label} (score ${r.score})`);
	}
	labels.push("Stop — cancel without saving");
	return labels;
}

function pickRecommendation(
	recs: ReadonlyArray<ProfileRecommendation>,
	pickedLabel: string,
): ProfileRecommendation | undefined {
	if (pickedLabel.startsWith("Stop — cancel")) return undefined;
	// Match by leading "label (score ...)" prefix.
	for (const r of recs) {
		if (pickedLabel.startsWith(r.label)) return r;
	}
	return undefined;
}

export async function handleConfigureRequirements(
	ctx: ExtensionCommandContext,
	pi?: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	// Detect any existing profile.
	const existing = loadRequirementsProfile(cwd);
	if (existing) {
		ctx.ui.notify(
			`Existing profile: ${existing.profileId}@${existing.version} (kind=${existing.profileKind}, saved ${existing.createdAt}). ` +
				`Re-running will overwrite.`,
			"info",
		);
	}

	// 1. Core questions.
	const answers: Partial<RequirementsAnswers> = {};
	for (const q of CORE_QUESTIONS) {
		const value = await askInput(ctx, q.prompt, "required", q.required);
		if (!value) {
			ctx.ui.notify("Configuration aborted (missing required answer).", "error");
			return;
		}
		(answers as Record<string, unknown>)[q.key] = value;
	}

	// 2. Novelty + platforms + booleans.
	const novelty = await askNovelty(ctx);
	if (!novelty) {
		ctx.ui.notify("Configuration aborted (missing novelty).", "error");
		return;
	}
	answers.novelty = novelty;

	const platforms = await askPlatforms(ctx);
	answers.platforms = platforms;

	answers.sensitiveData = await askYesNo(
		ctx,
		"Sensitive data?",
		"Does it handle sensitive or regulated data?",
		false,
	);
	answers.externalSystems = await askYesNo(
		ctx,
		"External systems?",
		"Are external systems or services required?",
		false,
	);
	answers.existingCodebase = await askYesNo(
		ctx,
		"Existing codebase?",
		"Is there an existing codebase, or is this a new system?",
		false,
	);

	// 3. Type / domain / method / security.
	const applicationType = await askApplicationType(ctx);
	if (!applicationType) {
		ctx.ui.notify("Configuration aborted (missing application type).", "error");
		return;
	}
	answers.applicationType = applicationType;

	const domain = await askDomain(ctx);
	if (!domain) {
		ctx.ui.notify("Configuration aborted (missing domain).", "error");
		return;
	}
	answers.domain = domain;

	const developmentMethod = await askDevelopmentMethod(ctx);
	if (!developmentMethod) {
		ctx.ui.notify("Configuration aborted (missing development method).", "error");
		return;
	}
	answers.developmentMethod = developmentMethod;

	const securityLevel = await askSecurityLevel(ctx);
	if (!securityLevel) {
		ctx.ui.notify("Configuration aborted (missing security level).", "error");
		return;
	}
	answers.securityLevel = securityLevel;

	answers.regulated = await askRegulated(ctx, securityLevel);

	const validationError = validateAnswers(answers);
	if (validationError) {
		ctx.ui.notify(`Configuration aborted: ${validationError}`, "error");
		return;
	}

	const fullAnswers = answers as RequirementsAnswers;
	ctx.ui.notify(`Captured answers:\n${renderAnswersSummary(fullAnswers)}`, "info");

	// 4. Research consent BEFORE recommendations. The handoff always
	//    says profile selection is pending and never saves a profile.
	const researchConsent = await askYesNo(
		ctx,
		"Web research?",
		"Allow a one-shot web-research handoff to the parent LLM to surface " +
			"community findings (similar products, official docs, regulatory references)? " +
			"Findings are suggestions only and never become requirements without your " +
			"explicit confirmation. They will not be used to pick or save a profile.",
	);

	if (researchConsent && pi) {
		const prompt = buildResearchPrompt(fullAnswers);
		pi.sendUserMessage(prompt);
		ctx.ui.notify(
			"Research handoff sent to parent LLM. Findings (if any) will appear as a follow-up; " +
				"paste citations you want stored on the profile after selection.",
			"info",
		);
	} else if (researchConsent && !pi) {
		ctx.ui.notify(
			"Web research was requested but no ExtensionAPI is available; skipping. " +
				"You can add citations later by editing the saved profile JSON.",
			"warning",
		);
	}

	// 5. Compute recommendations deterministically.
	const recs = recommendProfiles(fullAnswers);
	const hasExactMatch = recs.some(
		(r) => r.kind === "built-in" && r.builtIn?.applicationType === fullAnswers.applicationType && r.builtIn?.domain === fullAnswers.domain,
	);
	ctx.ui.notify(
		`Profile recommendations (deterministic, sorted by score then profileId):\n${renderRecommendationsBlock(recs)}`,
		"info",
	);

	let chosen: BuiltInProfile;
	if (hasExactMatch) {
		const labels = buildRecommendationLabels(recs);
		const picked = await askSelect<string>(ctx, "Choose a profile", labels);
		if (picked === undefined) {
			ctx.ui.notify("Configuration cancelled (no profile selected).", "info");
			return;
		}
		const rec = pickRecommendation(recs, picked);
		if (!rec || !rec.builtIn) {
			ctx.ui.notify("Configuration cancelled (no profile selected).", "info");
			return;
		}
		chosen = rec.builtIn;
	} else {
		const fallback = await runFallbackActions(ctx, cwd);
		if (fallback === "stop" || fallback === undefined) {
			ctx.ui.notify("Configuration cancelled. No profile was saved.", "info");
			return;
		}
		if (fallback === "core") {
			chosen = COMMON_PSRS_CORE_PROFILE;
		} else {
			chosen = closestBuiltInProfile(fullAnswers) ?? COMMON_PSRS_CORE_PROFILE;
		}
	}

	// 7. Confirm before saving.
	const confirmSave = await askYesNo(
		ctx,
		"Confirm profile selection?",
		`Save the selected profile (${chosen.profileId}) to .pi/velpari/requirements-profile.json?`,
	);
	if (!confirmSave) {
		ctx.ui.notify("Configuration cancelled (user declined save).", "info");
		return;
	}

	const profile: RequirementsProfile = composeProfile(
		chosen,
		fullAnswers,
		researchConsent,
		[],
	);
	saveRequirementsProfile(profile, cwd);
	ctx.ui.notify(
		`Profile saved: ${profile.profileId}@${profile.version} (kind=${profile.profileKind}) at .pi/velpari/requirements-profile.json. ` +
			`Required sections: ${profile.requiredSections.join(", ") || "(none)"}.`,
		"info",
	);
}

/**
 * Ask the user to pick a fallback action when no exact built-in profile
 * matches. The action list is shown via `ctx.ui.select`. Common PSRS
 * core and closest built-in are real, valid choices — there is no
 * fake custom-profile action.
 */
export async function runFallbackActions(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<"core" | "closest" | "stop" | undefined> {
	const picked = await askSelect<string>(ctx, "No exact profile match — choose a fallback action", [...FALLBACK_OPTIONS]);
	if (picked === undefined) return undefined;
	if (picked === FALLBACK_OPTIONS[0]) return "core";
	if (picked === FALLBACK_OPTIONS[1]) return "closest";
	if (picked === FALLBACK_OPTIONS[2]) return "stop"; // Update Velpari is treated as "stop" in this scope.
	if (picked === FALLBACK_OPTIONS[3]) return "stop";
	return undefined;
}

/**
 * Compact research prompt handed off to the parent LLM.
 *
 * Important (research-before-selection): this prompt explicitly states
 * that no profile has been selected yet. It does NOT include a final
 * selected profile id, and the parent LLM is told it MUST NOT save or
 * write the profile file. Research findings are suggestions only.
 */
export function buildResearchPrompt(answers: RequirementsAnswers): string {
	const sections: ProfileSection[] = answers.regulated
		? ["security", "audit", "compliance", "privacy"]
		: ["security", "performance"];
	return [
		"Profile selection: PENDING (no profile selected yet; this research MUST NOT save or write a profile).",
		`Application: ${answers.applicationType}`,
		`Domain: ${answers.domain}`,
		`Development method: ${answers.developmentMethod}`,
		`Security level: ${answers.securityLevel}`,
		`Regulated: ${answers.regulated ? "yes" : "no"}`,
		``,
		`Candidate required sections (for context only): ${sections.join(", ")}`,
		``,
		"Research task:",
		"- Find 1-3 official documentation links relevant to the application type.",
		"- Find 1-3 community resources (Stack Overflow / GitHub / blog posts) for the domain.",
		"- Find 1-3 regulatory references if the project is regulated.",
		"- DO NOT invent any requirement. Only cite sources.",
		"- DO NOT select, save, or write any profile. The user will pick the profile after seeing your findings.",
		`- When done, list the URLs so the user can paste them back as citations.`,
	].join("\n");
}
