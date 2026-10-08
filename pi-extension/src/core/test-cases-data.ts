/**
 * Test-cases data sidecar (B3 — YAML sidecars).
 *
 * The test-cases artifact's source of truth is a YAML document
 * (`test-cases_<project>.yaml`) living next to the markdown in both the
 * working copy and the published grouped layout. The parent LLM authors
 * the sidecar during the testplan stage; the publish branch
 * (`ops/approve.ts` via the sidecar registry) validates it and
 * RE-RENDERS the published markdown from it.
 *
 * Schema: two record lists — `unitTests` (TC-N) and `integrationTests`
 * (IT-N). Every record carries a mandatory `traces` list of
 * `FR-N` / `NFR-N` / `AF-N` ids (Layer-2 ID coverage). Net-new sidecar
 * — `.yaml` only.
 *
 * Layer 0 — domain primitive. Imports L0 only.
 */

import { existsSync } from "node:fs";
import { compareVersions, readYamlFile } from "./yaml-data.js";
import { resolveDocArtifact } from "./paths.js";
import { readLatestPublishedRows } from "../io/store.js";

interface TestCaseRecord {
	/** Test case id — "TC-<n>" (unit) or "IT-<n>" (integration). */
	id: string;
	name: string;
	/** Function/flow under test (e.g. "M-1.createUser"). */
	target: string;
	/** Procedure steps (prose or numbered list as one string). */
	steps: string;
	/** Expected outcome. */
	expected: string;
	/** Unit tests only: edge cases covered. */
	edgeCases?: string;
	/** Integration tests only: modules crossed (e.g. ["M-1", "M-2"]). */
	modules?: string[];
	/** Mandatory trace ids: FR-N / NFR-N / AF-N. */
	traces: string[];
}

export interface TestCasesData {
	project: string;
	/** Semver-ish version; bump rules match the living-documents rules. */
	version: string;
	unitTests: TestCaseRecord[];
	integrationTests: TestCaseRecord[];
	/** Revision entries, newest last. Rendered as the Change Log section. */
	changeLog?: string[];
}

interface TestCasesValidation {
	ok: boolean;
	issues: string[];
}

const TC_ID_PATTERN = /^TC-\d+$/;
const IT_ID_PATTERN = /^IT-\d+$/;
const TRACE_ID_PATTERN = /^(?:FR|NFR|AF)-\d+$/;

// ---------------------------------------------------------------------------
// Sidecar resolution
// ---------------------------------------------------------------------------

/** Sidecar path next to a test-cases markdown path (`.yaml` only). */
function testCasesSidecarPath(mdPath: string): string {
	return mdPath.replace(/\.md$/, ".yaml");
}

/** Resolve the existing sidecar for a test-cases markdown path, or null. */
export function resolveTestCasesSidecar(mdPath: string): string | null {
	const path = testCasesSidecarPath(mdPath);
	return existsSync(path) ? path : null;
}

/**
 * Engine-side loader: DB-first with sidecar fallback (Phase 6 §14.3).
 * Returns the legacy `TestCasesData` shape (unitTests +
 * integrationTests) so downstream engines (id-coverage, etc.) keep
 * working unchanged. The DB test_case shape carries a subset of
 * fields; missing legacy decorations get safe defaults.
 * @param {string} cwd - Project root.
 * @param {string} projectName - Project whose test-cases to load.
 * @returns {TestCasesData | null} The legacy TestCasesData shape, or null when neither DB nor sidecar has published rows.
 */
export function loadTestCasesDataForEngine(cwd: string, projectName: string): TestCasesData | null {
	const fromDb = readLatestPublishedRows(cwd, projectName, "testplan");
	if (fromDb) {
		const cases = (fromDb.rows.testCase as Array<Record<string, unknown>> | undefined) ?? [];
		const traces = (fromDb.rows.tcTrace as Array<Record<string, unknown>> | undefined) ?? [];
		const traceMap = new Map<string, string[]>();
		for (const t of traces) {
			const tcId = String(t.tcId);
			const targetId = String(t.targetId);
			const list = traceMap.get(tcId) ?? [];
			list.push(targetId);
			traceMap.set(tcId, list);
		}
		/**
		 * Map one DB test_case row to the legacy TestCasesData per-record shape.
		 * Joins `tc_trace` rows into the per-record `traces` list.
		 * @param {Record<string, unknown>} r - The raw DB row.
		 * @returns The legacy per-test-case record shape.
		 */
		const toRecord = (r: Record<string, unknown>) => ({
			id: String(r.id),
			name: String(r.id),
			target: "",
			modules: [] as string[],
			steps: r.steps !== undefined && r.steps !== null ? String(r.steps) : "",
			expected: r.expected !== undefined && r.expected !== null ? String(r.expected) : "",
			edgeCases: "",
			traces: traceMap.get(String(r.id)) ?? [],
		});
		return {
			project: projectName,
			version: String(fromDb.envelope.version),
			unitTests: cases.filter((r) => r.tcKind === "TC").map(toRecord),
			integrationTests: cases.filter((r) => r.tcKind === "IT").map(toRecord),
		};
	}
	const md = resolveDocArtifact("test-cases", projectName, cwd);
	if (!md) return null;
	const sidecar = resolveTestCasesSidecar(md.path);
	if (!sidecar) return null;
	const data = readYamlFile(sidecar);
	if (!data) return null;
	return data as TestCasesData;
}

/**
 * Loose trace extraction (D7): every trace id from the sidecar when one
 * exists and parses with the expected lists, null otherwise (caller
 * falls back to markdown scraping). Never throws.
 */
export function extractTestCaseTracesFromSidecar(mdPath: string): string[] | null {
	const resolved = resolveTestCasesSidecar(mdPath);
	if (!resolved) return null;
	const data = readYamlFile(resolved);
	if (typeof data !== "object" || data === null) return null;
	const traces: string[] = [];
	for (const key of ["unitTests", "integrationTests"] as const) {
		const list = (data as Record<string, unknown>)[key];
		if (!Array.isArray(list)) continue;
		for (const record of list) {
			if (typeof record !== "object" || record === null) continue;
			const t = (record as Record<string, unknown>).traces;
			if (Array.isArray(t)) {
				for (const id of t) {
					if (typeof id === "string" && TRACE_ID_PATTERN.test(id)) traces.push(id);
				}
			}
		}
	}
	return traces.length > 0 ? traces : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate one test-case record shape, id pattern, uniqueness, and
 * required fields. Pushes actionable issues into `issues`. Never
 * throws — malformed input produces line-labeled errors for the user.
 * @param {unknown} record - The raw record to validate.
 * @param {string} at - Human-readable location (e.g. "unitTests[0]") for problem messages.
 * @param {RegExp} idPattern - Regex the id must match.
 * @param {"unit" | "integration"} kind - Which test-case list this belongs to (drives vocabulary).
 * @param {Set<string>} seen - Mutable set of ids seen so far (duplicate detection).
 * @param {string[]} issues - Accumulator for validation problems.
 * @returns {void}
 */
function validateRecord(
	record: unknown,
	at: string,
	idPattern: RegExp,
	kind: "unit" | "integration",
	seen: Set<string>,
	issues: string[],
): void {
	if (typeof record !== "object" || record === null) {
		issues.push(`${at}: not an object.`);
		return;
	}
	const r = record as Record<string, unknown>;
	if (typeof r.id !== "string" || !idPattern.test(r.id)) {
		issues.push(`${at}.id: must match ${kind === "unit" ? "TC" : "IT"}-<n>, got "${String(r.id)}".`);
	} else if (seen.has(r.id)) {
		issues.push(`${at}.id: duplicate id "${r.id}".`);
	} else {
		seen.add(r.id);
	}
	for (const field of ["name", "target", "steps", "expected"] as const) {
		if (typeof r[field] !== "string" || (r[field] as string).trim() === "") {
			issues.push(`${at}.${field}: missing or empty.`);
		}
	}
	if (kind === "unit" && r.edgeCases !== undefined && typeof r.edgeCases !== "string") {
		issues.push(`${at}.edgeCases: must be a string when present.`);
	}
	if (
		kind === "integration" &&
		r.modules !== undefined &&
		(!Array.isArray(r.modules) || r.modules.some((m) => typeof m !== "string"))
	) {
		issues.push(`${at}.modules: must be an array of strings when present.`);
	}
	if (!Array.isArray(r.traces) || r.traces.length === 0) {
		issues.push(`${at}.traces: mandatory — list the FR-N / NFR-N / AF-N ids this test verifies (use [] never).`);
	} else if (r.traces.some((t) => typeof t !== "string" || !TRACE_ID_PATTERN.test(t))) {
		issues.push(`${at}.traces: every entry must match FR-<n> / NFR-<n> / AF-<n>.`);
	}
}

/** Validate the sidecar shape. Pure — no I/O. */
export function validateTestCasesData(value: unknown): TestCasesValidation {
	const issues: string[] = [];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, issues: ["test-cases sidecar must be an object."] };
	}
	const data = value as Record<string, unknown>;
	if (typeof data.project !== "string" || data.project.trim() === "") {
		issues.push("project: missing or not a string.");
	}
	if (typeof data.version !== "string" || data.version.trim() === "") {
		issues.push("version: missing or not a string.");
	}
	if (!Array.isArray(data.unitTests)) {
		issues.push("unitTests: missing or not an array (use [] when none).");
	}
	if (!Array.isArray(data.integrationTests)) {
		issues.push("integrationTests: missing or not an array (use [] when none).");
	}
	if (issues.length > 0) return { ok: false, issues };

	const seen = new Set<string>();
	(data.unitTests as unknown[]).forEach((r, i) => {
		validateRecord(r, `unitTests[${i}]`, TC_ID_PATTERN, "unit", seen, issues);
	});
	(data.integrationTests as unknown[]).forEach((r, i) => {
		validateRecord(r, `integrationTests[${i}]`, IT_ID_PATTERN, "integration", seen, issues);
	});
	if (
		data.changeLog !== undefined &&
		(!Array.isArray(data.changeLog) || data.changeLog.some((e) => typeof e !== "string"))
	) {
		issues.push("changeLog: must be an array of strings when present.");
	}
	return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Revision rules (living documents)
// ---------------------------------------------------------------------------

/**
 * Living-documents revision rules applied to test-cases data:
 *  1. Append-only IDs — every baseline TC/IT id must still be present.
 *  2. Version must strictly increase.
 */
export function diffTestCasesData(baseline: TestCasesData, updated: TestCasesData): TestCasesValidation {
	const issues: string[] = [];
	const updatedIds = new Set([...updated.unitTests.map((r) => r.id), ...updated.integrationTests.map((r) => r.id)]);
	for (const id of [...baseline.unitTests.map((r) => r.id), ...baseline.integrationTests.map((r) => r.id)]) {
		if (!updatedIds.has(id)) {
			issues.push(
				`append-only violation: baseline test "${id}" is missing from the revision. ` +
					`Keep it (mark it obsolete in its name/steps if it no longer applies) instead of deleting.`,
			);
		}
	}
	if (compareVersions(updated.version, baseline.version) <= 0) {
		issues.push(`version must strictly increase (baseline ${baseline.version} → revision ${updated.version}).`);
	}
	return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render a single table-cell value as markdown text.
 * Empty / whitespace-only input becomes `(none)`; everything else is
 * passed through verbatim.
 * @param {string | undefined} v - The raw cell value.
 * @returns {string} The markdown-safe string for the cell.
 */
function cell(v: string | undefined): string {
	return v && v.trim() !== "" ? v : "(none)";
}

/**
 * Render the published markdown from the data — the exact two-table
 * shape of skills/velpari-testplan.md (Unit Tests / Integration Tests)
 * so markdown-scraping consumers (id-coverage Traces column) keep
 * working. Includes a minimal frontmatter; approve stamps the rest.
 */
export function renderTestCasesMarkdown(data: TestCasesData): string {
	const lines: string[] = [
		"---",
		`artifact: test-cases`,
		`project: ${data.project}`,
		`version: ${data.version}`,
		"---",
		"",
		`# Test Cases — ${data.project}`,
		"",
		"## Unit Tests",
		"",
		"| TC ID | Name | Target | Steps | Expected | Edge Cases | Traces |",
		"|---|---|---|---|---|---|---|",
		...data.unitTests.map(
			(r) =>
				`| ${r.id} | ${r.name} | ${r.target} | ${r.steps} | ${r.expected} | ${cell(r.edgeCases)} | ${r.traces.join(", ")} |`,
		),
		"",
		"## Integration Tests",
		"",
		"| TC ID | Name | Target | Modules | Steps | Expected | Traces |",
		"|---|---|---|---|---|---|---|",
		...data.integrationTests.map(
			(r) =>
				`| ${r.id} | ${r.name} | ${r.target} | ${(r.modules ?? []).join(", ") || "(none)"} | ${r.steps} | ${r.expected} | ${r.traces.join(", ")} |`,
		),
		"",
	];

	if (data.changeLog && data.changeLog.length > 0) {
		lines.push("## Change Log", "", ...data.changeLog.map((e) => `- ${e}`), "");
	}
	return lines.join("\n");
}
