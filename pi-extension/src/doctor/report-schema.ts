/**
 * Versioned JSON report schema (Doctor upgrade Phase 0 — contract C1/C2).
 *
 * The chat render (`report.ts`) is for humans; this module is the
 * machine-readable twin other commands (preflight / CI) can consume.
 * Stable check ids come from `sectionId()` — an explicit section `id`
 * when present, otherwise a kebab-case slug of the stable section title.
 * The schema is versioned so consumers can branch on `schemaVersion`.
 *
 * Layer rule: L1 `doctor/` — imports L0 only (`io/atomic-write.ts`,
 * `core/constants.ts`, `_types.ts`). No IO beyond the atomic write,
 * no UI, no absolute paths in the payload.
 */

import { join } from "node:path";
import { PATHS } from "../core/constants.js";
import { atomicWriteJson } from "../io/atomic-write.js";
import type { DiagnosticItem, DiagnosticReport, DiagnosticSection } from "./_types.js";

/** Current JSON schema version. Bump on any breaking shape change. */
export const JSON_REPORT_SCHEMA_VERSION = 1;

/**
 * Path of the JSON report, derived from the markdown report path so the
 * two artifacts always live side by side (`.IDE_Plans/velpari/`).
 */
export const JSON_REPORT_PATH = PATHS.DOCTOR_REPORT.replace(/\.md$/, ".json");

/**
 * Slug arbitrary text into a stable kebab-case id: lowercase, every run
 * of non-alphanumerics becomes a single "-", leading/trailing "-" trimmed.
 */
export function slugId(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Stable machine id for a section. Uses the optional explicit `id` when
 * a check sets one; otherwise slugs the section title (stable because
 * check titles are stable and tests key on them).
 */
export function sectionId(section: DiagnosticSection): string {
	return section.id ?? slugId(section.title);
}

/** One item in the JSON report — mirrors `DiagnosticItem` with plain strings. */
export interface JsonReportItem {
	status: string;
	message: string;
	details?: string[];
	suggestion?: string;
}

/** One section in the JSON report, keyed by its stable `id`. */
export interface JsonReportSection {
	id: string;
	title: string;
	items: JsonReportItem[];
}

/** Versioned machine-readable doctor report. */
export interface JsonReport {
	schemaVersion: number;
	/** ISO-8601 timestamp of generation. */
	generatedAt: string;
	verdict: "ok" | "error";
	summary: { ok: number; warning: number; error: number; info: number };
	sections: JsonReportSection[];
}

/**
 * Convert a `DiagnosticReport` to the versioned JSON shape. Pure — the
 * only non-deterministic value is `generatedAt`.
 */
export function toJsonReport(report: DiagnosticReport): JsonReport {
	return {
		schemaVersion: JSON_REPORT_SCHEMA_VERSION,
		generatedAt: new Date().toISOString(),
		verdict: report.ok ? "ok" : "error",
		summary: { ...report.summary },
		sections: report.sections.map((section) => ({
			id: sectionId(section),
			title: section.title,
			items: section.items.map(toJsonItem),
		})),
	};
}

/** Copy one diagnostic item into its JSON twin (no mutation of the source). */
function toJsonItem(item: DiagnosticItem): JsonReportItem {
	const out: JsonReportItem = { status: item.status, message: item.message };
	if (item.details) out.details = [...item.details];
	if (item.suggestion) out.suggestion = item.suggestion;
	return out;
}

/**
 * Write the versioned JSON report atomically to
 * `.IDE_Plans/velpari/doctor-report.json` under `cwd`. Returns the exact
 * object written so callers can reuse it without re-serializing.
 */
export function writeDoctorJson(report: DiagnosticReport, cwd: string = process.cwd()): JsonReport {
	const json = toJsonReport(report);
	atomicWriteJson(join(cwd, JSON_REPORT_PATH), json);
	return json;
}
