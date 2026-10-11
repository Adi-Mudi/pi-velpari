/**
 * Compose-report regression (Doctor optimization P0 — the "lazy callout").
 *
 * The Action-items callout is a derived, presentation-only view: it is NOT
 * stored in `report.sections`, so `composeReport` counts each real check
 * exactly once and the default/grouped/chat renders never print it. Only
 * the `--quiet` render builds it on demand.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { DiagnosticSection, DiagnosticStatus } from "../../src/doctor/_types.js";
import { composeReport } from "../../src/doctor/index.js";
import { renderReport } from "../../src/doctor/report.js";
import { toJsonReport } from "../../src/doctor/report-schema.js";

const WARNING_SECTION: DiagnosticSection = {
	title: "Custom thing",
	items: [{ status: "warning", message: "Hmm", suggestion: "Fix the hmm" }],
};

/** Tally item statuses across sections the same way the summary does. */
function tally(sections: DiagnosticSection[]): Record<DiagnosticStatus, number> {
	const counts: Record<DiagnosticStatus, number> = { ok: 0, warning: 0, error: 0, info: 0 };
	for (const section of sections) {
		for (const item of section.items) counts[item.status]++;
	}
	return counts;
}

describe("composeReport — the callout is not a stored section", () => {
	it("counts each real check exactly once", () => {
		const report = composeReport([WARNING_SECTION]);
		assert.equal(report.summary.warning, 1);
		assert.deepEqual(tally(report.sections), report.summary);
		assert.equal(report.sections.length, 1, "only the real sections are stored");
	});

	it("keeps the JSON summary identical to the rendered Summary line", () => {
		const report = composeReport([WARNING_SECTION]);
		const json = toJsonReport(report);
		const summaryLine = renderReport(report)
			.split("\n")
			.find((line) => line.startsWith("Summary: "));
		assert.equal(
			summaryLine,
			`Summary: ${json.summary.ok} OK, ${json.summary.warning} warnings, ${json.summary.error} errors, ${json.summary.info} info.`,
		);
	});

	it("does not print the callout by default, only under --quiet", () => {
		const report = composeReport([WARNING_SECTION]);
		assert.ok(!renderReport(report).includes("## Action items"));
		assert.ok(renderReport(report, { quiet: true }).includes("## Action items"));
	});
});
