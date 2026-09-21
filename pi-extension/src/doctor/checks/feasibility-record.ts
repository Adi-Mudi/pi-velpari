/**
 * Feasibility decision record check (B3 — D9).
 *
 * The code-generated record (`Doc/feasibility/feasibility-decision_
 * <project>.yaml`) preserves the feasibility v2 session (verdict,
 * selected language, spike evidence) past `clearFeasibilitySession`.
 * Missing record on a published study = warning only (D6: legacy
 * published artifacts never block); a record that lacks the decision
 * fields = error.
 */

import { loadFeasibilityRecord } from "../../core/feasibility-record.js";
import { resolveDocArtifact } from "../../core/paths.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkFeasibilityRecordSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "Feasibility record check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "Feasibility decision record", items };
	}

	const study = resolveDocArtifact("feasibility-study", projectName, cwd);
	if (!study) {
		items.push({
			status: "info",
			message: "Feasibility study not found — skipping decision record check.",
			suggestion: suggestionFor("artifact-missing"),
		});
		return { title: "Feasibility decision record", items };
	}

	const record = loadFeasibilityRecord(cwd, projectName);
	if (!record) {
		items.push({
			status: "warning",
			message: "Feasibility decision record missing — the study is not backed by a machine-readable decision record.",
			details: [`Expected: Doc/feasibility/feasibility-decision_${projectName}.yaml`],
			suggestion: suggestionFor("feasibility-record-missing"),
		});
		return { title: "Feasibility decision record", items };
	}

	const problems: string[] = [];
	if (record.verdict !== "reuse" && record.verdict !== "partial" && record.verdict !== "build") {
		problems.push(`verdict: must be reuse | partial | build, got "${String(record.verdict)}".`);
	}
	if (typeof record.selectedLanguage !== "string" || record.selectedLanguage.trim() === "") {
		problems.push("selectedLanguage: missing or empty.");
	}
	if (problems.length > 0) {
		items.push({
			status: "error",
			message: `Feasibility decision record failed validation (${problems.length} issue(s)).`,
			details: problems,
			suggestion: suggestionFor("feasibility-record-invalid"),
		});
		return { title: "Feasibility decision record", items };
	}

	items.push({
		status: "ok",
		message: `Feasibility decision recorded — verdict: ${record.verdict}, language: ${record.selectedLanguage} (by ${record.selectedBy}).`,
	});
	return { title: "Feasibility decision record", items };
}
