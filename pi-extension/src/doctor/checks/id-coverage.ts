/**
 * Layer-2 ID coverage check (A4) — doctor section.
 *
 * Renders `core/id-coverage.ts:checkIdCoverage` — the same rule engine the
 * publish gate (`doctor/gate.ts:runPublishGate`) and the handoff gate
 * (`ops/handoff.ts`) consume:
 *
 *  - missing → error (D1): an upstream id has no reference in a
 *    machine-checkable downstream doc;
 *  - not-checkable → warning (D1): the downstream doc carries zero
 *    parseable references (pre-A4 format) — regenerate the stage to gain
 *    ID traceability; never blocks;
 *  - duplicates → warning (D2, dev-order): an AF listed in more than one
 *    step.
 */

import { checkIdCoverage } from "../../core/id-coverage.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkIdCoverageSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const report = checkIdCoverage(cwd);

	let problems = 0;
	for (const result of report.results) {
		const where = `${result.rule.id} (${result.rule.downstream}, ${result.projectName})`;
		if (result.status === "missing") {
			problems++;
			items.push({
				status: "error",
				message:
					`${where}: missing ${result.missingIds.join(", ")} — revise the ` +
					`${result.rule.downstream} stage to cover them (${result.rule.downstreamRefHint}).`,
				suggestion: suggestionFor("id-coverage-missing"),
			});
		} else if (result.status === "not-checkable") {
			items.push({
				status: "warning",
				message:
					`${where}: not machine-checkable — no parseable references ` +
					`(${result.rule.downstreamRefHint}); regenerate the stage to gain ID traceability.`,
				suggestion: suggestionFor("id-coverage-not-checkable"),
			});
		}
		if (result.duplicateIds.length > 0) {
			items.push({
				status: "warning",
				message:
					`${where}: duplicate ids ${result.duplicateIds.join(", ")} — ` +
					`each upstream id should appear exactly once.`,
				suggestion: suggestionFor("id-coverage-missing"),
			});
		}
	}

	items.push(
		problems === 0
			? {
					status: "ok",
					message:
						report.results.length === 0
							? "No checkable artifact pairs yet."
							: `0 uncovered / ${report.results.length} rule evaluation(s).`,
				}
			: {
					status: "info",
					message: `${problems} uncovered / ${report.results.length} rule evaluation(s).`,
				},
	);

	return { title: "ID coverage", items };
}
