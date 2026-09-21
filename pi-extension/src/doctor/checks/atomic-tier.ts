/**
 * Atomic-tier doctor gate — verdict loader (Phase 4 of reviewer plan;
 * C3 — thin wrapper over the generalized loader).
 *
 * **Migration:** every deterministic rule that previously lived here
 * (base-core missing, tier-specific missing, cohesion, verification,
 * testable, complexity > 10, EARS pattern, argCount, coupling, risk)
 * has been moved to the reviewer sub-agent. The reviewer writes a
 * structured verdict JSON to
 * `<runDir>/atomic-function/scouts/reviewer-report.json`.
 *
 * **C3:** the verdict contract + load logic live in
 * `checks/reviewer-verdict.ts` (one generalized loader for every
 * verifier stage). This module is now a thin per-stage wrapper kept for
 * its callers (`stages/atomic-function/reviewer.ts`,
 * `test/doctor/check-atomic-tier.test.ts`). The atomic-function spec
 * carries `missingVerdict: "always-error"` — the legacy policy this
 * module has always had (basic tier + missing verdict → error).
 *
 * The doctor remains the publish gate; it just no longer re-derives the
 * rules. Single source of truth = reviewer verdict.
 *
 * Layer 1 — doctor check. Imports only Layer 0 + same-layer.
 */

import {
	loadReviewerVerdictForStage,
	REVIEWER_STAGE_SPECS,
	type ReviewerIssue,
	type ReviewerVerdict,
} from "./reviewer-verdict.js";
import type { AtomicProfile } from "../../core/atomic-tier.js";
import type { DiagnosticSection } from "../_types.js";

/** Re-exported so existing callers keep one import site for the contract. */
export type { ReviewerIssue, ReviewerVerdict };

const ATOMIC_FUNCTION_SPEC = REVIEWER_STAGE_SPECS.find(
	(s) => s.stageKey === "atomic-function",
)!;

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
 * (spec policy `missingVerdict: "always-error"`).
 */
export function loadReviewerVerdict(
	cwd: string,
	profile: AtomicProfile,
): DiagnosticSection {
	const tierContext = `tier ${profile.tier} / class ${profile.safetyClass} / SIL ${profile.sil}`;
	return loadReviewerVerdictForStage(cwd, ATOMIC_FUNCTION_SPEC, tierContext, profile);
}
