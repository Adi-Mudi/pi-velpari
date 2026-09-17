/**
 * Atomic-tier doctor gate — verdict loader (Phase 4 of reviewer plan).
 *
 * **Migration:** every deterministic rule that previously lived here
 * (base-core missing, tier-specific missing, cohesion, verification,
 * testable, complexity > 10, EARS pattern, argCount, coupling, risk)
 * has been moved to the reviewer sub-agent. The reviewer writes a
 * structured verdict JSON to
 * `<runDir>/atomic-function/scouts/reviewer-report.json`.
 *
 * This module's sole job is now to **load** that verdict and surface its
 * issues as `DiagnosticItem`s — errors block publish, warnings are
 * advisory (mirrors the v1.2.1 publish-gate policy).
 *
 * The doctor remains the publish gate; it just no longer re-derives the
 * rules. Single source of truth = reviewer verdict.
 *
 * Layer 1 — doctor check. Imports only Layer 0.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveReviewerVerdictPath } from "../../core/paths.js";
import type { AtomicProfile } from "../../core/atomic-tier.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Reviewer verdict JSON shape (see skills/agents/reviewer.md). */
export interface ReviewerIssue {
	severity: "error" | "warning" | "info";
	rule: string;
	location?: string;
	message: string;
	suggestion?: string;
}

export interface ReviewerVerdict {
	verdict: "approve" | "needs-fix" | "block";
	issues: ReviewerIssue[];
	summary: string;
	timestamp: string;
}

/**
 * Load the reviewer verdict JSON for the latest atomic-function run and
 * surface its issues as a `DiagnosticSection`. The doctor gate consumes
 * this — it does NOT re-derive any rule.
 *
 * Errors (returned as `error` DiagnosticItems) block publish; warnings are
 * advisory (v1.2.1 policy).
 *
 * Returns a clear `error` when the verdict file is missing — the gate
 * must never silently pass through a stage that never ran the reviewer
 * (tier gate skipped it intentionally, so this is expected; the error
 * tells the developer that the gate could not validate).
 */
export function loadReviewerVerdict(
	cwd: string,
	profile: AtomicProfile,
): DiagnosticSection {
	const title = `Atomic tier (${profile.tier} / class ${profile.safetyClass} / SIL ${profile.sil}) — reviewer verdict`;

	const verdictPath = resolveReviewerVerdictPath(cwd);
	if (!verdictPath) {
		return {
			title,
			items: [
				{
					status: "error",
					message:
						`Reviewer verdict not found. Expected <runDir>/atomic-function/scouts/reviewer-report.json. ` +
						`Either re-run /velpari-atomic-function (the tier/overlay gate may have skipped the reviewer) ` +
						`or check that the reviewer sub-agent was bootstrapped (.pi/agents/reviewer.md).`,
					suggestion: suggestionFor("atomic-rows-missing"),
				},
			],
		};
	}

	let verdict: ReviewerVerdict;
	try {
		verdict = JSON.parse(readFileSync(verdictPath, "utf8")) as ReviewerVerdict;
	} catch (err) {
		return {
			title,
			items: [
				{
					status: "error",
					message:
						`Reviewer verdict at ${verdictPath} is not valid JSON: ` +
						`${err instanceof Error ? err.message : String(err)}.`,
					suggestion: suggestionFor("atomic-rows-missing"),
				},
			],
		};
	}

	if (!isValidReviewerVerdict(verdict)) {
		return {
			title,
			items: [
				{
					status: "error",
					message:
						`Reviewer verdict at ${verdictPath} has invalid shape (verdict / issues[] / summary / timestamp required). ` +
						`See skills/agents/reviewer.md for the schema.`,
					suggestion: suggestionFor("atomic-rows-missing"),
				},
			],
		};
	}

	const items: DiagnosticItem[] = [];
	let errors = 0;
	let warnings = 0;
	let infos = 0;

	for (const issue of verdict.issues) {
		if (issue.severity === "error") errors++;
		else if (issue.severity === "warning") warnings++;
		else infos++;
		const loc = issue.location ? ` [${issue.location}]` : "";
		const sugg = issue.suggestion
			? `\n    Fix: ${issue.suggestion}`
			: "";
		items.push({
			status: issue.severity,
			message: `${issue.rule}${loc}: ${issue.message}${sugg}`,
		});
	}

	// Summary line — verdict + counts
	const verdictSummary: DiagnosticItem = {
		status: errors > 0 ? "error" : warnings > 0 ? "warning" : "ok",
		message:
			`Reviewer verdict at ${verdictPath}: ${verdict.verdict}; ` +
			`${errors} error(s), ${warnings} warning(s), ${infos} info. ` +
			`(tier=${profile.tier}, class=${profile.safetyClass}, SIL=${profile.sil}). ` +
			`Reviewer summary: ${verdict.summary}`,
	};
	items.unshift(verdictSummary);

	return { title, items };
}

/** Schema guard for the reviewer verdict JSON. */
function isValidReviewerVerdict(x: unknown): x is ReviewerVerdict {
	if (!x || typeof x !== "object") return false;
	const v = x as Record<string, unknown>;
	if (v.verdict !== "approve" && v.verdict !== "needs-fix" && v.verdict !== "block") return false;
	if (!Array.isArray(v.issues)) return false;
	if (typeof v.summary !== "string") return false;
	if (typeof v.timestamp !== "string") return false;
	for (const issue of v.issues) {
		if (!issue || typeof issue !== "object") return false;
		const i = issue as Record<string, unknown>;
		if (i.severity !== "error" && i.severity !== "warning" && i.severity !== "info") return false;
		if (typeof i.rule !== "string") return false;
		if (typeof i.message !== "string") return false;
	}
	return true;
}
