/**
 * /velpari-configure-requirements handler — slim orchestrator.
 *
 * Phase C: this file used to be the 511-line monolith
 * `discipline/configure-requirements.ts`. After the split it is only the
 * orchestration glue. The actual work lives in:
 *   - ./interview.ts    — 7-step ask block + validation
 *   - ./research.ts     — research-prompt composer
 *   - ./recommend.ts    — labelled pickers + fallback actions
 *   - core/profile.ts        — types + persistence
 *   - core/profiles-library.ts — built-in profile library + scoring
 *
 * Flow (unchanged from pre-Phase-C handler):
 *   1. Ask core questions.
 *   2. Ask novelty + platforms + sensitive/external/existing booleans.
 *   3. Ask applicationType + domain + developmentMethod + securityLevel + regulated.
 *   4. Validate. Capture research consent BEFORE recommendations.
 *   5. If consent and pi available, hand off `buildResearchPrompt` to the parent LLM.
 *   6. Compute recommendations deterministically; user picks.
 *      No exact match → 4-option fallback (Use common core / closest built-in / Update Velpari / Stop).
 *   7. Confirm before saving. Save via core/profile.ts:saveRequirementsProfile.
 *
 * Native Pi selectors are used for every fixed-choice prompt; free-text
 * uses ctx.ui.input; yes/no uses ctx.ui.confirm.
 * If no profile matches, the handler reports the gap and surfaces the four
 * documented fallback actions. It never invents a profile silently.
 * The common PSRS core is a real, valid selection, not a fallback because
 * nothing matched.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	loadRequirementsProfile,
	saveRequirementsProfile,
	type BuiltInProfile,
	type RequirementsAnswers,
} from "../../core/profile.js";
import {
	closestBuiltInProfile,
	COMMON_PSRS_CORE_PROFILE,
	composeProfile,
	recommendProfiles,
} from "../../core/profiles-library.js";
import {
	askApplicationType,
	askDevelopmentMethod,
	askDomain,
	askInput,
	askNovelty,
	askPlatforms,
	askRegulated,
	askSecurityLevel,
	askYesNo,
	CORE_QUESTIONS,
	renderAnswersSummary,
	validateAnswers,
} from "./interview.js";
import { buildResearchPrompt } from "./research.js";
import {
	buildRecommendationLabels,
	pickRecommendation,
	renderRecommendationsBlock,
	runFallbackActions,
} from "./recommend.js";

export async function handleConfigureRequirements(
	ctx: ExtensionCommandContext,
	pi?: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	const existing = loadRequirementsProfile(cwd);
	if (existing) {
		ctx.ui.notify(
			`Existing profile: ${existing.profileId}@${existing.version} (kind=${existing.profileKind}, saved ${existing.createdAt}). ` +
				`Re-running will overwrite.`,
			"info",
		);
	}

	const answers: Partial<RequirementsAnswers> = {};

	// 1. Core questions (3 required free-text).
	for (const q of CORE_QUESTIONS) {
		const value = await askInput(ctx, q.prompt, "required", q.required);
		if (!value) {
			ctx.ui.notify("Configuration aborted (missing required answer).", "error");
			return;
		}
		(answers as Record<string, unknown>)[q.key] = value;
	}

	// 2. Novelty + platforms + sensitive/external/existing booleans.
	const novelty = await askNovelty(ctx);
	if (!novelty) {
		ctx.ui.notify("Configuration aborted (missing novelty).", "error");
		return;
	}
	answers.novelty = novelty;
	answers.platforms = await askPlatforms(ctx);
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

	// Validate before showing the summary.
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

	// 5. Compute recommendations deterministically; user picks.
	const recs = recommendProfiles(fullAnswers);
	const hasExactMatch = recs.some(
		(r) =>
			r.kind === "built-in" &&
			r.builtIn?.applicationType === fullAnswers.applicationType &&
			r.builtIn?.domain === fullAnswers.domain,
	);
	ctx.ui.notify(
		`Profile recommendations (deterministic, sorted by score then profileId):\n${renderRecommendationsBlock(recs)}`,
		"info",
	);

	let chosen: BuiltInProfile;
	if (hasExactMatch) {
		const labels = buildRecommendationLabels(recs);
		const picked = await ctx.ui.select("Choose a profile", labels);
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
		const fallback = await runFallbackActions(ctx);
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

	// 6. Confirm before saving.
	const confirmSave = await askYesNo(
		ctx,
		"Confirm profile selection?",
		`Save the selected profile (${chosen.profileId}) to .pi/velpari/requirements-profile.json?`,
	);
	if (!confirmSave) {
		ctx.ui.notify("Configuration cancelled (user declined save).", "info");
		return;
	}

	const profile = composeProfile(chosen, fullAnswers, researchConsent, []);
	saveRequirementsProfile(profile, cwd);
	ctx.ui.notify(
		`Profile saved: ${profile.profileId}@${profile.version} (kind=${profile.profileKind}) at .pi/velpari/requirements-profile.json. ` +
			`Required sections: ${profile.requiredSections.join(", ") || "(none)"}.`,
		"info",
	);
}
