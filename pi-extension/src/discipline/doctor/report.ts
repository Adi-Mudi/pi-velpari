/**
 * Doctor report formatter + writer (Phase 1 refactor).
 *
 * Phase 1 changes the input shape from a flat string to a structured
 * `DiagnosticReport`. The formatter produces:
 *   - a title line
 *   - a summary line (counts per status)
 *   - a verdict banner (✅ or ❌)
 *   - one section per check with `✅`/`⚠️`/`❌`/`ℹ️` icons
 *
 * Phase 2 will switch `writeFileSync` to `atomicWriteFile`. Phase 5 will
 * prepend an "Action items" callout so errors survive TUI truncation.
 */

import { dirname, join } from "node:path";
import { PATHS } from "../../core/constants.js";
import { atomicWriteFile } from "../../io/atomic-write.js";
import { iconFor, type DiagnosticReport } from "./_types.js";

/**
 * Format a DiagnosticReport as Markdown. Pure function; no IO.
 */
export function formatDiagnosticReport(report: DiagnosticReport): string {
	const lines: string[] = [];
	lines.push("# Velpari Doctor Report");
	lines.push("");
	lines.push(
		`Summary: ${report.summary.ok} OK, ${report.summary.warning} warnings, ${report.summary.error} errors, ${report.summary.info} info.`,
	);
	lines.push("");
	lines.push(
		report.ok
			? "✅ Configuration looks good."
			: "❌ Please fix the errors above. Each error item carries a `→ Fix:` hint.",
	);
	lines.push("");

	for (const section of report.sections) {
		lines.push(`## ${section.title}`);
		lines.push("");
		for (const item of section.items) {
			lines.push(`${iconFor(item.status)} ${item.message}`);
			if (item.details) {
				for (const detail of item.details) {
					lines.push(`   - ${detail}`);
				}
			}
			if (item.suggestion) {
				lines.push(`   → Fix: ${item.suggestion}`);
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Write the doctor report to disk. Atomic — a crash mid-write leaves no
 * half-written file. Caller passes the DiagnosticReport produced by runDoctor.
 */
export function writeDoctorReport(report: DiagnosticReport, cwd: string = process.cwd()): void {
	const text = formatDiagnosticReport(report);
	const reportPath = join(cwd, PATHS.DOCTOR_REPORT);
	atomicWriteFile(reportPath, text, "utf8");
}
