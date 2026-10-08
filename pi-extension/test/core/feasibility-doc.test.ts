/**
 * Feasibility document v2 validation tests (feasibility v2, Phase 4).
 *
 * Covers core/feasibility-doc.ts:
 *   - full v2 template passes (numbered headings)
 *   - missing section = error
 *   - empty section = error
 *   - Overall Verdict without a verdict word = error
 *   - unnumbered headings also match
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { FEASIBILITY_REQUIRED_SECTIONS, validateFeasibilityDoc } from "../../src/core/feasibility-doc.js";

function study(overrides: Record<string, string> = {}, skip: string[] = []): string {
	const bodies: Record<string, string> = {
		"Executive Summary": "Analyzed the build-vs-reuse options; verdict Go.",
		"Options Analysis": "| repo | match% | license |\n|---|---|---|\n| acme/x | 12% | MIT |",
		"Build-vs-Reuse Comparison": "No candidate above 30% — build from scratch.",
		"Language Selection": "TypeScript, chosen by user after spikes (go, python failed).",
		"Technical Feasibility": "Stack validated against the RTM.\n- Rating: Go",
		"Schedule Feasibility": "4 weeks fits.\n- Rating: Go",
		"Cost Feasibility": "Serverless tier is enough.\n- Rating: Go",
		"Risk Feasibility": "Main risk: API drift.\n- Rating: Conditional Go",
		"Overall Verdict": "All dimensions pass.\nFinal: Go",
		Conditions: "1. Pin the API version.",
		"Top 5 Risks": "1. API drift — pin version.",
		"Open Questions": "1. Offline sync scope?",
		"Change Log": "- 2026-09-13 velpari initial draft",
		...overrides,
	};
	const parts = ["# Feasibility Study — TestApp\n"];
	let i = 0;
	for (const section of FEASIBILITY_REQUIRED_SECTIONS) {
		if (skip.includes(section)) continue;
		i++;
		parts.push(`## ${i}. ${section}\n${bodies[section]}\n`);
	}
	return parts.join("\n");
}

describe("validateFeasibilityDoc", () => {
	it("accepts the full v2 template (numbered headings)", () => {
		const result = validateFeasibilityDoc(study());
		assert.deepEqual(result.issues, []);
		assert.equal(result.ok, true);
	});

	it("accepts unnumbered headings", () => {
		const doc = study().replace(/## \d+\. /g, "## ");
		assert.equal(validateFeasibilityDoc(doc).ok, true);
	});

	it("flags a missing section", () => {
		const result = validateFeasibilityDoc(study({}, ["Options Analysis"]));
		assert.equal(result.ok, false);
		assert.ok(
			result.issues.some((i) => i.code === "feasibility-section-missing" && i.message.includes("Options Analysis")),
		);
	});

	it("flags an empty section", () => {
		const result = validateFeasibilityDoc(study({ "Top 5 Risks": "" }, []));
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.code === "feasibility-section-empty" && i.message.includes("Top 5 Risks")));
	});

	it("flags an Overall Verdict without a verdict word", () => {
		const result = validateFeasibilityDoc(study({ "Overall Verdict": "Looks fine overall." }));
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.code === "feasibility-verdict-missing"));
	});

	it("accepts Conditional Go and No-Go verdicts", () => {
		assert.equal(validateFeasibilityDoc(study({ "Overall Verdict": "Final: Conditional Go" })).ok, true);
		assert.equal(validateFeasibilityDoc(study({ "Overall Verdict": "Final: No-Go" })).ok, true);
	});
});
