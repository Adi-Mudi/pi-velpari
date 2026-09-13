/**
 * Feasibility study v2 validation (feasibility v2, Phase 4).
 *
 * The v2 template follows the community-standard feasibility report
 * shape (executive summary, options analysis, build-vs-reuse comparison,
 * recommendation) plus the XP spike documentation consensus (language
 * selection with spike evidence). Section presence is enforced at the
 * publish gate, same strictness as the PSRS validator: a missing section
 * is an error.
 *
 * Headings tolerate an optional numeric prefix ("## 3. Overall Verdict"
 * and "## Overall Verdict" both match) — readSectionBody already
 * implements that convention.
 */

import { readSectionBody } from "./psrs.js";

/** Required sections, in template order. */
export const FEASIBILITY_REQUIRED_SECTIONS = [
	"Executive Summary",
	"Options Analysis",
	"Build-vs-Reuse Comparison",
	"Language Selection",
	"Technical Feasibility",
	"Schedule Feasibility",
	"Cost Feasibility",
	"Risk Feasibility",
	"Overall Verdict",
	"Conditions",
	"Top 5 Risks",
	"Open Questions",
	"Change Log",
] as const;

export interface FeasibilityDocIssue {
	code: "feasibility-section-missing" | "feasibility-section-empty" | "feasibility-verdict-missing";
	message: string;
}

export interface FeasibilityDocResult {
	ok: boolean;
	issues: FeasibilityDocIssue[];
}

const VERDICT_WORDS = /\b(Go|Conditional Go|No-Go)\b/;

/**
 * Validate a feasibility-study working copy against the v2 template.
 * Every required section must exist and be non-empty; the Overall Verdict
 * section must carry a real verdict word (Go / Conditional Go / No-Go).
 */
export function validateFeasibilityDoc(markdown: string): FeasibilityDocResult {
	const issues: FeasibilityDocIssue[] = [];
	for (const section of FEASIBILITY_REQUIRED_SECTIONS) {
		const body = readSectionBody(markdown, section);
		// Distinguish missing from empty: readSectionBody returns "" for both.
		const headingRe = new RegExp(`^##\\s+(?:\\d+\\.\\s+)?${escapeRe(section)}\\s*$`, "m");
		if (!headingRe.test(markdown)) {
			issues.push({
				code: "feasibility-section-missing",
				message: `Required section "${section}" is missing.`,
			});
			continue;
		}
		if (!body) {
			issues.push({
				code: "feasibility-section-empty",
				message: `Required section "${section}" is empty.`,
			});
			continue;
		}
		if (section === "Overall Verdict" && !VERDICT_WORDS.test(body)) {
			issues.push({
				code: "feasibility-verdict-missing",
				message: `Overall Verdict must state Go, Conditional Go, or No-Go.`,
			});
		}
	}
	return { ok: issues.length === 0, issues };
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
