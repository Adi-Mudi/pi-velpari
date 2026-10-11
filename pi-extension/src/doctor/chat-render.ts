/**
 * Chat render (Doctor upgrade Phase 1 — lane a1, subphase 1.1).
 *
 * `renderReport()` produces the on-disk markdown report. This module is
 * the chat-friendly twin the `/velpari-doctor` handler sends to the
 * parent LLM: a short header + verdict, a "Recommended next steps"
 * callout (REC-2 — reuses the P0 `suggestion` field), and the full
 * report with the setup-progress section hoisted to the top (the
 * first-time-user UX is the entire point — the recommended next step
 * should survive TUI truncation).
 *
 * Pure. Layer rule: L1 `doctor/` — imports sibling L0-ish modules
 * (`_types.ts`, `report.ts`, `report-schema.ts`) only.
 */

import { type DiagnosticItem, type DiagnosticReport, type DiagnosticSection } from "./_types.js";
import { TRUNCATION_TAIL, renderReport } from "./report.js";
import { sectionId } from "./report-schema.js";

/** Chat-render options (Doctor upgrade Phase 1 — contract C3 twin). */
export interface ChatRenderOptions {
	/** Group sections into coarse buckets with per-group counts. */
	grouped?: boolean;
	/** Error-bearing sections first, then warnings, then the rest. */
	severityFirst?: boolean;
	/** Hard cap on the whole chat render; truncation appends `TRUNCATION_TAIL`. */
	maxChars?: number;
}

/** Maximum number of "Recommended next steps" entries. */
const MAX_NEXT_STEPS = 8;

/**
 * Build the chat render for a doctor report.
 *
 * Output order:
 *   1. header line `Doctor: X OK / Y warnings / Z errors` + verdict;
 *   2. "Recommended next steps" — every error (then warning) item that
 *      carries a `suggestion`, top 8;
 *   3. the setup-progress section hoisted first;
 *   4. all remaining sections rendered via `renderReport`.
 *
 * Pure; no IO.
 */
export function buildChatReport(report: DiagnosticReport, opts: ChatRenderOptions = {}): string {
	const lines: string[] = [];

	// (1) Header + verdict.
	lines.push(`Doctor: ${report.summary.ok} OK / ${report.summary.warning} warnings / ${report.summary.error} errors`);
	lines.push(report.ok ? "✅ Configuration looks good." : "❌ Issues found — see the recommended fixes below.");
	lines.push("");

	// (2) Recommended next steps.
	lines.push("### Recommended next steps");
	lines.push("");
	const steps = collectNextSteps(report.sections).slice(0, MAX_NEXT_STEPS);
	if (steps.length === 0) {
		lines.push("- ✅ Nothing to fix — configuration looks good.");
	} else {
		for (const item of steps) lines.push(`- ${item.message} → ${item.suggestion}`);
	}
	lines.push("");

	// (3)+(4) Hoist setup-progress, then let renderReport do the section work.
	const body = renderReport(
		{ ...report, sections: orderSections(report.sections) },
		{ grouped: opts.grouped, severityFirst: opts.severityFirst },
	);
	lines.push(body);

	return applyMaxChars(lines.join("\n"), opts.maxChars);
}

/**
 * Collect every error item with a suggestion, then every warning item
 * with a suggestion, in report order. Types narrow the optional
 * `suggestion` away, so callers can render the arrow unconditionally.
 */
function collectNextSteps(sections: DiagnosticSection[]): Array<DiagnosticItem & { suggestion: string }> {
	const out: Array<DiagnosticItem & { suggestion: string }> = [];
	for (const status of ["error", "warning"] as const) {
		for (const section of sections) {
			for (const item of section.items) {
				if (item.status !== status || !item.suggestion) continue;
				out.push({ ...item, suggestion: item.suggestion });
			}
		}
	}
	return out;
}

/**
 * Move the setup-progress section to the front (stable otherwise).
 * A report without setup-progress is returned unchanged.
 */
function orderSections(sections: DiagnosticSection[]): DiagnosticSection[] {
	const setup = sections.find((section) => sectionId(section) === "setup-progress");
	if (!setup || sections[0] === setup) return sections;
	return [setup, ...sections.filter((section) => section !== setup)];
}

/** Apply the optional character cap to the whole chat render. */
function applyMaxChars(text: string, maxChars?: number): string {
	if (maxChars === undefined || maxChars <= 0 || text.length <= maxChars) return text;
	const keep = Math.max(0, maxChars - TRUNCATION_TAIL.length);
	return text.slice(0, keep) + TRUNCATION_TAIL;
}
