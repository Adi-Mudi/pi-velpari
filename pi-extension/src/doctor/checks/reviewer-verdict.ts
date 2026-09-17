/**
 * Reviewer verdict loader (Plan D — generalized).
 *
 * **Migration (Plan A):** every deterministic rule that previously lived in
 * doctor/checks/atomic-tier.ts (base-core missing, tier-specific missing,
 * cohesion, verification, testable, complexity, EARS, argCount, coupling,
 * risk) has been moved to the reviewer sub-agent. The reviewer writes a
 * structured verdict JSON to `<runDir>/<stage>/scouts/<reviewer-role>-report.json`.
 *
 * **Plan D — generalization:** the same pattern applies to 3 more stages:
 *   - atomic-function / pseudocode / testplan / architecture-generator
 * Each has its own reviewer role and verdict path. This module provides
 * ONE generic `loadReviewerVerdictForStage` and 3 thin per-stage wrappers.
 *
 * The doctor remains the publish gate; it just no longer re-derives the
 * rules. Single source of truth = reviewer verdict.
 *
 * Layer 1 — doctor check. Imports only Layer 0.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRunDir } from "../../core/paths.js";
import { shouldRunReviewer } from "../../core/atomic-tier.js";
import { loadFilesConfig } from "../../core/config.js";
import { overlayRequiresReviewerFor } from "../../stages/registry.js";
import type { AtomicProfile } from "../../core/atomic-tier.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Reviewer verdict JSON shape — identical across all 4 reviewer stages. */
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

/** Per-stage mapping: which reviewer role writes the verdict at which
 *  stage's scout directory. Plan D — atomic-function was the original;
 *  pseudocode / testplan / design are the new generalisations. */
export interface ReviewerStageSpec {
	stageKey: string;
	reviewerRole: string;
	verdictSubpath: string; // relative to <runDir>
	titlePrefix: string; // diagnostic section title
}

/** Per-call inputs to the gate. */
export interface LoadReviewerInput {
	cwd: string;
	spec: ReviewerStageSpec;
	profile: AtomicProfile;
}

export const REVIEWER_STAGE_SPECS: readonly ReviewerStageSpec[] = [
	{
		stageKey: "atomic-function",
		reviewerRole: "reviewer",
		verdictSubpath: "atomic-function/scouts/reviewer-report.json",
		titlePrefix: "Atomic tier",
	},
	{
		stageKey: "pseudocode",
		reviewerRole: "pseudocode-reviewer",
		verdictSubpath: "pseudocode/scouts/pseudocode-reviewer-report.json",
		titlePrefix: "Pseudocode",
	},
	{
		stageKey: "testplan",
		reviewerRole: "testplan-reviewer",
		verdictSubpath: "testplan/scouts/testplan-reviewer-report.json",
		titlePrefix: "Test plan",
	},
	{
		stageKey: "architecture-generator",
		reviewerRole: "design-reviewer",
		verdictSubpath: "design/scouts/design-reviewer-report.json",
		titlePrefix: "Design",
	},
];

/**
 * Load the reviewer verdict for a specific stage. Walks the latest
 * <runDir>/<stage>/scouts/<reviewer-role>-report.json and surfaces its
 * issues as a `DiagnosticSection`. Errors block publish; warnings are
 * advisory (v1.2.1 policy).
 *
 * Returns a clear `error` when the verdict file is missing — the gate
 * must never silently pass through a stage that never ran the reviewer
 * (tier gate skipped it intentionally, so this is expected; the error
 * tells the developer that the gate could not validate).
 */
export function loadReviewerVerdictForStage(
	cwd: string,
	spec: ReviewerStageSpec,
	tierContext: string,
	profile: AtomicProfile,
): DiagnosticSection {
	const title = `${spec.titlePrefix} reviewer verdict (${tierContext})`;

	const verdictPath = resolveStageVerdictPath(cwd, spec);
	if (!verdictPath) {
		// Plan D — when the reviewer verdict is missing, check whether the
		// tier + overlay gate would have skipped the reviewer. If yes, emit
		// an info (no error) so basic-tier projects don't break. If no,
		// emit an error (the reviewer should have run).
		const config = loadFilesConfig(cwd);
		const overlayRequiresReviewer = config.atomic?.overlayId
			? overlayRequiresReviewerFor(cwd, config.atomic.overlayId)
			: false;
		const reviewerExpected = shouldRunReviewer({
			profile,
			overlayRequiresReviewer,
			reviewerMode: profile.reviewerMode,
		});
		if (!reviewerExpected) {
			return {
				title,
				items: [
					{
						status: "info",
						message:
							`Reviewer was skipped for ${spec.stageKey} (tier=${profile.tier} / class=${profile.safetyClass} / SIL=${profile.sil}; ` +
							`reviewerMode=${profile.reviewerMode ?? "tier-default"}). ` +
							`No verdict file expected at <runDir>/${spec.verdictSubpath}.`,
					},
				],
			};
		}
		return {
			title,
			items: [
				{
					status: "error",
					message:
						`Reviewer verdict not found. Expected <runDir>/${spec.verdictSubpath}. ` +
						`The reviewer should have run (tier + overlay gate allows it) — re-run /velpari-${spec.stageKey} ` +
						`and check that the reviewer sub-agent was bootstrapped (.pi/agents/${spec.reviewerRole}.md).`,
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
						`See skills/agents/${spec.reviewerRole}.md for the schema.`,
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
			`(${tierContext}). Reviewer summary: ${verdict.summary}`,
	};
	items.unshift(verdictSummary);

	return { title, items };
}

/**
 * Resolve the verdict path for a specific stage. Walks the runs directory
 * and returns the most recent `<runDir>/<stage>/scouts/<reviewer-role>-report.json`.
 * Returns null when no verdict file exists.
 */
function resolveStageVerdictPath(cwd: string, spec: ReviewerStageSpec): string | null {
	// For the latest run directory only (atomic-function pattern).
	const runsDir = join(cwd, ".IDE_Plans", "velpari", "runs");
	if (!existsSync(runsDir)) return null;
	const runs = readdirSyncSorted(runsDir);
	if (runs.length === 0) return null;
	// Walk from latest to earliest.
	for (let i = runs.length - 1; i >= 0; i--) {
		const runId = runs[i]!;
		const runDir = buildRunDir(runId, cwd);
		const verdictPath = join(runDir, spec.verdictSubpath);
		if (existsSync(verdictPath)) return verdictPath;
	}
	return null;
}

function readdirSyncSorted(dir: string): string[] {
	return readdirSync(dir).sort();
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
