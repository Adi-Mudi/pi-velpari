/**
 * MVP coverage section (MVP/phase traceability upgrade, Phase 4).
 *
 * Thin adapter over core/mvp-coverage.ts: reports "MVP coverage: X/Y
 * covered" plus one item per issue. Errors = Phase-1 requirement with no
 * RTM row or coverage "missing"; warnings = partial coverage or no test
 * links.
 */

import { checkMvpCoverage } from "../../core/mvp-coverage.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkMvpCoverageSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const title = "MVP coverage";

	const report = checkMvpCoverage(cwd, projectName);
	if (!report) {
		items.push({
			status: "info",
			message: projectName
				? "MVP coverage check skipped — needs the published PSRS (with Phase column) and the RTM JSON sidecar."
				: "MVP coverage check skipped — project name missing.",
			suggestion: projectName ? suggestionFor("rtm-json-missing") : suggestionFor("project-name-missing"),
		});
		return { title, items };
	}

	items.push({
		status: report.issues.some((i) => i.severity === "error")
			? "error"
			: report.issues.length > 0
				? "warning"
				: "ok",
		message: `MVP coverage: ${report.covered}/${report.total} Phase-1 requirement(s) fully covered.`,
	});
	for (const issue of report.issues) {
		items.push({
			status: issue.severity,
			message: issue.message,
			suggestion: suggestionFor("mvp-incomplete"),
		});
	}
	return { title, items };
}
