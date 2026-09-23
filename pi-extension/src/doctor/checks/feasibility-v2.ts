/**
 * Feasibility v2 section (feasibility v2, Phase 4).
 *
 * Reports:
 *   1. Published feasibility study vs the v2 template
 *      (validateFeasibilityDoc — all 13 sections + verdict word).
 *   2. Open feasibility session progress while the stage is in flight
 *      (consent, decision, candidates, spikes, selected language) so a
 *      stuck mid-stage run is visible in the doctor report.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../core/paths.js";
import { validateFeasibilityDoc } from "../../core/feasibility-doc.js";
import { loadState } from "../../core/state.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkFeasibilityV2Section(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const title = "Feasibility v2";

	// 1. Published study validation.
	const study = projectName ? resolveDocArtifact("feasibility-study", projectName, cwd) : null;
	if (study && existsSync(study.path)) {
		const result = validateFeasibilityDoc(readFileSync(study.path, "utf8"));
		if (result.ok) {
			items.push({ status: "ok", message: "Feasibility study passes the v2 template." });
		} else {
			for (const issue of result.issues) {
				items.push({
					status: "error",
					message: `${issue.code}: ${issue.message}`,
					suggestion: suggestionFor("feasibility-doc-invalid"),
				});
			}
		}
	} else {
		items.push({
			status: "info",
			message: "No published feasibility study yet.",
			suggestion: suggestionFor("artifact-missing"),
		});
	}

	// 2. Open session progress.
	const state = loadState(cwd);
	const session = state.feasibilitySession;
	if ((state.currentStage === "analyzing-feasibility" || state.currentStage === "analyzed-feasibility") && session) {
		const spikes = session.spikeResults?.length ?? 0;
		const details = [
			`Reuse consent: ${session.reuseConsent === undefined ? "(not asked)" : session.reuseConsent}`,
			`Decision: ${session.decision ?? "(pending)"}`,
			`Language candidates: ${session.languageCandidates?.join(", ") || "(none)"}`,
			`Spike results: ${spikes}`,
			`Selected language: ${session.selectedLanguage ?? "(pending)"}${session.selectedBy ? ` by ${session.selectedBy}` : ""}`,
		];
		const settled = Boolean(session.decision && session.selectedLanguage);
		items.push({
			status: settled ? "ok" : "warning",
			message: settled
				? "Feasibility session settled (decision + language recorded)."
				: "Feasibility session INCOMPLETE — approve will block.",
			details,
			suggestion: settled ? undefined : suggestionFor("feasibility-session-incomplete"),
		});
	}

	return { title, items };
}
