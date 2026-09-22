/**
 * RTM data sidecar (RTM traceability upgrade, Phase 2).
 *
 * The RTM's source of truth is a JSON document (`RTM_<project>.json`)
 * living next to the markdown (`RTM_<project>.md`) in both the working
 * copy and the published grouped layout. The parent LLM authors the JSON
 * during the rtm stage; the publish gate (called via the publish tool
 * or `/velpari-rtm-approve` fall-back, both of which invoke
 * `handleApprove`) validates it and REGENERATES
 * the published markdown from it — so the table a human reads is always
 * derived from the data, never hand-edited prose.
 *
 * Row vocabularies mirror skills/velpari-rtm.md:
 *  - phase:    positive integer delivery phase (1 = MVP); must match the PRD
 *  - status:   proposed | approved | implemented | verified | deferred | deprecated
 *  - coverage: covered | partial | missing
 *
 * B3 (D4): the written sidecar format is YAML (`RTM_<project>.yaml`).
 * Reads are dual-format — `.yaml` preferred, legacy `.json` fallback —
 * via `resolveRtmSidecar`; writes are always `.yaml`. The YAML parser
 * accepts JSON content (YAML 1.2 superset), so one loader serves both.
 */

import { existsSync } from "node:fs";
import { readYamlFile } from "./yaml-data.js";
import { resolveDocArtifact } from "./paths.js";
import { readLatestPublishedRows } from "../io/store.js";

const RTM_ROW_STATUSES = [
	"proposed",
	"approved",
	"implemented",
	"verified",
	"deferred",
	"deprecated",
] as const;
type RtmRowStatus = (typeof RTM_ROW_STATUSES)[number];

const RTM_COVERAGES = ["covered", "partial", "missing"] as const;
type RtmCoverage = (typeof RTM_COVERAGES)[number];

export interface RtmRow {
	/** Requirement id, e.g. "FR-1" or "NFR-1". */
	id: string;
	/** Requirement title. */
	title: string;
	/** Delivery phase (positive integer; 1 = MVP). Must match the PRD. */
	phase: number;
	/** Design element (e.g. "module.fn"). Empty string when none. */
	design: string;
	/** Implementation / helper function (e.g. "HF-01"). Empty when none. */
	implementation: string;
	/** Linked test case ids. Empty array when none. */
	tests: string[];
	status: RtmRowStatus;
	coverage: RtmCoverage;
	/** Required when status is "deprecated" — why it was removed. */
	reason?: string;
	/**
	 * SHA-256 of the requirement's PSRS row substance (Phase 3). Stamped
	 * by the publish gate (called by `handleApprove` via the publish tool
	 * or `/velpari-rtm-approve` fall-back) at publish time — never
	 * written by the LLM.
	 */
	fingerprint?: string;
}

export interface RtmData {
	project: string;
	/** Semver-ish version; bump rules match the living-documents rules. */
	version: string;
	rows: RtmRow[];
	/** Revision entries, newest last. Rendered as the Change Log section. */
	changeLog?: string[];
}

interface RtmValidation {
	ok: boolean;
	issues: string[];
}

const REQ_ID_PATTERN = /^(?:FR|NFR)-\d+$/;

// ---------------------------------------------------------------------------
// Sidecar resolution (B3/D4 — dual-read)
// ---------------------------------------------------------------------------

type RtmSidecarFormat = "yaml" | "json";

interface RtmSidecarRef {
	/** Absolute path of the sidecar file. */
	path: string;
	format: RtmSidecarFormat;
}

/**
 * Sidecar candidates next to an RTM markdown path, in preference order:
 * `.yaml` first, legacy `.json` second (D4).
 */
function rtmSidecarCandidates(mdPath: string): RtmSidecarRef[] {
	const base = mdPath.replace(/\.md$/, "");
	return [
		{ path: `${base}.yaml`, format: "yaml" },
		{ path: `${base}.json`, format: "json" },
	];
}

/** Resolve the existing sidecar for an RTM markdown path, or null. */
export function resolveRtmSidecar(mdPath: string): RtmSidecarRef | null {
	for (const candidate of rtmSidecarCandidates(mdPath)) {
		if (existsSync(candidate.path)) return candidate;
	}
	return null;
}

/**
 * Loose load: parsed sidecar data when a sidecar exists and parses
 * (YAML or legacy JSON — the YAML parser accepts both), null otherwise.
 * Validation/diagnostics paths read the file + `parseYaml` themselves so
 * malformed input produces line-numbered errors for the user.
 */
export function loadRtmSidecarData(
	mdPath: string,
): (RtmSidecarRef & { data: unknown }) | null {
	const resolved = resolveRtmSidecar(mdPath);
	if (!resolved) return null;
	const data = readYamlFile(resolved.path);
	return data === null ? null : { ...resolved, data };
}

/**
 * Engine-side loader: DB-first with sidecar fallback (Phase 6 §14.3).
 * Returns the legacy `RtmData` shape so downstream engines (MVP
 * coverage, ID coverage, etc.) keep working unchanged. The DB rtm_row
 * shape carries a subset of fields; missing legacy fields (title,
 * design, implementation, coverage, fingerprint) are populated with
 * safe defaults — DB-primary reads don't depend on these legacy
 * decorations yet (Subphase 2.4 + 2.4 follow-ups fill them in).
 * @param {string} cwd - Project root.
 * @param {string} projectName - Project whose RTM to load.
 * @returns {RtmData | null} The legacy RtmData shape, or null when neither DB nor sidecar has published rows.
 */
export function loadRtmDataForEngine(cwd: string, projectName: string): RtmData | null {
	const fromDb = readLatestPublishedRows(cwd, projectName, "rtm");
	if (fromDb) {
		const rtmRows = (fromDb.rows.rtmRow as Array<Record<string, unknown>> | undefined) ?? [];
		return {
			project: projectName,
			version: String(fromDb.envelope.version),
			rows: rtmRows.map((r) => ({
				id: String(r.id),
				title: "",
				phase: Number(r.phase),
				design: "",
				implementation: "",
				tests: r.tcRef ? [String(r.tcRef)] : [],
				status: "proposed",
				coverage: r.afRef ? "covered" : "missing",
				fingerprint: undefined,
			})),
		};
	}
	const rtmMd = resolveDocArtifact("RTM", projectName, cwd);
	if (!rtmMd) return null;
	const sidecar = loadRtmSidecarData(rtmMd.path);
	if (!sidecar) return null;
	return sidecar.data as RtmData;
}

/** Validate the JSON shape and vocabularies. Pure — no I/O. */
export function validateRtmData(value: unknown): RtmValidation {
	const issues: string[] = [];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, issues: ["RTM JSON must be an object."] };
	}
	const data = value as Record<string, unknown>;
	if (typeof data.project !== "string" || data.project.trim() === "") {
		issues.push("project: missing or not a string.");
	}
	if (typeof data.version !== "string" || data.version.trim() === "") {
		issues.push("version: missing or not a string.");
	}
	if (!Array.isArray(data.rows)) {
		issues.push("rows: missing or not an array.");
		return { ok: false, issues };
	}

	const seen = new Set<string>();
	for (let i = 0; i < data.rows.length; i++) {
		const row = data.rows[i] as Record<string, unknown>;
		const at = `rows[${i}]`;
		if (typeof row !== "object" || row === null) {
			issues.push(`${at}: not an object.`);
			continue;
		}
		if (typeof row.id !== "string" || !REQ_ID_PATTERN.test(row.id)) {
			issues.push(`${at}.id: must match FR-<n> or NFR-<n>, got "${String(row.id)}".`);
		} else if (seen.has(row.id)) {
			issues.push(`${at}.id: duplicate id "${row.id}".`);
		} else {
			seen.add(row.id);
		}
		if (typeof row.title !== "string" || row.title.trim() === "") {
			issues.push(`${at}.title: missing or empty.`);
		}
		if (typeof row.phase !== "number" || !Number.isInteger(row.phase) || row.phase < 1) {
			issues.push(`${at}.phase: must be a positive integer (1 = MVP), got ${JSON.stringify(row.phase)}.`);
		}
		for (const key of ["design", "implementation"] as const) {
			if (typeof row[key] !== "string") {
				issues.push(`${at}.${key}: must be a string (use "" when none).`);
			}
		}
		if (!Array.isArray(row.tests) || row.tests.some((t) => typeof t !== "string")) {
			issues.push(`${at}.tests: must be an array of strings (use [] when none).`);
		}
		if (!RTM_ROW_STATUSES.includes(row.status as RtmRowStatus)) {
			issues.push(`${at}.status: must be one of ${RTM_ROW_STATUSES.join(" | ")}, got "${String(row.status)}".`);
		}
		if (!RTM_COVERAGES.includes(row.coverage as RtmCoverage)) {
			issues.push(`${at}.coverage: must be one of ${RTM_COVERAGES.join(" | ")}, got "${String(row.coverage)}".`);
		}
		if (row.status === "deprecated" && (typeof row.reason !== "string" || row.reason.trim() === "")) {
			issues.push(`${at}.reason: deprecated rows must record a reason.`);
		}
		if (row.fingerprint !== undefined && typeof row.fingerprint !== "string") {
			issues.push(`${at}.fingerprint: must be a string when present.`);
		}
	}
	if (data.changeLog !== undefined && (!Array.isArray(data.changeLog) || data.changeLog.some((e) => typeof e !== "string"))) {
		issues.push("changeLog: must be an array of strings when present.");
	}
	return { ok: issues.length === 0, issues };
}

/** Compare two semver-ish versions. >0 when a > b, 0 equal, <0 when a < b. */
export function compareRtmVersions(a: string, b: string): number {
	const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/**
 * Living-documents revision rules applied to RTM data:
 *  1. Append-only IDs — every baseline row must still be present.
 *  2. Deprecate, don't delete — a removed requirement keeps its row with
 *     status `deprecated` (validateRtmData enforces the reason).
 *  3. Version must strictly increase.
 *  4. New rows (absent from the baseline) must start as `proposed`.
 */
export function diffRtmData(baseline: RtmData, updated: RtmData): RtmValidation {
	const issues: string[] = [];
	const updatedIds = new Map(updated.rows.map((r) => [r.id, r]));
	for (const row of baseline.rows) {
		if (!updatedIds.has(row.id)) {
			issues.push(
				`append-only violation: baseline row "${row.id}" is missing from the revision. ` +
					`Keep it with status "deprecated" and a reason instead of deleting.`,
			);
		}
	}
	for (const row of updated.rows) {
		if (!baseline.rows.some((b) => b.id === row.id) && row.status !== "proposed") {
			issues.push(`new row "${row.id}" must start with status "proposed", got "${row.status}".`);
		}
	}
	if (compareRtmVersions(updated.version, baseline.version) <= 0) {
		issues.push(
			`version must strictly increase (baseline ${baseline.version} → revision ${updated.version}). ` +
				`Additions bump minor; deprecations bump major.`,
		);
	}
	return { ok: issues.length === 0, issues };
}

/**
 * Render the published markdown from the data. Includes a minimal
 * frontmatter (artifact/project/version) — approve's frontmatter stamping
 * fills the remaining canonical fields at publish time.
 */
export function renderRtmMarkdown(data: RtmData): string {
	const covered = data.rows.filter((r) => r.coverage === "covered").length;
	const partial = data.rows.filter((r) => r.coverage === "partial").length;
	const missing = data.rows.filter((r) => r.coverage === "missing").length;
	const gaps = data.rows.filter((r) => r.coverage !== "covered");

	const lines: string[] = [
		"---",
		`artifact: RTM`,
		`project: ${data.project}`,
		`version: ${data.version}`,
		"---",
		"",
		`# Requirements Traceability Matrix — ${data.project}`,
		"",
		"## Summary",
		`- Total requirements: ${data.rows.length}`,
		`- Covered: ${covered} | Partial: ${partial} | Missing: ${missing}`,
		"",
		"## Coverage Gaps",
		"",
		...(gaps.length === 0
			? ["(none — every requirement is covered)"]
			: gaps.map((r) => `- ${r.id} — ${r.title} (${r.coverage})`)),
		"",
		"## Traceability",
		"",
		"| Req ID | Requirement | Phase | Design Element | Implementation / Helper Function | Test Case(s) | Status |",
		"|---|---|---|---|---|---|---|",
		...data.rows.map((r) => {
			const tests = r.tests.length > 0 ? r.tests.join(", ") : "(none)";
			const impl = r.implementation || "(none)";
			const design = r.design || "(none)";
			const status = r.status === "deprecated" && r.reason
				? `deprecated (${r.reason})`
				: `${r.status} / ${r.coverage}`;
			return `| ${r.id} | ${r.title} | ${r.phase} | ${design} | ${impl} | ${tests} | ${status} |`;
		}),
		"",
	];

	if (data.changeLog && data.changeLog.length > 0) {
		lines.push("## Change Log", "", ...data.changeLog.map((e) => `- ${e}`), "");
	}
	return lines.join("\n");
}
