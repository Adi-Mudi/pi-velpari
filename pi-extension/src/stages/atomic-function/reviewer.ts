/**
 * PHASE 4 — reviewer helpers for /velpari-atomic-function (dedicated layer).
 *
 * Owns the verdict shape + the public schema guard + the verdict → doctor
 * issue mapping. Re-exports the underlying loader from
 * `doctor/checks/atomic-tier` so this layer can reference the verdict
 * without owning a copy of the load logic.
 *
 * The doctor gate remains the **consumer** of the verdict — it folds
 * `verdictToDoctorIssues(v)` into its `Atomic tier` diagnostic section.
 * The reviewer verdict is the single source of truth for tier checks.
 *
 * Layer 1 — same-layer import from `doctor/` is allowed (stages/ and
 * doctor/ are both L1).
 */

import {
	loadReviewerVerdict as _loadReviewerVerdict,
	type ReviewerIssue,
	type ReviewerVerdict,
} from "../../doctor/checks/atomic-tier.js";
import type { DiagnosticItem } from "../../doctor/_types.js";

/** Re-exported so the dedicated layer can name the type without reaching
 *  into `doctor/` directly. */
export type { ReviewerVerdict, ReviewerIssue };

/** Re-exported loader. Walks the most recent run's
 *  `<runDir>/atomic-function/scouts/reviewer-report.json`. */
export const loadReviewerVerdict = _loadReviewerVerdict;

/**
 * Public schema guard for the reviewer verdict JSON. Returns true when
 * `x` has the exact shape the reviewer agent emits:
 *
 *   {
 *     verdict: "approve" | "needs-fix" | "block",
 *     issues:  [{ severity, rule, message, location?, suggestion? }],
 *     summary: string,
 *     timestamp: string
 *   }
 */
export function isReviewerVerdict(x: unknown): x is ReviewerVerdict {
	if (!x || typeof x !== "object") return false;
	const v = x as Record<string, unknown>;
	if (v.verdict !== "approve" && v.verdict !== "needs-fix" && v.verdict !== "block") {
		return false;
	}
	if (!Array.isArray(v.issues)) return false;
	if (typeof v.summary !== "string") return false;
	if (typeof v.timestamp !== "string") return false;
	for (const issue of v.issues) {
		if (!issue || typeof issue !== "object") return false;
		const i = issue as Record<string, unknown>;
		if (i.severity !== "error" && i.severity !== "warning" && i.severity !== "info") {
			return false;
		}
		if (typeof i.rule !== "string") return false;
		if (typeof i.message !== "string") return false;
	}
	return true;
}

/**
 * Map a `ReviewerVerdict`'s `issues[]` to `DiagnosticItem[]` for the
 * doctor gate. Each issue becomes one item with the same severity
 * (`error` → `error`, `warning` → `warning`, `info` → `info`), prefixed
 * with `[<rule>]` and the AF-N location when present.
 *
 * The mapping is intentionally additive: the verdict never DECREASES a
 * doctor's own finding. Doctor errors stay errors regardless of the
 * verdict.
 */
export function verdictToDoctorIssues(v: ReviewerVerdict): DiagnosticItem[] {
	return v.issues.map((issue) => ({
		status: issue.severity === "error" ? "error" : issue.severity === "warning" ? "warning" : "info",
		message: `[${issue.rule}]${issue.location ? ` ${issue.location}:` : ""} ${issue.message}`,
		suggestion: issue.suggestion,
	}));
}
