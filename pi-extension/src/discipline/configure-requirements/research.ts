/**
 * Research-prompt composer for the configure-requirements flow.
 *
 * Phase C split: pulled out of configure-requirements.ts. Builds the
 * compact handoff prompt that the parent LLM receives when the user
 * consents to web research.
 *
 * Important (research-before-selection): this prompt explicitly states
 * that no profile has been selected yet. It does NOT include a final
 * selected profile id, and the parent LLM is told it MUST NOT save or
 * write the profile file. Research findings are suggestions only.
 */

import type { ProfileSection, RequirementsAnswers } from "../../core/profile.js";

/**
 * Build a compact research prompt handed off to the parent LLM.
 *
 * Requirements:
 * - "Profile selection: PENDING" — never claim a profile has been chosen.
 * - "MUST NOT save or write a profile" — the parent LLM is read-only here.
 * - Findings are suggestions only; the user picks the profile afterwards.
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
