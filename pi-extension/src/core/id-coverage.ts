/**
 * Layer-2 ID coverage (A4) — spec 03 §Layer-2.
 *
 * Hashes (Layer 1, core/freshness.ts) detect THAT a document changed;
 * ID coverage detects WHAT is missing: every ID of an upstream artifact
 * must appear in its downstream artifacts. Append-only IDs make the check
 * exact — a missing id is an inconsistency, no ambiguity.
 *
 * The 4 rules (COVERAGE_RULES):
 *   - prd→design        FR/NFR ids vs design §1 "Source FRs" + §5 NFR columns
 *                       (D4 — §7 Traceability prose is never scanned)
 *   - af→pseudocode     AF ids vs AF-N references anywhere in the doc
 *   - fr-af→test-cases  FR + AF ids vs the test-cases doc (Traces column)
 *   - af→dev-order      AF ids vs the development-order doc (AFs: lists)
 *
 * Legacy tolerance (D1): a downstream doc with ZERO parseable references
 * of the expected kind is a pre-A4-format doc → "not-checkable" (warning
 * everywhere, never blocks). A doc with SOME references is enforced fully:
 * missing upstream ids = error. Dev-order duplicates (D2): an AF appearing
 * more than once is a warning (duplicateIds), a missing AF is an error.
 *
 * PRD→RTM coverage is deliberately NOT here — it exists twice already
 * (fingerprints orphan/unknown-id + mvp-coverage no-row); unification is
 * a future cleanup.
 *
 * Consumed by the publish gate (doctor/gate.ts), the doctor ID-coverage
 * section (doctor/checks/id-coverage.ts), and the handoff gate
 * (ops/handoff.ts). L0 — imports L0 only.
 */

import { readFileSync } from "node:fs";
import { loadFilesConfig } from "./config.js";
import { extractAfIdsFromSidecar } from "./af-data.js";
import { extractTestCaseTracesFromSidecar } from "./test-cases-data.js";
import { extractDevOrderAfRefsFromSidecar } from "./dev-order-data.js";
import { resolveDocArtifact, resolveDocArtifactAll } from "./paths.js";
import { extractIdsFromTable, readSectionBody } from "./psrs.js";

// ---------------------------------------------------------------------------
// Types + rule table
// ---------------------------------------------------------------------------

type CoverageStatus = "ok" | "not-checkable" | "missing";

interface UpstreamSource {
	/** paths.ts artifact key ("PRD", "atomic-functions"). */
	artifact: string;
	/** ID prefixes to collect from the upstream artifact. */
	prefixes: string[];
}

interface CoverageRule {
	id: string;
	upstreams: UpstreamSource[];
	/** paths.ts artifact key of the downstream artifact. */
	downstream: string;
	/** Prefixes that count as a parseable downstream reference (D1). */
	downstreamPrefixes: string[];
	/** Human text for messages: where the references are expected. */
	downstreamRefHint: string;
	/** Dev-order (D2): ids appearing more than once → duplicateIds warning. */
	trackDuplicates: boolean;
}

export const COVERAGE_RULES: CoverageRule[] = [
	{
		id: "prd-to-design",
		upstreams: [{ artifact: "PRD", prefixes: ["FR", "NFR"] }],
		downstream: "design",
		downstreamPrefixes: ["FR", "NFR"],
		downstreamRefHint: "design §1 'Source FRs' column + §5 'NFR ID'/'Source PRD row' columns",
		trackDuplicates: false,
	},
	{
		id: "af-to-pseudocode",
		upstreams: [{ artifact: "atomic-functions", prefixes: ["AF"] }],
		downstream: "pseudocode",
		downstreamPrefixes: ["AF"],
		downstreamRefHint: "an 'AF: AF-N' reference per function block",
		trackDuplicates: false,
	},
	{
		id: "fr-af-to-test-cases",
		upstreams: [
			{ artifact: "PRD", prefixes: ["FR"] },
			{ artifact: "atomic-functions", prefixes: ["AF"] },
		],
		downstream: "test-cases",
		downstreamPrefixes: ["FR", "NFR", "AF"],
		downstreamRefHint: "the test-cases table 'Traces' column (FR-N / NFR-N / AF-N)",
		trackDuplicates: false,
	},
	{
		id: "af-to-dev-order",
		upstreams: [{ artifact: "atomic-functions", prefixes: ["AF"] }],
		downstream: "development-order",
		downstreamPrefixes: ["AF"],
		downstreamRefHint: "an 'AFs: AF-N, …' list per step",
		trackDuplicates: true,
	},
];

interface IdCoverageRuleResult {
	rule: CoverageRule;
	projectName: string;
	status: CoverageStatus;
	missingIds: string[];
	duplicateIds: string[];
}

interface IdCoverageReport {
	results: IdCoverageRuleResult[];
}

// ---------------------------------------------------------------------------
// ID extraction
// ---------------------------------------------------------------------------

/**
 * Return every `<prefix>-<number>` token in the text, in order, duplicates
 * kept (dev-order duplicate detection needs the counts).
 */
export function extractIds(text: string, prefixes: string[]): string[] {
	if (prefixes.length === 0 || text.length === 0) return [];
	const re = new RegExp(`\\b(?:${prefixes.join("|")})-\\d+\\b`, "g");
	return text.match(re) ?? [];
}

function splitCells(line: string): string[] {
	return line
		.split("|")
		.map((c) => c.trim())
		.filter((c) => c.length > 0);
}

function isSeparatorRow(cells: string[]): boolean {
	return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * Extract ids from the named columns of the FIRST markdown table in a
 * section body. Column match is case-insensitive on the header row.
 */
function extractColumnIds(
	body: string,
	columnNames: string[],
	prefixes: string[],
): string[] {
	const tableLines = body
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("|"));
	if (tableLines.length === 0) return [];
	const header = splitCells(tableLines[0]!);
	const idxs = columnNames
		.map((name) => header.findIndex((c) => c.toLowerCase() === name.toLowerCase()))
		.filter((i) => i >= 0);
	if (idxs.length === 0) return [];
	const out: string[] = [];
	for (const line of tableLines.slice(1)) {
		const cells = splitCells(line);
		if (isSeparatorRow(cells)) continue;
		for (const i of idxs) {
			out.push(...extractIds(cells[i] ?? "", prefixes));
		}
	}
	return out;
}

/**
 * Ids an upstream artifact contributes to a rule. PRD: the FR/NFR table
 * ids of the two requirement sections (filtered by the rule's prefixes).
 * Atomic-functions: the AF-N ids from its tables (first-column scan).
 */
function extractUpstreamIds(source: UpstreamSource, markdown: string): string[] {
	const ids = new Set<string>();
	// extractIdsFromTable is prefix-based (first cell startsWith) — the AF
	// table header ("AF ID") would match too, so keep exact `<prefix>-<n>`
	// cells only.
	const exact = new RegExp(`^(?:${source.prefixes.join("|")})-\\d+$`);
	if (source.artifact === "PRD") {
		for (const section of ["Functional Requirements", "Non-Functional Requirements"]) {
			for (const row of extractIdsFromTable(readSectionBody(markdown, section), source.prefixes)) {
				if (exact.test(row.id)) ids.add(row.id);
			}
		}
	} else {
		for (const row of extractIdsFromTable(markdown, source.prefixes)) {
			if (exact.test(row.id)) ids.add(row.id);
		}
	}
	return Array.from(ids).sort();
}

/**
 * References a downstream artifact carries for a rule. Design (D4): only
 * §1 'Source FRs' cells + §5 'NFR ID'/'Source PRD row' cells — §7
 * Traceability prose is never scanned. Everything else: whole-doc scan
 * with the rule's downstream prefixes.
 */
function extractDownstreamRefs(rule: CoverageRule, markdown: string): string[] {
	if (rule.downstream === "design") {
		const moduleBody = readSectionBody(markdown, "Module Breakdown");
		const qaBody = readSectionBody(markdown, "Quality Attribute Scenarios");
		return [
			...extractColumnIds(moduleBody, ["Source FRs"], rule.downstreamPrefixes),
			...extractColumnIds(qaBody, ["NFR ID", "Source PRD row"], rule.downstreamPrefixes),
		];
	}
	return extractIds(markdown, rule.downstreamPrefixes);
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

function uniqueSorted(ids: string[]): string[] {
	return Array.from(new Set(ids)).sort();
}

/**
 * Evaluate one rule against supplied markdown (no disk access). The
 * publish gate calls this with the working copy as downstream; the
 * doctor/handoff path calls it via checkIdCoverage with published docs.
 */
function evaluateRule(
	rule: CoverageRule,
	upstreamMarkdown: ReadonlyMap<string, string>,
	downstreamMarkdown: string,
	projectName: string,
	upstreamIdOverrides?: ReadonlyMap<string, readonly string[]>,
	downstreamRefsOverride?: readonly string[],
): IdCoverageRuleResult {
	const upstreamIds: string[] = [];
	for (const source of rule.upstreams) {
		// D7 — sidecar-first: when the upstream artifact carries a
		// machine-readable sidecar, its ids win over markdown scraping.
		const override = upstreamIdOverrides?.get(source.artifact);
		if (override) {
			upstreamIds.push(...override);
			continue;
		}
		const markdown = upstreamMarkdown.get(source.artifact);
		if (markdown !== undefined) upstreamIds.push(...extractUpstreamIds(source, markdown));
	}
	const refs = downstreamRefsOverride
		? [...downstreamRefsOverride]
		: extractDownstreamRefs(rule, downstreamMarkdown);
	// D1 — zero parseable references → pre-A4-format doc, not machine-checkable.
	if (refs.length === 0) {
		return { rule, projectName, status: "not-checkable", missingIds: [], duplicateIds: [] };
	}
	const refSet = new Set(refs);
	const missingIds = uniqueSorted(upstreamIds.filter((id) => !refSet.has(id)));
	const duplicateIds: string[] = [];
	if (rule.trackDuplicates) {
		const counts = new Map<string, number>();
		for (const ref of refs) counts.set(ref, (counts.get(ref) ?? 0) + 1);
		for (const [id, n] of counts) {
			if (n > 1 && new Set(upstreamIds).has(id)) duplicateIds.push(id);
		}
		duplicateIds.sort();
	}
	return {
		rule,
		projectName,
		status: missingIds.length > 0 ? "missing" : "ok",
		missingIds,
		duplicateIds,
	};
}

/**
 * Evaluate every rule whose downstream is `artifact` against the supplied
 * downstream markdown, reading the upstream artifacts from disk (grouped +
 * legacy fallback). A rule whose upstream artifact is absent is skipped
 * (no result). Used by the publish gate with the working copy.
 */
export function checkDownstreamCoverage(
	cwd: string,
	artifact: string,
	downstreamMarkdown: string,
	projectName: string,
	downstreamRefsOverride?: readonly string[],
): IdCoverageRuleResult[] {
	const out: IdCoverageRuleResult[] = [];
	for (const rule of COVERAGE_RULES) {
		if (rule.downstream !== artifact) continue;
		const upstreamMarkdown = new Map<string, string>();
		const upstreamIdOverrides = new Map<string, readonly string[]>();
		let skipped = false;
		for (const source of rule.upstreams) {
			const found = resolveDocArtifact(source.artifact, projectName, cwd);
			if (!found) {
				skipped = true;
				break;
			}
			upstreamMarkdown.set(source.artifact, readFileSync(found.path, "utf8"));
			// D7 — sidecar-first (af→pseudocode, af→dev-order): AF ids come
			// from the YAML sidecar when one exists; markdown scraping is
			// the fallback (legacy not-checkable behavior unchanged).
			if (source.artifact === "atomic-functions") {
				const sidecarIds = extractAfIdsFromSidecar(found.path);
				if (sidecarIds) upstreamIdOverrides.set(source.artifact, sidecarIds);
			}
		}
		if (skipped) continue;
		out.push(evaluateRule(rule, upstreamMarkdown, downstreamMarkdown, projectName, upstreamIdOverrides, downstreamRefsOverride));
	}
	return out;
}

/**
 * Run every rule over the published artifacts on disk. Multi-design: each
 * downstream artifact found by resolveDocArtifactAll is paired with the
 * upstream artifacts of the same projectName. Legacy flat docs
 * (Doc/<artifact>_<project>.md) are discovered through the configured
 * projectNames (resolveDocArtifact flat fallback). Rules with a missing
 * upstream or downstream artifact are skipped (no result).
 */
export function checkIdCoverage(cwd: string): IdCoverageReport {
	const results: IdCoverageRuleResult[] = [];
	const config = loadFilesConfig(cwd);
	const configuredNames = config.projectNames ?? (config.projectName ? [config.projectName] : []);
	for (const rule of COVERAGE_RULES) {
		const downstreams = new Map<string, { path: string; projectName: string }>();
		for (const found of resolveDocArtifactAll(cwd, rule.downstream)) {
			downstreams.set(found.path, found);
		}
		for (const projectName of configuredNames) {
			const found = resolveDocArtifact(rule.downstream, projectName, cwd);
			if (found && !downstreams.has(found.path)) downstreams.set(found.path, { path: found.path, projectName });
		}
		for (const downstream of downstreams.values()) {
			// D7 — sidecar-first downstream refs: when the downstream
			// artifact carries a machine-readable sidecar, its ids win
			// over markdown scraping (test-cases traces / dev-order afs).
			let downstreamRefsOverride: readonly string[] | undefined;
			if (rule.downstream === "test-cases") {
				downstreamRefsOverride = extractTestCaseTracesFromSidecar(downstream.path) ?? undefined;
			} else if (rule.downstream === "development-order") {
				downstreamRefsOverride = extractDevOrderAfRefsFromSidecar(downstream.path) ?? undefined;
			}
			results.push(
				...checkDownstreamCoverage(
					cwd,
					rule.downstream,
					readFileSync(downstream.path, "utf8"),
					downstream.projectName,
					downstreamRefsOverride,
				).filter((r) => r.rule.id === rule.id),
			);
		}
	}
	return { results };
}
