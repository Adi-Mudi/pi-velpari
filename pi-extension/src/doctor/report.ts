/**
 * Doctor report formatter + writer (Phase 1 refactor; Doctor upgrade
 * Phase 0 adds the render-options contract).
 *
 * The formatter produces:
 *   - a title line
 *   - a summary line (counts per status)
 *   - a verdict banner (✅ or ❌)
 *   - one section per check with `✅`/`⚠️`/`❌`/`ℹ️` icons
 *
 * `renderReport(report, opts?)` is the single entry point:
 *   - default: the full report, byte-identical to the legacy output.
 *   - `quiet`: header + summary + Action items only.
 *   - `grouped`: sections bucketed into coarse groups with per-group counts.
 *   - `severityFirst`: error-bearing sections first, then warnings, then the rest.
 *   - `maxChars`: truncate with a "…truncated, see report file" tail.
 *
 * `formatDiagnosticReport(report)` stays a thin wrapper over
 * `renderReport(report)` for back-compat with every existing caller.
 *
 * The report is written with `atomicWriteFile` (io/atomic-write.ts).
 * The `--quiet` render builds an "Action items" callout at render time
 * so errors survive TUI truncation; it is never stored in `sections`.
 */

import { join } from "node:path";
import { PATHS } from "../core/constants.js";
import { atomicWriteFile } from "../io/atomic-write.js";
import { iconFor, type DiagnosticReport, type DiagnosticSection, type DiagnosticStatus } from "./_types.js";
import { buildActionItemsSection } from "./action-items.js";
import { sectionId } from "./report-schema.js";

/** Coarse buckets used by `opts.grouped`; additions fall to "Other". */
const GROUP_ORDER = ["Setup", "Artifacts", "Freshness", "Store/DB", "Agents/Config", "Environment", "Other"] as const;
type GroupName = (typeof GROUP_ORDER)[number];

/**
 * Section-id → group rules, checked in order. Any section id that matches
 * no rule lands in "Other" (so new checks are never dropped from the view).
 */
const GROUP_RULES: ReadonlyArray<readonly [RegExp, GroupName]> = [
	[
		/store-db|store-digest|db-integrity|db-link|hash-chain|baselines|last-verified-backup|soft-locks|semver-bump|portfolio|git-integration/,
		"Store/DB",
	],
	[/^agent|agent-|scout|sub-agent|generated|stage-skills|skill/, "Agents/Config"],
	[/freshness|stale|id-coverage|verifier-verdict|working-published/, "Freshness"],
	[/environment|multiplexer|herdr|conformance|web-tool|secret-scan|stray-files|official-extension/, "Environment"],
	[
		/setup-progress|run-state|run-lock|run-worktree|worktree|^config$|^config-|requirements-profile|standards-profile|available-scans|sequence-hardening|architecture-sub-life-cycle/,
		"Setup",
	],
	[
		/psrs|rtm|artifact|frontmatter|data-sidecar|doc-artifacts|grouped-legacy|design-readiness|feasibility|shape-compatibility|architecture-decision|trace-link|fingerprint/,
		"Artifacts",
	],
];

/** Severity rank for `opts.severityFirst` — lower sorts first. */
const SEVERITY_RANK: Record<DiagnosticStatus, number> = { error: 0, warning: 1, info: 2, ok: 3 };

/** Tail appended when `opts.maxChars` truncates the output. */
export const TRUNCATION_TAIL = "\n…truncated, see report file\n";

/** Chat-render options (Doctor upgrade Phase 0 — contract C3). */
export interface RenderOptions {
	/** Header + summary + Action items only. */
	quiet?: boolean;
	/** Group sections into coarse buckets with per-group counts. */
	grouped?: boolean;
	/** Error-bearing sections first, then warnings, then the rest. */
	severityFirst?: boolean;
	/** Hard cap; truncation appends `TRUNCATION_TAIL`. */
	maxChars?: number;
}

/**
 * Render a `DiagnosticReport` with the given options. Pure; no IO.
 * Default options reproduce the legacy `formatDiagnosticReport` output
 * byte for byte.
 */
export function renderReport(report: DiagnosticReport, opts: RenderOptions = {}): string {
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

	if (opts.quiet) {
		renderSection(lines, buildActionItemsSection(report.sections));
		return applyMaxChars(lines.join("\n"), opts.maxChars);
	}

	const sections = opts.severityFirst ? sortBySeverity(report.sections) : report.sections;
	if (opts.grouped) {
		renderGrouped(lines, sections);
	} else {
		for (const section of sections) renderSection(lines, section);
	}
	return applyMaxChars(lines.join("\n"), opts.maxChars);
}

/**
 * Format a DiagnosticReport as Markdown. Kept as a thin wrapper over
 * `renderReport` so every legacy caller keeps the exact old output.
 */
export function formatDiagnosticReport(report: DiagnosticReport): string {
	return renderReport(report);
}

/** Render one section (and its items) at the given markdown heading level. */
function renderSection(lines: string[], section: DiagnosticSection, level = 2): void {
	lines.push(`${"#".repeat(level)} ${section.title}`);
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

/** Stable severity ordering: error sections first, then warning/info/ok. */
function sortBySeverity(sections: DiagnosticSection[]): DiagnosticSection[] {
	return [...sections].sort((a, b) => sectionRank(a) - sectionRank(b));
}

/** Rank a section by its most severe item (empty sections sort last). */
function sectionRank(section: DiagnosticSection): number {
	let rank = 4;
	for (const item of section.items) {
		const itemRank = SEVERITY_RANK[item.status];
		if (itemRank < rank) rank = itemRank;
	}
	return rank;
}

/** Map a section id to its coarse group; unmatched ids fall to "Other". */
function groupForSection(id: string): GroupName {
	for (const [pattern, group] of GROUP_RULES) {
		if (pattern.test(id)) return group;
	}
	return "Other";
}

/** Render the grouped view: sections bucketed in fixed group order. */
function renderGrouped(lines: string[], sections: DiagnosticSection[]): void {
	const buckets = new Map<GroupName, DiagnosticSection[]>();
	for (const section of sections) {
		const group = groupForSection(sectionId(section));
		const list = buckets.get(group) ?? [];
		list.push(section);
		buckets.set(group, list);
	}

	for (const group of GROUP_ORDER) {
		const list = buckets.get(group);
		if (!list || list.length === 0) continue;
		const counts = countStatuses(list);
		lines.push(`## ${group} — ${list.length} section(s) · ${counts.error} error(s) · ${counts.warning} warning(s)`);
		lines.push("");
		for (const section of list) renderSection(lines, section, 3);
	}
}

/** Tally item statuses across a set of sections. */
function countStatuses(sections: DiagnosticSection[]): Record<DiagnosticStatus, number> {
	const counts: Record<DiagnosticStatus, number> = { ok: 0, warning: 0, error: 0, info: 0 };
	for (const section of sections) {
		for (const item of section.items) counts[item.status]++;
	}
	return counts;
}

/** Apply the optional character cap, appending the truncation tail. */
function applyMaxChars(text: string, maxChars?: number): string {
	if (maxChars === undefined || maxChars <= 0 || text.length <= maxChars) return text;
	const keep = Math.max(0, maxChars - TRUNCATION_TAIL.length);
	return text.slice(0, keep) + TRUNCATION_TAIL;
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
