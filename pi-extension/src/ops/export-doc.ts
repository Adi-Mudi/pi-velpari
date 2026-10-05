// ============================================================================
// ops/export-doc.ts — on-demand document export from the DB store (Layer 1)
// ============================================================================
// Decision record: .IDE_Plans/velpari-storage-traceability_decision-record_*_v1.0.md
//   D4    — DB-primary storage; documents are downloaded from the DB on
//           demand (Phase 5, /velpari-export). Export is an ADDITIONAL view
//           — never a publish product.
//   Q3    — markdown stays read-authoritative until Phase 6; nothing here
//           writes to the DB or flips any read.
//   G5    — deterministic bytes: renderers sort rows by natural key
//           explicitly (never insertion order), fixed section order, no
//           timestamps beyond the envelope's own fields. Two runs on the
//           same DB bytes produce identical bytes.
//   RES-1 — yaml format delegates to exportArtifactYaml, so it is
//           byte-identical to the publish-time sidecar bytes.
//
// Formats (user decision 1): md (in-house renderer per kind), yaml (the
// store's deterministic export bytes), html (in-house converter over the
// renderer's own bounded markdown subset — zero new dependencies).
//
// Scope guard: L1 rendering + file write only. No picker UX (L3 owns
// ctx.ui), no DB writes, no state mutations, no publish/approve logic.
// ============================================================================

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openStoreDb, closeStoreDb } from "../io/db.js";
import { readArtifact, exportArtifactYaml, type ArtifactEnvelope, type ArtifactKind } from "../io/store.js";
import { atomicWriteFile } from "../io/atomic-write.js";
import { buildGroupedPath } from "../core/paths.js";
import {
	LANE_LOCK_RULES,
	LANE_MERGE_GATES,
	laneViewFromRows,
	type LaneDepInput,
	type LaneProposal,
	type LaneStatus,
	type LaneStepInput,
} from "../core/dev-lanes.js";

/** The three export formats (user decision 1). */
export type ExportFormat = "md" | "yaml" | "html";

/** runExport result — `ok:false` carries a human-readable `problem`. */
export interface ExportResult {
	ok: boolean;
	/** Absolute path of the written file (present when ok). */
	path?: string;
	/** Failure reason (present when !ok). Never thrown — callers notify. */
	problem?: string;
	/** Row counts per payload key (present when ok). */
	counts?: Record<string, number>;
	/** Post-write notes (v1.2 D3 wireframe sidecar). */
	warnings?: string[];
}

/** runExport input. `overwrite` must be caller-confirmed (user decision 2). */
export interface ExportInput {
	/** Store DB path (buildStoreDbPath output). */
	dbPath: string;
	/** Run identifier picked from the published-versions list. */
	runId: string;
	/** Artifact kind picked from the exportable-kinds list. */
	kind: ArtifactKind;
	/** Envelope version shown in the picker — verified before render. */
	version: number;
	/** Output format. */
	format: ExportFormat;
	/** Destination file path (user-picked or default suggestion). */
	outputPath: string;
	/** Overwrite an existing file — the CALLER confirms with the user. */
	overwrite?: boolean;
	/** Project root — resolves the paired wireframe sidecar path (v1.2 D3). */
	cwd?: string;
}

/** File-name label per kind (matches buildStoreYamlPath sidecar labels).
 * Exported for ops/export-revision.ts (Phase 4) — read-only consumers. */
export const KIND_LABELS: Record<ArtifactKind, string> = {
	prd: "PRD",
	rtm: "RTM",
	feasibility: "feasibility-study",
	design: "design",
	"atomic-functions": "atomic-functions",
	pseudocode: "pseudocode",
	testplan: "test-plan",
	"development-order": "development-order",
	"final-design": "final-design",
};

/** Human title per kind for the envelope header's H1. */
const KIND_TITLES: Record<ArtifactKind, string> = {
	prd: "PRD",
	rtm: "RTM",
	feasibility: "Feasibility Study",
	design: "Design",
	"atomic-functions": "Atomic Functions",
	pseudocode: "Pseudocode",
	testplan: "Test Plan",
	"development-order": "Development Order",
	"final-design": "Final Design",
};

/**
 * Default destination suggestion (user decision 2):
 * `Doc/export/<project>/<Artifact>_<project>.<ext>`.
 * @param {string} projectName - Project name (sanitized into the path).
 * @param {ArtifactKind} kind - Selected artifact kind.
 * @param {ExportFormat} format - Selected output format.
 * @param {string} cwd - Working directory root.
 * @returns {string} Absolute default path suggestion.
 */
export function buildExportDefaultPath(
	projectName: string,
	kind: ArtifactKind,
	format: ExportFormat,
	cwd: string,
): string {
	const safeProject = projectName.replace(/[^A-Za-z0-9_-]+/g, "-");
	return join(cwd, "Doc", "export", safeProject, `${KIND_LABELS[kind]}_${safeProject}.${format}`);
}

// ---------------------------------------------------------------------------
// Envelope header (shared by md + html)
// ---------------------------------------------------------------------------

/**
 * YAML frontmatter + title + fingerprint/reviewer-verdict/change-log
 * sections — the wrapper every rendered kind shares. Mirrors the published
 * artifacts' frontmatter style (artifact, runId, stage, version,
 * generatedAt).
 * @param {ArtifactEnvelope} envelope - The stored envelope (published).
 * @returns {string} Markdown header block (frontmatter + H1 + meta).
 */
export function renderEnvelopeHeader(envelope: ArtifactEnvelope): string {
	const lines: string[] = [
		"---",
		`artifact: ${envelope.kind}`,
		`runId: ${envelope.runId}`,
		`stage: ${envelope.stage}`,
		`version: ${envelope.version}`,
		`generatedAt: ${envelope.generatedAt}`,
		"---",
		"",
		`# ${KIND_TITLES[envelope.kind]} (version ${envelope.version})`,
		"",
		`- **Run:** ${envelope.runId}`,
		`- **Stage:** ${envelope.stage}`,
		`- **Generated:** ${envelope.generatedAt}`,
		`- **Fingerprint:** \`${envelope.sha256Fingerprint}\``,
		"",
		"## Reviewer Verdict",
		"",
		envelope.reviewerVerdict ?? "_none recorded_",
		"",
		"## Change Log",
		"",
	];
	let entries: unknown;
	try {
		entries = JSON.parse(envelope.changeLog);
	} catch {
		entries = null;
	}
	if (Array.isArray(entries) && entries.length > 0) {
		for (const entry of entries) {
			lines.push(`- ${typeof entry === "string" ? entry : JSON.stringify(entry)}`);
		}
	} else {
		lines.push("_no changes recorded_");
	}
	return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Row-set rendering helpers (G5 — explicit natural-key sorts, pipe tables)
// ---------------------------------------------------------------------------

/** Pipe-table cell: escape pipes and newlines so tables never break. */
function cell(value: unknown): string {
	if (value === undefined || value === null) return "";
	return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Render a deterministic markdown pipe table (or "_(none)_" when empty). */
function table(title: string, headers: string[], rows: unknown[][]): string {
	const lines: string[] = [`## ${title}`, ""];
	if (rows.length === 0) {
		lines.push("_(none)_", "");
		return lines.join("\n");
	}
	lines.push(`| ${headers.join(" | ")} |`);
	lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
	for (const row of rows) {
		lines.push(`| ${row.map(cell).join(" | ")} |`);
	}
	lines.push("");
	return lines.join("\n");
}

/** Sort rows by a natural key defensively — never rely on insertion order. */
function sorted<T>(rows: T[] | undefined, key: (row: T) => string | number): T[] {
	return [...(rows ?? [])].sort((a, b) => {
		const ka = key(a);
		const kb = key(b);
		if (ka < kb) return -1;
		if (ka > kb) return 1;
		return 0;
	});
}

/** Row shape as readRows returns it — string-keyed unknown values. */
type RowLikeAlias = Record<string, unknown>;

/**
 * Read a row field as a string (null/undefined become empty).
 * @param {RowLikeAlias} row - The payload row.
 * @param {string} field - Field name to read.
 * @returns {string} The field's string value, or "" when absent.
 */
function str(row: RowLikeAlias, field: string): string {
	const value = row[field];
	return value === undefined || value === null ? "" : String(value);
}

// ---------------------------------------------------------------------------
// 9 kind renderers — one per approve-command artifact kind
// ---------------------------------------------------------------------------

/** prd — mirrored section rows + FR + NFR rows (Phase 6 §14.2 DB-rendered).
 * v002 prose columns (`text`, `body`) flow into the rendered markdown so
 * the published PRD is a DB-derived human view, not the LLM preview.
 */
export function renderPrdMarkdown(rows: Record<string, unknown>): string {
	const fr = sorted((rows.fr as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const nfr = sorted((rows.nfr as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const sections = sorted((rows.prdSection as RowLikeAlias[] | undefined) ?? [], (r) => Number(r.no));
	return (
		table(
			"Functional Requirements",
			["ID", "Phase", "Text Hash", "Text"],
			fr.map((r) => [r.id, r.phase, r.textHash, r.text]),
		) +
		table(
			"Non-Functional Requirements",
			["ID", "Phase", "Text Hash", "Text"],
			nfr.map((r) => [r.id, r.phase, r.textHash, r.text]),
		) +
		table(
			"Sections",
			["No", "Title", "Body Ref", "Body"],
			sections.map((r) => [r.no, r.title, r.bodyRef, r.body]),
		)
	);
}

/** rtm — traceability rows with fingerprint columns. */
export function renderRtmMarkdown(rows: Record<string, unknown>): string {
	const list = sorted((rows.rtmRow as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	return table(
		"Traceability Rows",
		["ID", "FR", "AF", "TC", "Phase", "Target SHA-256"],
		list.map((r) => [r.id, r.frRef ?? r.nfrRef, r.afRef, r.tcRef, r.phase, r.targetSha256]),
	);
}

/** feasibility — decision + spikes + reuse scan. */
export function renderFeasibilityMarkdown(rows: Record<string, unknown>): string {
	const decision = rows.feasibilityDecision as RowLikeAlias | undefined;
	const decisionTable = decision
		? table(
				"Decision",
				["Verdict", "Language", "Decided By", "At", "Web Search Consent"],
				[
					[
						decision.verdict,
						decision.language,
						decision.decidedBy,
						decision.at,
						decision.webSearchConsent === 1 ? "yes" : decision.webSearchConsent === 0 ? "no" : "",
					],
				],
			)
		: table("Decision", ["Verdict"], []);
	const spikes = sorted((rows.feasibilitySpike as RowLikeAlias[] | undefined) ?? [], (r) => String(r.language));
	const scan = sorted((rows.reuseScan as RowLikeAlias[] | undefined) ?? [], (r) => String(r.candidate));
	return (
		decisionTable +
		table(
			"Spikes",
			["Language", "Passed", "Result Ref"],
			spikes.map((r) => [r.language, r.passed === 1 ? "yes" : "no", r.resultRef]),
		) +
		table(
			"Reuse Scan",
			["Candidate", "License", "Repo Freshness", "Verdict"],
			scan.map((r) => [r.candidate, r.license, r.repoFreshness, r.verdict]),
		)
	);
}

/** design — modules, source FRs, ADRs, diagrams (mermaid), approaches. */
export function renderDesignMarkdown(rows: Record<string, unknown>, projectSlug = ""): string {
	const modules = sorted((rows.designModule as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const sourceFr = sorted((rows.moduleSourceFr as RowLikeAlias[] | undefined) ?? [], (r) => `${r.moduleId} ${r.frId}`);
	const adr = sorted((rows.adr as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const diagrams = sorted((rows.diagram as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const approach = sorted((rows.approach as RowLikeAlias[] | undefined) ?? [], (r) => `${r.moduleId} ${r.tacticId}`);
	let diagramBlocks = "";
	if (diagrams.length > 0) {
		diagramBlocks = "## Diagrams\n\n";
		for (const d of diagrams) {
			// No project context (legacy callers/tests) → fall back to the DB-dir
			// asset path as-is (the doctor sweep still resolves it correctly).
			diagramBlocks += renderDiagram(d, projectSlug || "PROJECT");
		}
	}
	return (
		table(
			"Modules",
			["ID", "Name"],
			modules.map((r) => [r.id, r.name]),
		) +
		table(
			"Module Source FRs",
			["Module", "FR"],
			sourceFr.map((r) => [r.moduleId, r.frId]),
		) +
		table(
			"ADRs",
			["ID", "Status", "Options", "Chosen", "Rationale"],
			adr.map((r) => [r.id, r.adrStatus, r.options, r.chosen, r.rationale]),
		) +
		diagramBlocks +
		table(
			"Approaches",
			["Module", "Tactic"],
			approach.map((r) => [r.moduleId, r.tacticId]),
		)
	);
}

/**
 * Render ONE diagram row (D8, Phase 10 — v1.3 markdown-image output).
 * `image:`-prefixed mermaid_text is an ASSET reference: the remainder is a
 * path relative to the owning DB dir (Doc/store/<project>/). Renderers NEVER
 * read the filesystem (G5 byte-stability; review v1.2 item 12) — the asset
 * existence check is the doctor's portfolio-asset-missing sweep alone.
 *
 * Output: a plain markdown image `![diagram <id>](<resolved-path>)` — a
 * mermaid fence around `image:…` would render broken in every viewer,
 * defeating D8's "viewable in any tool" goal (review v1.3 design question).
 * Resolved path: `../../store/<project>/<asset>` — grouped docs live at
 * Doc/<category>/, so up-2 is Doc/ (constant per kind, G5-safe). Custom
 * /velpari-export destinations may not resolve the relative link — accepted
 * limitation (decision §15.5); the doctor sweep is authoritative.
 *
 * Inline diagram text (no image: prefix) renders as today: a mermaid fence,
 * verbatim.
 *
 * @param {RowLikeAlias} d - The diagram row (id, diagramKind, mermaidText).
 * @param {string} projectSlug - Sanitized project name (the DB dir name).
 * @returns {string} Markdown block (heading + image or fence).
 */
export function renderDiagram(d: RowLikeAlias, projectSlug: string): string {
	const id = str(d, "id");
	const text = str(d, "mermaidText");
	if (text.startsWith("image:")) {
		const asset = text.slice("image:".length).trim();
		return `### ${id} (${str(d, "diagramKind")})\n\n![diagram ${id}](../../store/${projectSlug}/${asset})\n\n`;
	}
	return `### ${id} (${str(d, "diagramKind")})\n\n\`\`\`mermaid\n${text}\n\`\`\`\n\n`;
}

/** atomic-functions — the AF catalog with tier/criticality/SIL columns. */
export function renderAtomicFunctionsMarkdown(rows: Record<string, unknown>): string {
	const list = sorted((rows.atomicFunction as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	return table(
		"Atomic Functions",
		["ID", "Name", "Signature", "Tier", "Criticality", "SIL", "Leaf"],
		list.map((r) => [r.id, r.name, r.signature, r.tier, r.criticality, r.sil, r.isLeaf === 1 ? "yes" : "no"]),
	);
}

/** pseudocode — blocks keyed by AF reference. */
export function renderPseudocodeMarkdown(rows: Record<string, unknown>): string {
	const list = sorted((rows.pseudocodeBlock as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	return table(
		"Pseudocode Blocks",
		["ID", "AF", "Content Hash"],
		list.map((r) => [r.id, r.afRef, r.contentHash]),
	);
}

/** testplan — test cases + their traces. */
export function renderTestplanMarkdown(rows: Record<string, unknown>): string {
	const cases = sorted((rows.testCase as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const traces = sorted(
		(rows.tcTrace as RowLikeAlias[] | undefined) ?? [],
		(r) => `${r.tcId} ${r.targetKind} ${r.targetId}`,
	);
	return (
		table(
			"Test Cases",
			["ID", "Kind", "Strategy"],
			cases.map((r) => [r.id, r.tcKind, r.strategyRef]),
		) +
		table(
			"Traces",
			["TC", "Target Kind", "Target ID"],
			traces.map((r) => [r.tcId, r.targetKind, r.targetId]),
		)
	);
}

/**
 * test-cases — DB-rendered markdown (Phase 6, decision §14.2). Sourced
 * from `testCase` + `tcTrace` rows. Compact per-stage template on top of
 * the Phase 5 renderer pattern (decision 9): the prose columns
 * (`steps`/`objective`/`expected`, added in v002) carry the actual test
 * text — the DB IS the source of truth.
 */
export function renderTestCasesMarkdown(rows: Record<string, unknown>): string {
	const cases = sorted((rows.testCase as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const traces = sorted(
		(rows.tcTrace as RowLikeAlias[] | undefined) ?? [],
		(r) => `${r.tcId} ${r.targetKind} ${r.targetId}`,
	);
	return (
		table(
			"Test Cases",
			["ID", "Kind", "Strategy", "Objective"],
			cases.map((r) => [r.id, r.tcKind, r.strategyRef, r.objective]),
		) +
		table(
			"Test Steps",
			["TC", "Steps", "Expected"],
			cases.map((r) => [r.id, r.steps, r.expected]),
		) +
		table(
			"Traces",
			["TC", "Target Kind", "Target ID"],
			traces.map((r) => [r.tcId, r.targetKind, r.targetId]),
		)
	);
}

/** development-order — steps with AF membership + dependency edges. */
export function renderDevelopmentOrderMarkdown(rows: Record<string, unknown>): string {
	const steps = sorted((rows.devStep as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const afs = sorted((rows.stepAf as RowLikeAlias[] | undefined) ?? [], (r) => `${r.stepId} ${r.afId}`);
	const deps = sorted((rows.stepDep as RowLikeAlias[] | undefined) ?? [], (r) => `${r.stepId} ${r.dependsOnId}`);
	const base =
		table(
			"Development Steps",
			["ID", "Module"],
			steps.map((r) => [r.id, r.module]),
		) +
		table(
			"Step Atomic Functions",
			["Step", "AF"],
			afs.map((r) => [r.stepId, r.afId]),
		) +
		table(
			"Step Dependencies",
			["Step", "Depends On"],
			deps.map((r) => [r.stepId, r.dependsOnId]),
		);
	// Phase 7 / N16 — lane sections appear ONLY when the rows carry devLane
	// data; a pre-Phase-7 artifact renders byte-identical to the 3 tables.
	const laneRows = rows.devLane;
	if (!Array.isArray(laneRows) || laneRows.length === 0) return base;
	return base + renderLaneSections(rows);
}

/**
 * Phase 7 / N16 — the four deterministic lane sections appended to the
 * development-order view: Execution Lanes (table + per-lane worktree line),
 * Integration Plan (merge order from the DAG + fixed parked/re-gate note),
 * Lock Rules (the `dev-lanes.ts` constants, verbatim) and Lane Shape (the
 * level narrative derived from the graph). Returns "" when the rows cannot
 * form a graph — degenerate input never renders invented data (the doctor's
 * lane-integrity check reports the violation instead).
 * @param rows - development-order payload rows (devStep/stepDep/devLane).
 * @returns Markdown sections, or "" when no lane view is derivable.
 */
function renderLaneSections(rows: Record<string, unknown>): string {
	const stepInputs: LaneStepInput[] = ((rows.devStep as RowLikeAlias[] | undefined) ?? []).map((r) => ({
		stepId: String(r.id),
		...(typeof r.module === "string" && r.module.length > 0 ? { module: r.module } : {}),
	}));
	const depInputs: LaneDepInput[] = ((rows.stepDep as RowLikeAlias[] | undefined) ?? []).map((r) => ({
		stepId: String(r.stepId),
		dependsOnStepId: String(r.dependsOnId),
	}));
	const laneRows: LaneProposal[] = ((rows.devLane as RowLikeAlias[] | undefined) ?? []).map((r) => ({
		laneId: String(r.laneId),
		stepId: String(r.stepId),
		position: Number(r.position),
		worktree: String(r.worktree),
		branch: String(r.branch),
		status: (r.status as LaneStatus | undefined) ?? "active",
	}));
	const view = laneViewFromRows(laneRows, stepInputs, depInputs);
	if (!view) return "";

	const laneTable = table(
		"Execution Lanes",
		["Lane", "Status", "Steps (in order)", "Worktree", "Branch"],
		view.lanes.map((lane) => [lane.laneId, lane.status, lane.steps.join(", "), lane.worktree, lane.branch]),
	);
	const worktreeLines = view.lanes
		.map((lane) => "- `git worktree add ../" + lane.worktree + " -b " + lane.branch + "`")
		.join("\n");

	const planTable = table(
		"Integration Plan",
		["Order", "Lane", "Merge level", "Gates"],
		view.integration.map((entry) => [entry.order, entry.laneId, entry.mergeLevel, LANE_MERGE_GATES.join(" + ")]),
	);
	const planNote =
		"Lane ready before its series boundary ⇒ `parked` (locked for edit); re-verify (rebuild + tests + doctor) " +
		"against the integration branch before merge. Gate per merge: tests green + doctor audit. " +
		"Lane locked for edit from merge start until the merge commit lands.";

	const lockRules = "## Lock Rules\n\n" + LANE_LOCK_RULES.map((rule) => `- ${rule}`).join("\n") + "\n";

	const segments: string[] = [];
	view.levelSizes.forEach((size, level) => {
		if (size <= 1) {
			segments.push("series (1 step)");
			return;
		}
		const lanesAtLevel = new Set(
			view.lanes.filter((lane) => lane.steps.some((id) => view.level[id] === level)).map((lane) => lane.laneId),
		);
		const count = lanesAtLevel.size;
		segments.push(`parallel (${count} ${count === 1 ? "lane" : "lanes"})`);
	});
	const shapeLine = `Shape: ${segments.join(" → ")} — derived from the step dependency graph, not a template.`;
	const shapeSection =
		"## Lane Shape\n\n" +
		shapeLine +
		"\n\n" +
		"Steps at the same level run in parallel across lanes; dependent steps stay sequential inside one lane.\n";

	return laneTable + "\n" + worktreeLines + "\n" + planTable + "\n" + planNote + "\n" + lockRules + shapeSection;
}

/** final-design — consolidated sections with their sources. */
export function renderFinalDesignMarkdown(rows: Record<string, unknown>): string {
	const list = sorted((rows.finalSection as RowLikeAlias[] | undefined) ?? [], (r) => Number(r.no));
	return table(
		"Final Sections",
		["No", "Title", "Source Artifact", "Source IDs"],
		list.map((r) => [r.no, r.title, r.sourceArtifact, r.sourceIds]),
	);
}

/**
 * Render one kind's row-set section through the same dispatch table the
 * head exporter uses (Phase 4 — ops/export-revision.ts renders snapshot
 * bytes through this door so md views stay renderer-identical).
 */
export function renderKindMarkdown(kind: ArtifactKind, rows: Record<string, unknown>, projectSlug = ""): string {
	return RENDERERS[kind](rows, projectSlug);
}

/**
 * Row counts per payload key (Phase 4 — public door over countRows for
 * ops/export-revision.ts; one implementation, two callers).
 */
export function countRowsOf(rows: Record<string, unknown>): Record<string, number> {
	return countRows(rows);
}

/** Per-kind renderer dispatch (KIND_ORDER's twin — one entry per kind). Design
 * takes the project slug for D8 asset paths (Phase 10). */
const RENDERERS: Record<ArtifactKind, (rows: Record<string, unknown>, projectSlug?: string) => string> = {
	prd: renderPrdMarkdown,
	rtm: renderRtmMarkdown,
	feasibility: renderFeasibilityMarkdown,
	design: (rows, projectSlug) => renderDesignMarkdown(rows, projectSlug),
	"atomic-functions": renderAtomicFunctionsMarkdown,
	pseudocode: renderPseudocodeMarkdown,
	testplan: renderTestplanMarkdown,
	"development-order": renderDevelopmentOrderMarkdown,
	"final-design": renderFinalDesignMarkdown,
};

// ---------------------------------------------------------------------------
// mdToHtml — in-house deterministic converter (zero deps, bounded subset)
// ---------------------------------------------------------------------------

/** Escape HTML special characters (first pass — content is never trusted). */
function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Inline spans: code first (protects its content), then bold, then italic. */
function inline(text: string): string {
	let out = text.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
	out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
	return out;
}

/**
 * Deterministic markdown → HTML converter over the bounded subset our
 * renderers emit: h1–h4, pipe tables, fenced code blocks, bullet/ordered
 * lists, paragraphs, bold/italic/code spans. Anything else passes through
 * ESCAPED as text (visible, never silent corruption — plan R1). Zero
 * dependencies (user decision 1, Rule 7).
 * @param {string} markdown - The renderer's markdown output.
 * @returns {string} HTML document with the converted body.
 */
export function mdToHtml(markdown: string): string {
	const srcLines = markdown.split("\n");
	const body: string[] = [];
	let i = 0;
	while (i < srcLines.length) {
		const line = srcLines[i]!;
		// Fenced code block.
		if (line.startsWith("```")) {
			const lang = line.slice(3).trim();
			const codeLines: string[] = [];
			i += 1;
			while (i < srcLines.length && !srcLines[i]!.startsWith("```")) {
				codeLines.push(srcLines[i]!);
				i += 1;
			}
			i += 1; // closing fence (or end of input)
			const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
			body.push(`<pre><code${cls}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
			continue;
		}
		// Headings h1–h4.
		const heading = /^(#{1,4}) (.*)$/.exec(line);
		if (heading) {
			const level = heading[1]!.length;
			body.push(`<h${level}>${inline(escapeHtml(heading[2]!))}</h${level}>`);
			i += 1;
			continue;
		}
		// Pipe table: header row followed by a |---| separator.
		if (line.startsWith("|") && i + 1 < srcLines.length && /^\|[\s|:-]+\|$/.test(srcLines[i + 1]!)) {
			/**
			 * Split a pipe-table row into trimmed cells. A pipe escaped in
			 * markdown as `\|` is cell TEXT (the md renderer escapes it),
			 * not a column separator — split only on unescaped pipes, then
			 * unescape `\|` → `|` and `\\` → `\` (Phase I9: an FR/NFR cell
			 * containing a pipe used to render as two `<td>`s).
			 * @param {string} row - Raw row line without the leading/trailing pipe.
			 * @returns {string[]} The row's trimmed cell values.
			 */
			const parseCells = (row: string): string[] =>
				row
					.slice(1, -1)
					.split(/(?<!\\)\|/) // a pipe preceded by a backslash is escaped text
					.map((c) => c.trim().replace(/\\\|/g, "|").replace(/\\\\/g, "\\"));
			const headers = parseCells(line);
			i += 2;
			const rows: string[][] = [];
			while (i < srcLines.length && srcLines[i]!.startsWith("|")) {
				rows.push(parseCells(srcLines[i]!));
				i += 1;
			}
			body.push("<table><thead><tr>");
			for (const h of headers) body.push(`<th>${inline(escapeHtml(h))}</th>`);
			body.push("</tr></thead><tbody>");
			for (const row of rows) {
				body.push("<tr>");
				for (let c = 0; c < headers.length; c += 1) {
					body.push(`<td>${inline(escapeHtml(row[c] ?? ""))}</td>`);
				}
				body.push("</tr>");
			}
			body.push("</tbody></table>");
			continue;
		}
		// Bullet list.
		if (/^- /.test(line)) {
			body.push("<ul>");
			while (i < srcLines.length && /^- /.test(srcLines[i]!)) {
				body.push(`<li>${inline(escapeHtml(srcLines[i]!.slice(2)))}</li>`);
				i += 1;
			}
			body.push("</ul>");
			continue;
		}
		// Ordered list.
		if (/^\d+\. /.test(line)) {
			body.push("<ol>");
			while (i < srcLines.length && /^\d+\. /.test(srcLines[i]!)) {
				body.push(`<li>${inline(escapeHtml(srcLines[i]!.replace(/^\d+\. /, "")))}</li>`);
				i += 1;
			}
			body.push("</ol>");
			continue;
		}
		// Blank line — paragraph separator.
		if (line.trim() === "") {
			i += 1;
			continue;
		}
		// Paragraph: consecutive plain lines joined with <br>.
		const para: string[] = [];
		while (
			i < srcLines.length &&
			srcLines[i]!.trim() !== "" &&
			!srcLines[i]!.startsWith("```") &&
			!srcLines[i]!.startsWith("#") &&
			!srcLines[i]!.startsWith("|") &&
			!/^- /.test(srcLines[i]!) &&
			!/^\d+\. /.test(srcLines[i]!)
		) {
			para.push(srcLines[i]!);
			i += 1;
		}
		body.push(`<p>${para.map((l) => inline(escapeHtml(l))).join("<br>\n")}</p>`);
	}
	return (
		[
			"<!DOCTYPE html>",
			'<html lang="en">',
			"<head>",
			'<meta charset="utf-8">',
			"<title>Exported Document</title>",
			"</head>",
			"<body>",
			...body,
			"</body>",
			"</html>",
		].join("\n") + "\n"
	);
}

/**
 * v1.2 D3 — materialize `Doc/design/wireframe_<slug>.md` from a design
 * payload's `diagram` rows (diagramKind "wireframe"), so a DB-only project's
 * handoff resolves the published wireframe without the working-copy fallback
 * (phase-D integration request 3). Presence-driven: no wireframe rows → no
 * file, no message. Reuses `renderDiagram` so output matches the design view.
 * @param rows - The design kind's payload rows.
 * @param opts - dbPath (slug derivation), cwd (project root), overwrite flag, envelope meta.
 * @returns Warning text when an existing sidecar was skipped; otherwise undefined.
 */
export function materializeWireframe(
	rows: Record<string, unknown>,
	opts: {
		dbPath: string;
		cwd: string;
		overwrite?: boolean;
		meta: { runId: string; stage: string; version: number; generatedAt: string };
	},
): string | undefined {
	const diagrams = Array.isArray(rows.diagram) ? rows.diagram : [];
	const wireframes = diagrams
		.filter(
			(d): d is Record<string, unknown> =>
				!!d && typeof d === "object" && (d as { diagramKind?: unknown }).diagramKind === "wireframe",
		)
		.sort((a, b) => String((a as { id?: unknown }).id ?? "").localeCompare(String((b as { id?: unknown }).id ?? "")));
	if (wireframes.length === 0) return undefined;
	const slugMatch = /[\\/]store[\\/]([^\\/]+)[\\/]index\.db$/.exec(opts.dbPath);
	const slug = slugMatch ? slugMatch[1]! : "";
	if (slug === "") return undefined;
	const target = join(opts.cwd, buildGroupedPath("wireframe", slug));
	if (existsSync(target) && opts.overwrite !== true) {
		return `${target} exists — wireframe sidecar not overwritten (confirm overwrite to replace it).`;
	}
	const lines = [
		"---",
		"artifact: wireframe",
		`runId: ${opts.meta.runId}`,
		`stage: ${opts.meta.stage}`,
		`version: ${opts.meta.version}`,
		`generatedAt: ${opts.meta.generatedAt}`,
		"---",
		"",
		`# Wireframe — ${slug}`,
		"",
	];
	for (const row of wireframes) {
		lines.push(renderDiagram(row, slug).trimEnd(), "");
	}
	atomicWriteFile(target, lines.join("\n"), "utf8");
	return undefined;
}

// ---------------------------------------------------------------------------
// runExport — the single deterministic entry point
// ---------------------------------------------------------------------------

/** Row counts per payload key (arrays → length, single objects → 1). */
function countRows(rows: Record<string, unknown>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const [key, value] of Object.entries(rows)) {
		if (Array.isArray(value)) counts[key] = value.length;
		else if (value !== undefined && value !== null) counts[key] = 1;
	}
	return counts;
}

/**
 * Derive the project slug (DB dir name) from the export request's dbPath —
 * `.../Doc/store/<slug>/index.db`. Used for D8 asset-path resolution; empty
 * when the shape does not match (non-store dbPath).
 * @param {ExportInput} input - The export request.
 * @returns {string} The project slug, or "".
 */
function projectSlugOf(input: ExportInput): string {
	const m = /[\\/]store[\\/]([^\\/]+)[\\/]index\.db$/.exec(input.dbPath);
	return m ? m[1]! : "";
}

/**
 * Export one published artifact version from the store DB to a file (D4).
 * Read-only against the DB; the only write is the destination file via
 * atomicWriteFile. Refusals return `ok:false` + `problem` — never throw.
 * @param {ExportInput} input - Fully resolved export request.
 * @returns {ExportResult} Outcome (path + counts, or problem).
 */
export function runExport(input: ExportInput): ExportResult {
	if (!existsSync(input.dbPath)) {
		return { ok: false, problem: `store DB not found at ${input.dbPath}` };
	}
	let db: DatabaseSync;
	try {
		db = openStoreDb(input.dbPath);
	} catch (err) {
		return { ok: false, problem: `cannot open store DB: ${String(err)}` };
	}
	try {
		const read = readArtifact(db, input.runId, input.kind);
		if (!read) {
			return {
				ok: false,
				problem: `no artifact ${input.kind} for run ${input.runId}`,
			};
		}
		if (read.envelope.status !== "published") {
			return {
				ok: false,
				problem: `artifact ${input.kind}/${input.runId} is not published — drafts are never exported`,
			};
		}
		if (read.envelope.version !== input.version) {
			return {
				ok: false,
				problem: `version changed since the picker listed it (picked ${input.version}, store has ${read.envelope.version})`,
			};
		}
		if (existsSync(input.outputPath) && input.overwrite !== true) {
			return {
				ok: false,
				problem: `file already exists: ${input.outputPath}`,
			};
		}
		let bytes: string;
		if (input.format === "yaml") {
			// Byte-identical to the publish-time sidecar bytes (RES-1).
			const yaml = exportArtifactYaml(db, input.runId, input.kind);
			if (yaml === null) {
				return { ok: false, problem: "artifact vanished between read and export" };
			}
			bytes = yaml;
		} else {
			const md = renderEnvelopeHeader(read.envelope) + "\n" + RENDERERS[input.kind](read.rows, projectSlugOf(input));
			bytes = input.format === "html" ? mdToHtml(md) : md;
		}
		atomicWriteFile(input.outputPath, bytes, "utf8");

		// v1.2 D3 — same wireframe sidecar wiring as runRevisionExport.
		const warnings: string[] = [];
		if (input.kind === "design" && input.cwd) {
			const wfWarning = materializeWireframe(read.rows, {
				dbPath: input.dbPath,
				cwd: input.cwd,
				overwrite: input.overwrite,
				meta: {
					runId: read.envelope.runId,
					stage: read.envelope.stage,
					version: read.envelope.version,
					generatedAt: read.envelope.generatedAt,
				},
			});
			if (wfWarning) warnings.push(wfWarning);
		}
		return {
			ok: true,
			path: input.outputPath,
			counts: countRows(read.rows),
			warnings: warnings.length > 0 ? warnings : undefined,
		};
	} finally {
		closeStoreDb(db);
	}
}
