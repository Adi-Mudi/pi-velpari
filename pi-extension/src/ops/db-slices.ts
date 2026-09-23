// ============================================================================
// ops/db-slices.ts — DB input slices (Layer 1, Phase 6 read flip)
// ============================================================================
// Decision record: .IDE_Plans/velpari-storage-traceability_decision-record_*_v1.0.md
//   §14.1 — strict DB-only reads: from PRD onward every stage + scout reads
//           DB slices ONLY; Doc/ markdown, YAML, HTML are human views.
//   Decision 1 — brainstorm notes stay the ONE file-based input. The reviewer
//           agent is the sole exception (reads slice AND published view).
//   Decision 3 — empty DB slice on a pre-store project → REFUSE LOUDLY +
//           name `/velpari-backfill <kind>`; never a silent file fallback.
//   Decision 9 — rendering reuses the Phase 5 renderer conventions
//           (explicit natural-key sorts, fixed columns) in compact
//           per-stage slice templates.
//   G5     — deterministic bytes: same rows in → same slice block out.
//
// Consumers: stages/registry.ts (resolveStageInputs → resolveStageSlice),
// core/prompt.ts receives the pre-rendered block (L0 takes strings — no
// L0→L1 import). Layering: L1 (ops/) importing L0 (io/, core/) only.
// ============================================================================

import { existsSync } from "node:fs";
import type { StageKey } from "../stages/registry.js";
import { buildStoreDbPath } from "../core/paths.js";
import { readLatestPublishedRows, type ArtifactKind } from "../io/store.js";

// ---------------------------------------------------------------------------
// Doc-artifact name → store kind ("test-plan" and "test-cases" both live in
// the `testplan` kind; the two Doc/ views render different projections).
// ---------------------------------------------------------------------------

export const DOC_ARTIFACT_TO_KIND: Record<string, ArtifactKind> = {
	PRD: "prd",
	RTM: "rtm",
	"feasibility-study": "feasibility",
	design: "design",
	"atomic-functions": "atomic-functions",
	pseudocode: "pseudocode",
	"test-plan": "testplan",
	"test-cases": "testplan",
	"development-order": "development-order",
	"final-design": "final-design",
};

/** Map a `StageInputDoc.artifact` value to its store kind (undefined = unknown). */
export function docArtifactToKind(artifact: string): ArtifactKind | undefined {
	return DOC_ARTIFACT_TO_KIND[artifact];
}

// ---------------------------------------------------------------------------
// Per-stage slice kinds — the stage's doc inputs expressed as store kinds.
// `prd` is empty: its only input is the brainstorm notes (file-based,
// decision 1). Mirrors STAGE_REGISTRY[*].inputs; the db-slices test guards
// the two against drift.
// ---------------------------------------------------------------------------

export const STAGE_SLICE_KINDS: Record<StageKey, readonly ArtifactKind[]> = {
	prd: [],
	rtm: ["prd"],
	feasibility: ["rtm"],
	"architecture-generator": ["feasibility"],
	"atomic-function": ["prd", "rtm", "feasibility", "design"],
	pseudocode: ["design", "atomic-functions"],
	testplan: ["pseudocode", "atomic-functions"],
	"development-order": ["design", "prd", "rtm", "feasibility", "atomic-functions", "pseudocode", "testplan"],
	"final-design": ["design", "atomic-functions", "pseudocode", "testplan", "development-order"],
};

/**
 * Row-sets whose v002 prose columns are REQUIRED for slice reads (payload
 * validation marks them REQUIRED too). A published kind whose rows all
 * lack the prose column is a legacy v001 store → refuse + backfill
 * (decision 3). Optional prose columns (design description, AF purpose,
 * dev-step description, PRD section body) never refuse here.
 */
const REQUIRED_PROSE: Partial<Record<ArtifactKind, { rowSet: string; field: string }[]>> = {
	prd: [
		{ rowSet: "fr", field: "text" },
		{ rowSet: "nfr", field: "text" },
	],
	pseudocode: [{ rowSet: "pseudocodeBlock", field: "content" }],
	testplan: [{ rowSet: "testCase", field: "steps" }],
};

// ---------------------------------------------------------------------------
// Slice result types — ok:false carries a LOUD message (decision 3).
// ---------------------------------------------------------------------------

export type SliceRefuseReason = "no-store-db" | "kind-unpublished" | "rows-lack-prose";

export interface SliceRefusal {
	ok: false;
	reason: SliceRefuseReason;
	/** The kind that failed (absent for no-store-db). */
	kind?: ArtifactKind;
	/** Human-readable refuse message — names /velpari-backfill <kind>. */
	message: string;
}

export interface SliceOk {
	ok: true;
	/** Pre-rendered `## DB Input Slices` block body (markdown). */
	block: string;
	/** Kinds rendered, in STAGE_SLICE_KINDS order. */
	kinds: readonly ArtifactKind[];
}

export type StageSlice = SliceOk | SliceRefusal;

// ---------------------------------------------------------------------------
// Compact slice tables (decision 9 — Phase 5 renderer conventions, subset
// of columns per stage need). Local helpers: export-doc.ts's `table()` is
// module-private and its full-column renderers serve the Doc/ VIEWS; slices
// project only the columns stages/scouts consume.
// ---------------------------------------------------------------------------

type RowLike = Record<string, unknown>;

function cell(value: unknown): string {
	if (value === null || value === undefined || value === "") return "—";
	return String(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function table(title: string, headers: string[], rows: unknown[][]): string {
	const lines = [`#### ${title}`, "", `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
	for (const row of rows) {
		lines.push(`| ${row.map(cell).join(" | ")} |`);
	}
	return lines.join("\n") + "\n";
}

function rowsOf(rows: Record<string, unknown>, key: string): RowLike[] {
	const value = rows[key];
	return Array.isArray(value) ? (value as RowLike[]) : [];
}

function sortedBy(rows: RowLike[], key: string, numeric = false): RowLike[] {
	return [...rows].sort((a, b) => {
		const av = a[key];
		const bv = b[key];
		if (numeric) return Number(av) - Number(bv);
		return String(av ?? "").localeCompare(String(bv ?? ""));
	});
}

/**
 * Render one kind's slice from its published rows — compact per-kind
 * template, deterministic order (natural-key sorts, G5).
 */
export function renderStageSlice(kind: ArtifactKind, rows: Record<string, unknown>): string {
	switch (kind) {
		case "prd": {
			const fr = sortedBy(rowsOf(rows, "fr"), "id");
			const nfr = sortedBy(rowsOf(rows, "nfr"), "id");
			const sections = sortedBy(rowsOf(rows, "prdSection"), "no", true);
			return (
				table(
					"FR",
					["ID", "Phase", "Requirement"],
					fr.map((r) => [r.id, r.phase, r.text]),
				) +
				table(
					"NFR",
					["ID", "Phase", "Requirement"],
					nfr.map((r) => [r.id, r.phase, r.text]),
				) +
				table(
					"PRD Sections",
					["No", "Title", "Body"],
					sections.map((r) => [r.no, r.title, r.body]),
				)
			);
		}
		case "rtm": {
			const list = sortedBy(rowsOf(rows, "rtmRow"), "id");
			return table(
				"Traceability Rows",
				["ID", "FR", "AF", "TC", "Phase"],
				list.map((r) => [r.id, r.frRef, r.afRef, r.tcRef, r.phase]),
			);
		}
		case "feasibility": {
			const decision = rows.feasibilityDecision as RowLike | undefined;
			const decisionRows = decision
				? [
						[
							decision.verdict,
							decision.language,
							decision.decidedBy,
							decision.at,
							decision.webSearchConsent === 1 ? "yes" : decision.webSearchConsent === 0 ? "no" : "—",
						],
					]
				: [];
			const spikes = sortedBy(rowsOf(rows, "feasibilitySpike"), "language");
			const scan = sortedBy(rowsOf(rows, "reuseScan"), "candidate");
			return (
				table("Decision", ["Verdict", "Language", "Decided By", "At", "Web Consent"], decisionRows) +
				table(
					"Spikes",
					["Language", "Passed", "Result Ref"],
					spikes.map((r) => [r.language, r.passed === 1 ? "yes" : "no", r.resultRef]),
				) +
				table(
					"Reuse Scan",
					["Candidate", "License", "Freshness", "Verdict"],
					scan.map((r) => [r.candidate, r.license, r.repoFreshness, r.verdict]),
				)
			);
		}
		case "design": {
			const modules = sortedBy(rowsOf(rows, "designModule"), "id");
			const sourceFr = sortedBy(rowsOf(rows, "moduleSourceFr"), "moduleId").sort((a, b) =>
				String(a.frId ?? "").localeCompare(String(b.frId ?? "")),
			);
			const adr = sortedBy(rowsOf(rows, "adr"), "id");
			const approaches = sortedBy(rowsOf(rows, "approach"), "moduleId").sort((a, b) =>
				String(a.tacticId ?? "").localeCompare(String(b.tacticId ?? "")),
			);
			const diagrams = sortedBy(rowsOf(rows, "diagram"), "id");
			let diagramBlocks = "";
			for (const d of diagrams) {
				diagramBlocks += `#### Diagram ${cell(d.id)} (${cell(d.diagramKind)})\n\n\`\`\`mermaid\n${String(d.mermaidText ?? "")}\n\`\`\`\n\n`;
			}
			return (
				table(
					"Modules",
					["ID", "Name", "Description"],
					modules.map((r) => [r.id, r.name, r.description]),
				) +
				table(
					"Module Source FRs",
					["Module", "FR"],
					sourceFr.map((r) => [r.moduleId, r.frId]),
				) +
				table(
					"ADRs",
					["ID", "Status", "Options", "Chosen"],
					adr.map((r) => [r.id, r.adrStatus, r.options, r.chosen]),
				) +
				diagramBlocks +
				table(
					"Approaches",
					["Module", "Tactic"],
					approaches.map((r) => [r.moduleId, r.tacticId]),
				)
			);
		}
		case "atomic-functions": {
			const list = sortedBy(rowsOf(rows, "atomicFunction"), "id");
			return table(
				"Atomic Functions",
				["ID", "Name", "Signature", "Tier", "Criticality", "SIL", "Leaf", "Purpose", "Source"],
				list.map((r) => [
					r.id,
					r.name,
					r.signature,
					r.tier,
					r.criticality,
					r.sil,
					r.isLeaf === 1 ? "yes" : "no",
					r.purpose,
					r.source,
				]),
			);
		}
		case "pseudocode": {
			const list = sortedBy(rowsOf(rows, "pseudocodeBlock"), "id");
			return table(
				"Pseudocode Blocks",
				["ID", "AF", "Content"],
				list.map((r) => [r.id, r.afRef, r.content]),
			);
		}
		case "testplan": {
			const cases = sortedBy(rowsOf(rows, "testCase"), "id");
			const traces = rowsOf(rows, "tcTrace").sort((a, b) =>
				`${a.tcId} ${a.targetKind} ${a.targetId}`.localeCompare(`${b.tcId} ${b.targetKind} ${b.targetId}`),
			);
			return (
				table(
					"Test Cases",
					["ID", "Kind", "Strategy", "Objective", "Steps", "Expected"],
					cases.map((r) => [r.id, r.tcKind, r.strategyRef, r.objective, r.steps, r.expected]),
				) +
				table(
					"Traces",
					["TC", "Target Kind", "Target ID"],
					traces.map((r) => [r.tcId, r.targetKind, r.targetId]),
				)
			);
		}
		case "development-order": {
			const steps = sortedBy(rowsOf(rows, "devStep"), "id");
			const afs = rowsOf(rows, "stepAf").sort((a, b) => `${a.stepId} ${a.afId}`.localeCompare(`${b.stepId} ${b.afId}`));
			const deps = rowsOf(rows, "stepDep").sort((a, b) =>
				`${a.stepId} ${a.dependsOnId}`.localeCompare(`${b.stepId} ${b.dependsOnId}`),
			);
			return (
				table(
					"Development Steps",
					["ID", "Module", "Description"],
					steps.map((r) => [r.id, r.module, r.description]),
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
				)
			);
		}
		case "final-design": {
			const list = sortedBy(rowsOf(rows, "finalSection"), "no", true);
			return table(
				"Final Sections",
				["No", "Title", "Source Artifact", "Source IDs"],
				list.map((r) => [r.no, r.title, r.sourceArtifact, r.sourceIds]),
			);
		}
	}
}

/**
 * Check the REQUIRED-prose row-sets (v002). Returns the first failing
 * description, or null when prose is present (or the row-set is absent).
 */
export function findMissingProse(kind: ArtifactKind, rows: Record<string, unknown>): string | null {
	for (const spec of REQUIRED_PROSE[kind] ?? []) {
		const list = rowsOf(rows, spec.rowSet);
		if (list.length === 0) continue;
		if (list.every((r) => r[spec.field] === null || r[spec.field] === undefined || r[spec.field] === "")) {
			return `${spec.rowSet}.${spec.field} empty on all ${list.length} row(s)`;
		}
	}
	return null;
}

/**
 * Resolve the DB input slice for one stage (decision 3 — the single
 * deterministic slice entry point for registry + prompt).
 *
 * Refusal reasons (all LOUD, never a silent file fallback):
 *   1. no-store-db        — `Doc/store/<project>/index.db` does not exist
 *   2. kind-unpublished   — store exists but a spec'd kind has no published rows
 *   3. rows-lack-prose    — published rows are legacy v001 (prose columns null)
 *
 * @param cwd - Project root.
 * @param projectName - Project whose store to read.
 * @param stageKey - Registry stage key (slice spec lookup).
 */
export function resolveStageSlice(cwd: string, projectName: string, stageKey: StageKey): StageSlice {
	const kinds = STAGE_SLICE_KINDS[stageKey] ?? [];
	if (kinds.length === 0) {
		// prd — brainstorm notes are the sole (file) input; no DB slice.
		return { ok: true, block: "", kinds: [] };
	}
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) {
		return {
			ok: false,
			reason: "no-store-db",
			message:
				`Cannot run /velpari-${stageKey}: no store DB at ${dbPath}. ` +
				`DB-primary reads require the project store — publish a stage first, ` +
				`or import legacy Doc/ artifacts with /velpari-backfill <kind>.`,
		};
	}
	const sections: string[] = [];
	for (const kind of kinds) {
		const read = readLatestPublishedRows(cwd, projectName, kind);
		if (!read) {
			return {
				ok: false,
				reason: "kind-unpublished",
				kind,
				message:
					`Cannot run /velpari-${stageKey}: store DB has no published '${kind}' rows ` +
					`for ${projectName}. Run the stage's publish first, or import the legacy ` +
					`Doc/ artifact with /velpari-backfill ${kind}.`,
			};
		}
		const proseFail = findMissingProse(kind, read.rows);
		if (proseFail) {
			return {
				ok: false,
				reason: "rows-lack-prose",
				kind,
				message:
					`Cannot run /velpari-${stageKey}: published '${kind}' rows lack v002 prose ` +
					`(${proseFail}) — legacy v001 store. Re-publish the stage, or re-import with ` +
					`/velpari-backfill ${kind}.`,
			};
		}
		sections.push(
			`### ${kind} (run ${read.envelope.runId} v${read.envelope.version})\n\n${renderStageSlice(kind, read.rows)}`,
		);
	}
	return { ok: true, block: sections.join("\n---\n\n"), kinds };
}

// ---------------------------------------------------------------------------
// Scout slice instructions (decision 6): per-scout ROLE → row-set reference
// lines. Rendered into the prompt's `## Scout Slices` block by prompt.ts
// (pre-rendered here because prompt.ts is L0 and cannot import L1).
// The reviewer role is the sole slice+view exception (decision 1).
// ---------------------------------------------------------------------------

export const SCOUT_SLICE_LINES: Record<StageKey, readonly string[]> = {
	prd: [],
	rtm: [
		"rtm-requirement-tracer: FR + NFR rows and PRD-section rows from the DB Input Slices block",
		"rtm-test-case-linker: FR + NFR rows from the DB Input Slices block",
		"rtm-coverage-analyzer: the full prd slice (FR, NFR, PRD Sections)",
		"rtm-consolidator: all four scouts' reports plus the prd slice",
	],
	feasibility: [
		"feasibility-tech: the rtm slice (traceability rows) — core-function candidates live in FR rows",
		"feasibility-schedule: the rtm slice — scope size from row counts and phases",
		"feasibility-cost: the rtm slice — scope size from row counts and phases",
		"feasibility-risk: the rtm slice — cross-cutting concerns from FR/NFR coverage",
	],
	"architecture-generator": [
		"design-style-selector: the feasibility slice (Decision + Spikes + Reuse Scan)",
		"design-module-decomposer: the rtm slice (Traceability Rows) + the feasibility slice",
		"design-contract-definer: the rtm slice (Traceability Rows)",
		"design-data-flow-mapper: the rtm slice (Traceability Rows)",
		"design-error-definer: the rtm slice (Traceability Rows)",
		"design-reviewer: the feasibility slice AND the published Doc/ view — a mismatch is a finding",
	],
	"atomic-function": [
		"af-source-prd: the prd slice (FR, NFR rows with prose)",
		"af-source-rtm: the rtm slice (Traceability Rows)",
		"af-source-design: the design slice (Modules, Module Source FRs, ADRs)",
		"af-source-feas: the feasibility slice (Decision, Spikes, Reuse Scan)",
		"reviewer: the DB slice AND the published Doc/ view — a mismatch is a finding",
	],
	pseudocode: [
		"pseudo-algorithm-extractor: the design slice (Modules, ADRs) + the atomic-functions slice",
		"pseudo-edge-case-handler: the atomic-functions slice (signatures, purpose) + the design slice",
		"pseudo-complexity-analyzer: the atomic-functions slice + the design slice",
		"pseudo-consolidator: the full design + atomic-functions slices and all scout reports",
		"pseudocode-reviewer: the design + atomic-functions slices AND the published Doc/ views — a mismatch is a finding",
	],
	testplan: [
		"testplan-strategy-designer: the pseudocode slice (blocks with content) + the atomic-functions slice",
		"testplan-unit-test-generator: the pseudocode slice + the atomic-functions slice",
		"testplan-integration-test-generator: the pseudocode slice (AF wiring) + the atomic-functions slice",
		"testplan-coverage-tracer: the atomic-functions slice (AF ids for Traces)",
		"testplan-reviewer: the pseudocode + atomic-functions slices AND the published Doc/ views — a mismatch is a finding",
	],
	"development-order": [
		"do-topology: the design slice (Modules) + the atomic-functions slice (AF ids per module)",
		"do-risk: the design slice (Modules, Approaches) + the development-order-relevant slices",
		"do-test: the testplan slice (Test Cases + Traces) — step ordering must respect verified AFs",
		"do-value: the design slice (Modules, Module Source FRs) + the prd slice (FR phases)",
	],
	"final-design": [
		"design-consistency-checker: the design slice + the atomic-functions slice",
		"design-coverage-checker: the atomic-functions slice + the testplan slice (Traces)",
		"design-contract-checker: the design slice (Modules, ADRs) + the pseudocode slice",
		"design-finalizer: all five slices (design, atomic-functions, pseudocode, testplan, development-order)",
	],
};
