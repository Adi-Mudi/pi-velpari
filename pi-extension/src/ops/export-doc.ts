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
import { openStoreDb, closeStoreDb } from "../io/db.js";
import {
	readArtifact,
	exportArtifactYaml,
	type ArtifactEnvelope,
	type ArtifactKind,
} from "../io/store.js";
import { atomicWriteFile } from "../io/atomic-write.js";

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
}

/** File-name label per kind (matches buildStoreYamlPath sidecar labels). */
const KIND_LABELS: Record<ArtifactKind, string> = {
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
	return join(
		cwd,
		"Doc",
		"export",
		safeProject,
		`${KIND_LABELS[kind]}_${safeProject}.${format}`,
	);
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
			lines.push(
				`- ${typeof entry === "string" ? entry : JSON.stringify(entry)}`,
			);
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

/** prd — mirrored section rows + FR + NFR rows (user decision 4). */
export function renderPrdMarkdown(rows: Record<string, unknown>): string {
	const fr = sorted((rows.fr as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const nfr = sorted((rows.nfr as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const sections = sorted((rows.prdSection as RowLikeAlias[] | undefined) ?? [], (r) => Number(r.no));
	return (
		table("Functional Requirements", ["ID", "Phase", "Text Hash"],
			fr.map((r) => [r.id, r.phase, r.textHash])) +
		table("Non-Functional Requirements", ["ID", "Phase", "Text Hash"],
			nfr.map((r) => [r.id, r.phase, r.textHash])) +
		table("Sections", ["No", "Title", "Body Ref"],
			sections.map((r) => [r.no, r.title, r.bodyRef]))
	);
}

/** rtm — traceability rows with fingerprint columns. */
export function renderRtmMarkdown(rows: Record<string, unknown>): string {
	const list = sorted((rows.rtmRow as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	return table("Traceability Rows", ["ID", "FR", "AF", "TC", "Phase", "Target SHA-256"],
		list.map((r) => [r.id, r.frRef, r.afRef, r.tcRef, r.phase, r.targetSha256]));
}

/** feasibility — decision + spikes + reuse scan. */
export function renderFeasibilityMarkdown(rows: Record<string, unknown>): string {
	const decision = rows.feasibilityDecision as RowLikeAlias | undefined;
	const decisionTable = decision
		? table("Decision", ["Verdict", "Language", "Decided By", "At", "Web Search Consent"], [
			[
				decision.verdict,
				decision.language,
				decision.decidedBy,
				decision.at,
				decision.webSearchConsent === 1 ? "yes" : decision.webSearchConsent === 0 ? "no" : "",
			],
		])
		: table("Decision", ["Verdict"], []);
	const spikes = sorted((rows.feasibilitySpike as RowLikeAlias[] | undefined) ?? [], (r) => String(r.language));
	const scan = sorted((rows.reuseScan as RowLikeAlias[] | undefined) ?? [], (r) => String(r.candidate));
	return (
		decisionTable +
		table("Spikes", ["Language", "Passed", "Result Ref"],
			spikes.map((r) => [r.language, r.passed === 1 ? "yes" : "no", r.resultRef])) +
		table("Reuse Scan", ["Candidate", "License", "Repo Freshness", "Verdict"],
			scan.map((r) => [r.candidate, r.license, r.repoFreshness, r.verdict]))
	);
}

/** design — modules, source FRs, ADRs, diagrams (mermaid), approaches. */
export function renderDesignMarkdown(rows: Record<string, unknown>): string {
	const modules = sorted((rows.designModule as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const sourceFr = sorted(
		(rows.moduleSourceFr as RowLikeAlias[] | undefined) ?? [],
		(r) => `${r.moduleId} ${r.frId}`,
	);
	const adr = sorted((rows.adr as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const diagrams = sorted((rows.diagram as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const approach = sorted(
		(rows.approach as RowLikeAlias[] | undefined) ?? [],
		(r) => `${r.moduleId} ${r.tacticId}`,
	);
	let diagramBlocks = "";
	if (diagrams.length > 0) {
		diagramBlocks = "## Diagrams\n\n";
		for (const d of diagrams) {
			diagramBlocks += `### ${str(d, "id")} (${str(d, "diagramKind")})\n\n\`\`\`mermaid\n${str(d, "mermaidText")}\n\`\`\`\n\n`;
		}
	}
	return (
		table("Modules", ["ID", "Name"], modules.map((r) => [r.id, r.name])) +
		table("Module Source FRs", ["Module", "FR"],
			sourceFr.map((r) => [r.moduleId, r.frId])) +
		table("ADRs", ["ID", "Status", "Options", "Chosen", "Rationale"],
			adr.map((r) => [r.id, r.adrStatus, r.options, r.chosen, r.rationale])) +
		diagramBlocks +
		table("Approaches", ["Module", "Tactic"],
			approach.map((r) => [r.moduleId, r.tacticId]))
	);
}

/** atomic-functions — the AF catalog with tier/criticality/SIL columns. */
export function renderAtomicFunctionsMarkdown(rows: Record<string, unknown>): string {
	const list = sorted((rows.atomicFunction as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	return table("Atomic Functions",
		["ID", "Name", "Signature", "Tier", "Criticality", "SIL", "Leaf"],
		list.map((r) => [r.id, r.name, r.signature, r.tier, r.criticality, r.sil, r.isLeaf === 1 ? "yes" : "no"]));
}

/** pseudocode — blocks keyed by AF reference. */
export function renderPseudocodeMarkdown(rows: Record<string, unknown>): string {
	const list = sorted((rows.pseudocodeBlock as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	return table("Pseudocode Blocks", ["ID", "AF", "Content Hash"],
		list.map((r) => [r.id, r.afRef, r.contentHash]));
}

/** testplan — test cases + their traces. */
export function renderTestplanMarkdown(rows: Record<string, unknown>): string {
	const cases = sorted((rows.testCase as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const traces = sorted(
		(rows.tcTrace as RowLikeAlias[] | undefined) ?? [],
		(r) => `${r.tcId} ${r.targetKind} ${r.targetId}`,
	);
	return (
		table("Test Cases", ["ID", "Kind", "Strategy"],
			cases.map((r) => [r.id, r.tcKind, r.strategyRef])) +
		table("Traces", ["TC", "Target Kind", "Target ID"],
			traces.map((r) => [r.tcId, r.targetKind, r.targetId]))
	);
}

/** development-order — steps with AF membership + dependency edges. */
export function renderDevelopmentOrderMarkdown(rows: Record<string, unknown>): string {
	const steps = sorted((rows.devStep as RowLikeAlias[] | undefined) ?? [], (r) => String(r.id));
	const afs = sorted(
		(rows.stepAf as RowLikeAlias[] | undefined) ?? [],
		(r) => `${r.stepId} ${r.afId}`,
	);
	const deps = sorted(
		(rows.stepDep as RowLikeAlias[] | undefined) ?? [],
		(r) => `${r.stepId} ${r.dependsOnId}`,
	);
	return (
		table("Development Steps", ["ID", "Module"],
			steps.map((r) => [r.id, r.module])) +
		table("Step Atomic Functions", ["Step", "AF"],
			afs.map((r) => [r.stepId, r.afId])) +
		table("Step Dependencies", ["Step", "Depends On"],
			deps.map((r) => [r.stepId, r.dependsOnId]))
	);
}

/** final-design — consolidated sections with their sources. */
export function renderFinalDesignMarkdown(rows: Record<string, unknown>): string {
	const list = sorted((rows.finalSection as RowLikeAlias[] | undefined) ?? [], (r) => Number(r.no));
	return table("Final Sections", ["No", "Title", "Source Artifact", "Source IDs"],
		list.map((r) => [r.no, r.title, r.sourceArtifact, r.sourceIds]));
}

/** Per-kind renderer dispatch (KIND_ORDER's twin — one entry per kind). */
const RENDERERS: Record<ArtifactKind, (rows: Record<string, unknown>) => string> = {
	prd: renderPrdMarkdown,
	rtm: renderRtmMarkdown,
	feasibility: renderFeasibilityMarkdown,
	design: renderDesignMarkdown,
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
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
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
			 * Split a pipe-table row into trimmed cells.
			 * @param {string} row - Raw row line without the leading/trailing pipe.
			 * @returns {string[]} The row's trimmed cell values.
			 */
			const parseCells = (row: string): string[] =>
				row.slice(1, -1).split("|").map((c) => c.trim());
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
	return [
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
	].join("\n") + "\n";
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
	let db;
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
			const md = renderEnvelopeHeader(read.envelope) + "\n" + RENDERERS[input.kind](read.rows);
			bytes = input.format === "html" ? mdToHtml(md) : md;
		}
		atomicWriteFile(input.outputPath, bytes, "utf8");
		return {
			ok: true,
			path: input.outputPath,
			counts: countRows(read.rows),
		};
	} finally {
		closeStoreDb(db);
	}
}
