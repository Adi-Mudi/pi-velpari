/**
 * Testplan reviewer verdict loader (Plan D — generalized reviewer).
 *
 * Thin wrapper around `loadReviewerVerdictForStage` for the testplan
 * stage. Reads `<runDir>/testplan/scouts/testplan-reviewer-report.json`
 * and surfaces issues as a `DiagnosticSection`.
 *
 * Layer 1 — doctor check. Imports only Layer 0 + same-layer.
 */

import { loadReviewerVerdictForStage, REVIEWER_STAGE_SPECS } from "./reviewer-verdict.js";
import type { AtomicProfile } from "../../core/atomic-tier.js";
import type { DiagnosticSection } from "../_types.js";

const TESTPLAN_SPEC = REVIEWER_STAGE_SPECS.find((s) => s.stageKey === "testplan")!;

export function loadTestplanReviewerVerdict(cwd: string, profile: AtomicProfile): DiagnosticSection {
	const tierContext = `tier ${profile.tier} / class ${profile.safetyClass} / SIL ${profile.sil}`;
	return loadReviewerVerdictForStage(cwd, TESTPLAN_SPEC, tierContext, profile);
}
