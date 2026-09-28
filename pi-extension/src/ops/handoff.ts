/**
 * /velpari-handoff handler (Phase 7 update).
 *
 * Flow:
 * 1. Verify state is at `planned-tests` or `ordered-development`
 * 2. Read projectName from .pi/velpari/files.json
 * 3. Scan 7 required Doc/ artifacts + 2 optional ones (FR-34).
 *    Each artifact is resolved with grouped layout first and legacy
 *    flat layout fallback.
 * 3a. MVP coverage gate: Phase-1 requirements with no RTM row or
 *    coverage "missing" block the handoff; partial/no-tests warn.
 * 3b. Staleness gate (A6): any input-changed/input-missing artifact in
 *    the freshness stale set blocks; no-stamp legacy artifacts warn (D8).
 * 3c. ID-coverage gate (A4): a machine-checkable downstream doc missing
 *    upstream ids blocks; not-checkable docs + duplicates warn (D7/D1/D2).
 * 4. Build architect-inputs.json with versioned schema
 * 5. Validate against our schema mirror of chirpi's expected shape
 *    (schema owned by @adi-mudi/pi-chirpi, architect/inputs-config.ts)
 * 6. Preview gate (FR-23)
 * 7. Write to .pi/senai/architect-inputs.json
 * 8. Transition state to handoff-ready
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { atomicWriteJson } from "../io/atomic-write.js";
import { readLatestPublishedRows } from "../io/store.js";
import { renderDesignMarkdown } from "./export-doc.js";
import { advanceStage, type RunState } from "../core/state.js";
import { closeRunBinding } from "../core/run-binding.js";
import { buildGroupedPath, buildOutputPath, buildWorkingGroupedPath, resolveDocArtifact } from "../core/paths.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { checkMvpCoverage } from "../core/mvp-coverage.js";
import { computeStaleSet } from "../core/freshness.js";
import { freezeAllForHandoff } from "./freeze.js";
// PHASE-D import (N29) — store-backed per-document version metadata.
import { collectDocumentMeta, refreshFrozenMeta, type DocumentMetaMap } from "./handoff-meta.js";
import { checkIdCoverage } from "../core/id-coverage.js";
import { parseADRSection, type ADR } from "../core/adr.js";
import { loadPublishedLoggingPlanMarkdown } from "../core/logging-plan.js";
import { getEffectiveProjectNames } from "../core/projectnames.js";
import { parseFrontmatterBlock } from "../core/frontmatter.js";
import {
	LANE_LOCK_RULES,
	LANE_MERGE_GATES,
	LANE_STATUSES,
	laneViewFromRows,
	type LaneDepInput,
	type LaneProposal,
	type LaneStatus,
	type LaneStepInput,
} from "../core/dev-lanes.js";

export type DocumentType =
	| "PRD"
	| "RTM"
	| "Feasibility Study"
	| "Design"
	| "Atomic Functions"
	| "Pseudocode"
	| "Test Plan"
	| "Test Cases"
	| "Development Order"
	| "Final Design"
	// PHASE-D (N26/N29) — optional 11th entry, appended only when a
	// wireframe exists (full-app projects; presence-driven, decision 7).
	| "Wireframe";

export interface ArchitectDocument {
	type: DocumentType;
	path: string;
	// ─── PHASE-D (N29) — store-backed version metadata (additive; absent
	// on legacy payloads written before N29, always emitted since). ───
	/** Store envelope version (`artifacts.version`); null when no store row. */
	version?: number | null;
	/** Head `artifact_revisions.revision_id` handed to Senai; null when none. */
	revisionId?: number | null;
	/** Monotonic revision number of that head; null when there is none. */
	revisionNumber?: number | null;
	/** Frozen at handoff (N4); false when the kind has no store row. */
	frozen?: boolean;
	/** Freeze reason (N4) — `"handoff (N4)"` in the written payload. */
	freezeReason?: string | null;
	// ─── PHASE-D END ───
}

/**
 * v1.4.0 — observability block in the handoff payload. Senai treats
 * the whole block as advisory (chirpi ignores unknown fields), but
 * Senai's `implement` stage reads `observability.loggingPlan[*]` and
 * uses the path + version to wire up the logger per the design.
 */
interface ObservabilityLoggingPlan {
	path: string;
	version: string;
	status: "draft" | "approved" | "deprecated";
	generatedAt: string;
	overlay?: string;
}

export interface ObservabilitySection {
	/** Per-projectName logging plan entries (v1.4.0). v1.3.0+ multi-design
	 *  is supported: a federation of services has one entry per design. */
	loggingPlan: ObservabilityLoggingPlan[];
}

export interface ArchitectInputs {
	version: 1;
	projectName: string;
	createdAt: string;
	mission: string;
	documents: ArchitectDocument[];
	/** Phase 4 — every ADR captured in the design doc (Phase 4). Empty array is fine. */
	architectureDecisions: Array<{
		id: string;
		title: string;
		status: string;
		stage: string;
		decision: string;
	}>;
	/** Phase 3 — active standards overlay (or null for implicit "none"). */
	standardsProfile: {
		id: string;
		version: string;
	} | null;
	/**
	 * v1.4.0 — observability block. Populated when at least one project
	 * has a published logging plan at Doc/observability/logging-plan_<project>.md.
	 * Multi-design: one loggingPlan entry per projectName. Senai reads this
	 * during the `implement` stage and wires up the logger per the plan.
	 */
	observability?: ObservabilitySection;
	/**
	 * Phase 7 (N16) — execution lanes. Present only when the published
	 * development-order carries lane rows, so Senai runs one build line
	 * per lane without re-planning. Legacy payloads omit the key.
	 */
	lanes?: ArchitectLanesSection;
}

/** One lane as handed to Senai (the name-match pair is enforced). */
export interface ArchitectLaneEntry {
	laneId: string;
	steps: string[];
	worktree: string;
	branch: string;
	status: LaneStatus;
}

/** One integration-plan entry (merge order + the gates each merge needs). */
export interface ArchitectIntegrationEntry {
	order: number;
	laneId: string;
	mergeLevel: number;
	gates: string[];
	preMerge: string;
}

/** The `lanes` block of `architect-inputs.json` (Phase 7 / N16). */
export interface ArchitectLanesSection {
	shape: Array<"parallel" | "series">;
	lanes: ArchitectLaneEntry[];
	integrationPlan: ArchitectIntegrationEntry[];
	lockRules: string[];
}

/** Result of `buildLanesSection`: no section is silent; a problem warns. */
export interface LanesSectionResult {
	section: ArchitectLanesSection | null;
	/** Set when lane rows exist but could not form a valid section. */
	problem: string | null;
}

/** The pre-merge advice every integration entry carries. */
const LANE_PRE_MERGE = "parked → rebuild + tests + doctor vs integration branch";

const LANES_NONE: LanesSectionResult = { section: null, problem: null };

const REQUIRED_TYPES: ReadonlyArray<{ type: DocumentType; artifact: string }> = [
	{ type: "PRD", artifact: "PRD" },
	{ type: "RTM", artifact: "RTM" },
	{ type: "Feasibility Study", artifact: "feasibility-study" },
	{ type: "Design", artifact: "design" },
	{ type: "Atomic Functions", artifact: "atomic-functions" },
	{ type: "Pseudocode", artifact: "pseudocode" },
	{ type: "Test Plan", artifact: "test-plan" },
	{ type: "Test Cases", artifact: "test-cases" },
	{ type: "Development Order", artifact: "development-order" },
	{ type: "Final Design", artifact: "final-design" },
];

// (No optional-documents list: OPTIONAL_TYPES was `[]` — the loop in
// readApprovedArtifacts could never run — and was removed in Phase I9.
// The grouped→legacy fallback lives in resolveDocArtifact.)

/**
 * Read all approved Doc/ artifacts. Returns the documents array.
 * Required artifacts that are missing throw an error listing them.
 * Each artifact path prefers the grouped layout and falls back to the
 * legacy flat layout (Phase 7 backwards compatibility).
 */
export function readApprovedArtifacts(projectName: string, cwd: string = process.cwd()): ArchitectDocument[] {
	const docs: ArchitectDocument[] = [];
	const missing: string[] = [];

	for (const { type, artifact } of REQUIRED_TYPES) {
		const resolved = resolveDocArtifact(artifact, projectName, cwd);
		if (resolved) {
			// Persist the actual on-disk path (absolute) so downstream
			// tooling can read it without re-deriving the layout.
			docs.push({ type, path: resolved.path });
		} else {
			missing.push(
				`${join(cwd, buildGroupedPath(artifact, projectName))} (or legacy: ${join(cwd, buildOutputPath(artifact, projectName))})`,
			);
		}
	}

	if (missing.length > 0) {
		throw new Error(`Missing required Doc/ artifacts:\n${missing.map((p) => `  - ${p}`).join("\n")}`);
	}

	return docs;
}

// ─── PHASE-D (N26/N29) — wireframe entry + version metadata ─────────────────

/**
 * Artifact key behind a document type: REQUIRED_TYPES for the 10 required
 * documents, `wireframe` for the optional Wireframe entry.
 * @param {DocumentType} type - The document type in the payload.
 * @returns {string} The paths/upstream map key for the artifact.
 */
function artifactKeyForDocumentType(type: DocumentType): string {
	const found = REQUIRED_TYPES.find((r) => r.type === type);
	return found ? found.artifact : "wireframe";
}

/**
 * Append the optional Wireframe document (N26/N29, presence-driven):
 * published copy first (`Doc/design/wireframe_<project>.md`), then the
 * run's durable working copy as the DB-only fallback; still absent →
 * nothing appended (backend and legacy projects keep exactly 10 docs).
 * @param {ArchitectDocument[]} docs - Documents array (mutated in place).
 * @param {string} projectName - Project whose wireframe to resolve.
 * @param {string} cwd - Project root.
 * @param {string} [runId] - Current run id (working-copy fallback).
 */
export function appendWireframeDocument(
	docs: ArchitectDocument[],
	projectName: string,
	cwd: string,
	runId?: string,
): void {
	const resolved = resolveDocArtifact("wireframe", projectName, cwd);
	if (resolved) {
		docs.push({ type: "Wireframe", path: resolved.path });
		return;
	}
	if (!runId) return;
	const working = buildWorkingGroupedPath(cwd, runId, "wireframe", projectName);
	if (existsSync(working)) {
		docs.push({ type: "Wireframe", path: working });
	}
}

/**
 * Copy collected store metadata onto the documents array (in place) —
 * called once while building the payload and again after the N4 freeze
 * + `refreshFrozenMeta`, so the written payload states post-freeze truth.
 * @param {ArchitectDocument[]} documents - Payload documents (mutated).
 * @param {DocumentMetaMap} meta - Metadata keyed by artifact key.
 */
function applyDocumentMeta(documents: ArchitectDocument[], meta: DocumentMetaMap): void {
	for (const doc of documents) {
		const entry = meta.get(artifactKeyForDocumentType(doc.type));
		if (!entry) continue;
		doc.version = entry.version;
		doc.revisionId = entry.revisionId;
		doc.revisionNumber = entry.revisionNumber;
		doc.frozen = entry.frozen;
		doc.freezeReason = entry.freezeReason;
	}
}
// ─── PHASE-D END ───

/**
 * Validate the architect-inputs JSON against our schema mirror.
 * Returns true if valid; throws on failure.
 */
export function validateSenaiSchema(json: unknown): boolean {
	if (typeof json !== "object" || json === null) {
		throw new Error("Schema root must be an object");
	}
	const obj = json as Partial<ArchitectInputs>;
	if (obj.version !== 1) {
		throw new Error(`Schema version must be 1, got ${obj.version}`);
	}
	if (typeof obj.projectName !== "string" || obj.projectName === "") {
		throw new Error("projectName must be a non-empty string");
	}
	if (typeof obj.createdAt !== "string") {
		throw new Error("createdAt must be a string");
	}
	if (typeof obj.mission !== "string") {
		throw new Error("mission must be a string");
	}
	if (!Array.isArray(obj.documents)) {
		throw new Error("documents must be an array");
	}
	for (const [i, doc] of obj.documents.entries()) {
		if (typeof doc.type !== "string") {
			throw new Error(`documents[${i}].type must be a string`);
		}
		if (typeof doc.path !== "string" || doc.path === "") {
			throw new Error(`documents[${i}].path must be a non-empty string`);
		}
		// ─── PHASE-D (N29) — additive metadata type checks. Absent keys
		// (legacy payloads) and explicit nulls pass; a present, non-null
		// value must have the declared type. ───
		if (doc.version !== undefined && doc.version !== null && typeof doc.version !== "number") {
			throw new Error(`documents[${i}].version must be a number or null`);
		}
		if (doc.revisionId !== undefined && doc.revisionId !== null && typeof doc.revisionId !== "number") {
			throw new Error(`documents[${i}].revisionId must be a number or null`);
		}
		if (doc.revisionNumber !== undefined && doc.revisionNumber !== null && typeof doc.revisionNumber !== "number") {
			throw new Error(`documents[${i}].revisionNumber must be a number or null`);
		}
		if (doc.frozen !== undefined && typeof doc.frozen !== "boolean") {
			throw new Error(`documents[${i}].frozen must be a boolean`);
		}
		if (doc.freezeReason !== undefined && doc.freezeReason !== null && typeof doc.freezeReason !== "string") {
			throw new Error(`documents[${i}].freezeReason must be a string or null`);
		}
		// ─── PHASE-D END ───
	}
	return true;
}

/**
 * Main handoff handler. Implements the UI flow described in the plan.
 */
export async function runHandoff(
	state: RunState,
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	if (state.currentStage === "none") {
		ctx.ui.notify("No active run. Run /velpari-brainstorm first.", "error");
		return;
	}
	if (state.currentStage !== "finalized-design") {
		ctx.ui.notify(
			`Cannot handoff at stage "${state.currentStage}". ` +
				`Expected "finalized-design" (Stage 10 must be approved first).`,
			"error",
		);
		return;
	}

	const config = loadFilesConfig(cwd);
	if (!validateFilesConfig(config)) {
		ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
		return;
	}
	const projectName = config.projectName;

	let documents: ArchitectDocument[];
	try {
		documents = readApprovedArtifacts(projectName, cwd);
	} catch (err) {
		ctx.ui.notify((err as Error).message, "error");
		return;
	}
	// PHASE-D (N26/N29) — append the optional Wireframe document when one
	// exists (published copy, else the run's durable working copy).
	appendWireframeDocument(documents, projectName, cwd, state.runId);

	// MVP coverage gate (MVP/phase traceability, Phase 4): handoff is the
	// "MVP is ready" signal — a Phase-1 requirement with no RTM row or
	// coverage "missing" blocks; partial coverage / missing test links warn.
	const mvp = checkMvpCoverage(cwd, projectName);
	if (mvp) {
		const blocking = mvp.issues.filter((i) => i.severity === "error");
		if (blocking.length > 0) {
			ctx.ui.notify(
				`Handoff blocked — MVP coverage ${mvp.covered}/${mvp.total}:\n` +
					blocking.map((i) => `  - ${i.message}`).join("\n") +
					`\nFix via /velpari-rtm (update mode) + /velpari-prd-approve.`,
				"error",
			);
			return;
		}
		if (mvp.issues.length > 0) {
			ctx.ui.notify(
				`MVP coverage ${mvp.covered}/${mvp.total} — warnings:\n` + mvp.issues.map((i) => `  - ${i.message}`).join("\n"),
				"warning",
			);
		}
	}

	// Staleness gate (A6): handoff refuses while anything in the chain is
	// stale — blocking BEFORE the payload is built guarantees the package
	// reflects a consistent chain. input-changed / input-missing block;
	// no-stamp (legacy unstamped artifact) warns only (D8).
	const stale = computeStaleSet(cwd);
	const staleBlocking = stale.filter((s) => s.reason !== "no-stamp");
	if (staleBlocking.length > 0) {
		ctx.ui.notify(
			`Handoff blocked — ${staleBlocking.length} stale artifact(s):\n` +
				staleBlocking
					.map((s) =>
						s.reason === "input-changed"
							? `  - ${s.key} (${s.reason}: ${s.changedInputs.join(", ")}) — republish, or /velpari-reconfirm if the change has no impact on this artifact.`
							: `  - ${s.key} (${s.reason}: ${s.changedInputs.join(", ")}) — republish required.`,
					)
					.join("\n") +
				`\nRepublish the listed stages (stage command in update mode + the matching /velpari-<stage>-approve), or /velpari-reconfirm the input-changed ones.`,
			"error",
		);
		return;
	}
	const unstamped = stale.filter((s) => s.reason === "no-stamp");
	if (unstamped.length > 0) {
		ctx.ui.notify(
			`Freshness warnings (handoff allowed):\n` +
				unstamped.map((s) => `  - ${s.key}: no freshness stamp — republish to stamp.`).join("\n"),
			"warning",
		);
	}

	// ID-coverage gate (A4 + A6): a machine-checkable downstream doc missing
	// upstream ids blocks (D7); not-checkable legacy docs and dev-order
	// duplicates warn (D1/D2).
	const coverage = checkIdCoverage(cwd);
	const coverageBlocking = coverage.results.filter((r) => r.status === "missing");
	if (coverageBlocking.length > 0) {
		ctx.ui.notify(
			`Handoff blocked — ID coverage gaps:\n` +
				coverageBlocking
					.map(
						(r) => `  - ${r.rule.id} (${r.rule.downstream}, ${r.projectName}): ` + `missing ${r.missingIds.join(", ")}`,
					)
					.join("\n") +
				`\nRevise the listed downstream stages to cover the missing ids, then republish.`,
			"error",
		);
		return;
	}
	const coverageWarnings = coverage.results.filter((r) => r.status === "not-checkable" || r.duplicateIds.length > 0);
	if (coverageWarnings.length > 0) {
		const lines: string[] = [];
		for (const r of coverageWarnings) {
			if (r.status === "not-checkable") {
				lines.push(
					`  - ${r.rule.id} (${r.rule.downstream}, ${r.projectName}): not machine-checkable — regenerate the stage to gain ID traceability.`,
				);
			}
			if (r.duplicateIds.length > 0) {
				lines.push(
					`  - ${r.rule.id} (${r.rule.downstream}, ${r.projectName}): duplicate ids ${r.duplicateIds.join(", ")}.`,
				);
			}
		}
		ctx.ui.notify(`ID coverage warnings (handoff allowed):\n${lines.join("\n")}`, "warning");
	}

	// ─── PHASE-D (N29) — collect store-backed version metadata once and
	// fill the documents (refreshed again after the freeze below). ───
	const docKeys = documents.map((d) => artifactKeyForDocumentType(d.type));
	const docMeta = collectDocumentMeta(projectName, state.runId ?? "", cwd, docKeys);
	applyDocumentMeta(documents, docMeta);
	// ─── PHASE-D END ───

	const inputs: ArchitectInputs = {
		version: 1,
		projectName,
		createdAt: new Date().toISOString(),
		mission: state.mission,
		documents,
		// Phase 4: surface every captured ADR so Senai can honor decisions
		// instead of re-deciding them. Empty array is fine when the design
		// doc has no ADR section.
		architectureDecisions: collectADRDecisions(state, projectName, cwd),
		// Phase 3: include the standards overlay so Senai knows which
		// compliance sections to enforce during implement.
		standardsProfile: state.standardsProfile ?? null,
	};

	// v1.4.0 — observability block. One loggingPlan entry per projectName
	// in the federation (single-design cwd has length 1). Skipped when
	// no published logging plan exists for any project.
	const observability = buildObservabilitySection(state, projectName, cwd);
	if (observability && observability.loggingPlan.length > 0) {
		inputs.observability = observability;
	}

	// Phase 7 (N16) — execution lanes. Key omitted when the published
	// dev-order carries no lane rows (legacy payloads stay byte-identical);
	// a malformed store/markdown section warns and omits — handoff never
	// hard-fails on something the doctor already reports.
	const lanesResult = buildLanesSection(state, projectName, cwd);
	if (lanesResult.problem) {
		ctx.ui.notify(`Execution lanes omitted from the handoff payload: ${lanesResult.problem}`, "warning");
	}
	if (lanesResult.section) {
		inputs.lanes = lanesResult.section;
	}

	try {
		validateSenaiSchema(inputs);
	} catch (err) {
		ctx.ui.notify(`Schema validation failed: ${(err as Error).message}`, "error");
		return;
	}

	const targetPath = join(cwd, ".pi", "senai", "architect-inputs.json");
	const confirmed = await ctx.ui.confirm(
		"Publish handoff?",
		`Write ${documents.length} document references to ${targetPath}?`,
	);
	if (!confirmed) {
		ctx.ui.notify("Handoff cancelled.", "info");
		return;
	}

	// N4 — freeze the chain at handoff: every kind of this run with a
	// published head becomes frozen (blocks even supersession until an
	// audited unfreeze). MULTI-DESIGN: every project store is covered.
	// PHASE-D (N29 / decision 6): the freeze runs BEFORE the payload write
	// so the written documents[] carry post-freeze truth (`frozen: true`,
	// `freezeReason: "handoff (N4)"`). Recoverability: a failed freeze
	// leaves the chain unfrozen AND the payload unwritten — the user fixes
	// the store and re-runs /velpari-handoff (the freeze is idempotent); a
	// failed payload write leaves the frozen chain and no payload — the
	// re-run no-ops the freeze and writes the payload.
	const freeze = freezeAllForHandoff(cwd, projectName, state.runId!);
	if (!freeze.ok) {
		ctx.ui.notify(
			`Handoff freeze failed — stage does NOT advance (N4):\n` + freeze.problems.map((p) => `  - ${p}`).join("\n"),
			"error",
		);
		return;
	}
	ctx.ui.notify(`Handoff freeze: ${freeze.frozen} artifact kind(s) frozen (N4).`, "info");

	// PHASE-D (N29): re-read the just-frozen store, refill the documents,
	// THEN write — the payload only ever states what the store holds.
	refreshFrozenMeta(projectName, state.runId ?? "", cwd, docMeta);
	applyDocumentMeta(documents, docMeta);

	atomicWriteJson(targetPath, inputs);
	ctx.ui.notify(`Handoff written to ${targetPath}`, "info");

	const next = advanceStage(state, "/velpari-handoff", cwd);
	void next;

	// N5: the run line is finished — close its worktree binding so the next run
	// may start in this folder. Best effort; a close failure never blocks handoff.
	closeRunBinding(cwd, state.runId!, "handoff");
}

// ─── Phase 4 ADR export ─────────────────────────────────────────────────────

interface AdrSummary {
	id: string;
	title: string;
	status: string;
	stage: string;
	decision: string;
}

// ─── v1.4.0 Observability block ──────────────────────────────────────────────

/**
 * Read the YAML frontmatter of a logging plan and pull the
 * observability-relevant fields. Best-effort: returns a partial
 * payload when the frontmatter is missing a field.
 */
function readLoggingPlanFrontmatter(content: string): {
	version: string;
	status: "draft" | "approved" | "deprecated";
	generatedAt: string;
	overlay?: string;
} {
	const match = content.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) {
		return { version: "0.0.0", status: "draft", generatedAt: new Date().toISOString() };
	}
	const block = match[1]!;
	const kv: Record<string, string> = {};
	for (const line of block.split("\n")) {
		const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
		if (m) {
			kv[m[1]!] = m[2]!.trim();
		}
	}
	const statusRaw = kv.status;
	const status: "draft" | "approved" | "deprecated" =
		statusRaw === "approved" || statusRaw === "deprecated" ? statusRaw : "draft";
	const out = {
		version: kv.version || "0.0.0",
		status,
		generatedAt: kv.created || new Date().toISOString(),
	};
	if (kv.overlay) {
		return { ...out, overlay: kv.overlay };
	}
	return out;
}

/**
 * Build the observability block for the handoff payload. Walks every
 * effective projectName (v1.3.0+ multi-design supported) and emits
 * one loggingPlan entry per project that has a published plan.
 * Returns null when no project has a published plan.
 */
export function buildObservabilitySection(
	_state: RunState,
	primaryProjectName: string,
	cwd: string,
): { loggingPlan: ObservabilityLoggingPlan[] } | null {
	const config = loadFilesConfig(cwd);
	if (!validateFilesConfig(config)) return null;

	let projectNames: string[];
	try {
		projectNames = getEffectiveProjectNames(config);
	} catch {
		// Fallback: single projectName path (legacy / pre-v1.3.0)
		projectNames = [primaryProjectName];
	}

	const entries: ObservabilityLoggingPlan[] = [];
	for (const pn of projectNames) {
		const published = loadPublishedLoggingPlanMarkdown(cwd, pn);
		if (!published) continue;
		const fm = readLoggingPlanFrontmatter(published.content);
		entries.push({
			path: published.path,
			version: fm.version,
			status: fm.status,
			generatedAt: fm.generatedAt,
			...(fm.overlay ? { overlay: fm.overlay } : {}),
		});
	}

	if (entries.length === 0) return null;
	return { loggingPlan: entries };
}

// ─── Phase 7 (N16) — execution-lanes block ──────────────────────────────────

/**
 * Validate a built lane section before it may be written. Lane-shape
 * assertions live HERE (plan 7.8.1) so a malformed section can never
 * reach `architect-inputs.json`.
 * @param section - The candidate section.
 * @returns The first problem found, or null when the section is sound.
 */
function validateLanesSection(section: ArchitectLanesSection): string | null {
	if (section.lanes.length === 0) return "no lanes in the section";
	const ids = new Set<string>();
	for (const lane of section.lanes) {
		if (typeof lane.laneId !== "string" || lane.laneId === "") return "a lane has an empty laneId";
		if (ids.has(lane.laneId)) return `duplicate lane id "${lane.laneId}"`;
		ids.add(lane.laneId);
		if (lane.steps.length === 0) return `lane "${lane.laneId}" has no steps`;
		if (lane.worktree !== lane.branch) {
			return `lane "${lane.laneId}" worktree "${lane.worktree}" does not match branch "${lane.branch}" (name-match rule)`;
		}
		if (!LANE_STATUSES.includes(lane.status)) return `lane "${lane.laneId}" has invalid status "${lane.status}"`;
	}
	if (section.shape.length === 0) return "lane shape is empty";
	for (const segment of section.shape) {
		if (segment !== "parallel" && segment !== "series") return `invalid shape segment "${String(segment)}"`;
	}
	if (section.integrationPlan.length === 0) return "integration plan is empty";
	for (const entry of section.integrationPlan) {
		if (!Number.isFinite(entry.order) || !Number.isFinite(entry.mergeLevel)) {
			return `integration plan entry for "${entry.laneId}" is not numeric`;
		}
		if (!ids.has(entry.laneId)) return `integration plan names unknown lane "${entry.laneId}"`;
	}
	if (section.lockRules.length === 0) return "lock rules are empty";
	return null;
}

/** Assemble the section from a derived lane view (shared by both sources). */
function sectionFromView(view: NonNullable<ReturnType<typeof laneViewFromRows>>): ArchitectLanesSection {
	return {
		shape: [...view.shape],
		lanes: view.lanes.map((lane) => ({
			laneId: lane.laneId,
			steps: [...lane.steps],
			worktree: lane.worktree,
			branch: lane.branch,
			status: lane.status,
		})),
		integrationPlan: view.integration.map((entry) => ({
			order: entry.order,
			laneId: entry.laneId,
			mergeLevel: entry.mergeLevel,
			gates: [...LANE_MERGE_GATES],
			preMerge: LANE_PRE_MERGE,
		})),
		lockRules: [...LANE_LOCK_RULES],
	};
}

/** Build from PUBLISHED store rows (the DB-first path). */
function buildLanesFromRows(rows: Record<string, unknown>): LanesSectionResult {
	const laneRows = (rows.devLane as Array<Record<string, unknown>> | undefined) ?? [];
	if (laneRows.length === 0) return LANES_NONE;

	const proposal: LaneProposal[] = [];
	for (const row of laneRows) {
		if (
			typeof row.laneId !== "string" ||
			row.laneId === "" ||
			typeof row.stepId !== "string" ||
			row.stepId === "" ||
			typeof row.position !== "number" ||
			typeof row.worktree !== "string" ||
			typeof row.branch !== "string"
		) {
			return { section: null, problem: "store dev_lane rows are malformed (laneId/stepId/position/worktree/branch)" };
		}
		proposal.push({
			laneId: row.laneId,
			stepId: row.stepId,
			position: row.position,
			worktree: row.worktree,
			branch: row.branch,
			...(typeof row.status === "string" ? { status: row.status as LaneStatus } : {}),
		});
	}
	const stepInputs: LaneStepInput[] = ((rows.devStep as Array<Record<string, unknown>> | undefined) ?? [])
		.filter((r) => typeof r.id === "string" && r.id !== "")
		.map((r) => ({ stepId: r.id as string, ...(typeof r.module === "string" ? { module: r.module } : {}) }));
	const depInputs: LaneDepInput[] = ((rows.stepDep as Array<Record<string, unknown>> | undefined) ?? [])
		.filter((r) => typeof r.stepId === "string" && typeof r.dependsOnId === "string")
		.map((r) => ({ stepId: r.stepId as string, dependsOnStepId: r.dependsOnId as string }));

	const view = laneViewFromRows(proposal, stepInputs, depInputs);
	if (!view) return { section: null, problem: "lane rows do not form a valid graph (run /velpari-doctor)" };

	const section = sectionFromView(view);
	const problem = validateLanesSection(section);
	return problem ? { section: null, problem } : { section, problem: null };
}

/** Extract one `## <title>` section body from markdown (null when absent). */
function mdSection(body: string, title: string): string | null {
	const start = body.indexOf(`## ${title}\n`);
	if (start === -1) return null;
	const rest = body.slice(start + title.length + 3);
	const next = rest.indexOf("\n## ");
	return next === -1 ? rest : rest.slice(0, next);
}

/** Parse pipe-table rows from a section (header kept, separator dropped). */
function mdTableRows(sectionBody: string): string[][] {
	const rows: string[][] = [];
	for (const line of sectionBody.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
		const cells = trimmed
			.slice(1, -1)
			.split(" | ")
			.map((c) => c.trim());
		if (cells.length > 0 && cells.every((c) => /^-+$/.test(c))) continue;
		rows.push(cells);
	}
	return rows;
}

/**
 * File fallback — parse the lane sections of a published markdown view.
 * A doc without an Execution Lanes section is legacy ⇒ silent no-section;
 * an incomplete lane section (tables present but unusable) is a problem.
 */
function buildLanesFromFile(projectName: string, cwd: string): LanesSectionResult {
	const md = resolveDocArtifact("development-order", projectName, cwd);
	if (!md) return LANES_NONE;
	let raw: string;
	try {
		raw = readFileSync(md.path, "utf8");
	} catch {
		return LANES_NONE;
	}
	const body = parseFrontmatterBlock(raw)?.body ?? raw;

	const lanesSection = mdSection(body, "Execution Lanes");
	if (lanesSection === null) return LANES_NONE;
	const laneCells = mdTableRows(lanesSection).slice(1);
	if (laneCells.length === 0) return { section: null, problem: "Execution Lanes table is empty" };

	const planSection = mdSection(body, "Integration Plan");
	const shapeSection = mdSection(body, "Lane Shape");
	if (planSection === null || shapeSection === null) {
		return { section: null, problem: "lane sections incomplete (Integration Plan / Lane Shape missing)" };
	}
	const planCells = mdTableRows(planSection).slice(1);
	if (planCells.length === 0) return { section: null, problem: "Integration Plan table is empty" };

	const shapeLine = shapeSection.split("\n").find((line) => line.startsWith("Shape: "));
	if (!shapeLine) return { section: null, problem: "Lane Shape narrative missing" };
	const narrative = shapeLine.slice("Shape: ".length).split(" — ")[0]?.trim() ?? "";
	const shape: Array<"parallel" | "series"> = [];
	for (const segment of narrative.split(" → ")) {
		const trimmed = segment.trim();
		if (trimmed.startsWith("parallel")) shape.push("parallel");
		else if (trimmed.startsWith("series")) shape.push("series");
		else return { section: null, problem: `unparseable shape segment "${trimmed}"` };
	}

	const lanes: ArchitectLaneEntry[] = [];
	for (const cells of laneCells) {
		if (cells.length < 5) {
			return { section: null, problem: `lane row has ${cells.length} column(s), expected 5` };
		}
		const [laneId, status, stepsCell, worktree, branch] = cells as [string, string, string, string, string];
		lanes.push({
			laneId,
			steps: stepsCell
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s !== ""),
			worktree,
			branch,
			status: status as LaneStatus,
		});
	}
	const integrationPlan: ArchitectIntegrationEntry[] = [];
	for (const cells of planCells) {
		if (cells.length < 4) {
			return { section: null, problem: `integration row has ${cells.length} column(s), expected 4` };
		}
		const [order, laneId, mergeLevel, gates] = cells as [string, string, string, string];
		integrationPlan.push({
			order: Number(order),
			laneId,
			mergeLevel: Number(mergeLevel),
			gates: gates
				.split(" + ")
				.map((g) => g.trim())
				.filter((g) => g !== ""),
			preMerge: LANE_PRE_MERGE,
		});
	}

	const section: ArchitectLanesSection = { shape, lanes, integrationPlan, lockRules: [...LANE_LOCK_RULES] };
	const problem = validateLanesSection(section);
	return problem ? { section: null, problem } : { section, problem: null };
}

/**
 * Build the execution-lanes block for the handoff payload (Phase 7 / N16).
 *
 * DB-first via `readLatestPublishedRows(..., "development-order")` (the
 * `collectADRDecisions` precedent), file fallback via `resolveDocArtifact`.
 * Returns `{section: null, problem: null}` when there are no lane rows —
 * legacy handoff payloads keep byte-identical shape. A `problem` means the
 * lane rows exist but are malformed; the caller omits the key AND warns.
 *
 * @param _state - Run state (unused — kept for builder symmetry).
 * @param projectName - Project whose published lanes to hand off.
 * @param cwd - Project root (store + Doc/ lookup).
 * @returns The section (validated) or a warning problem.
 */
export function buildLanesSection(_state: RunState, projectName: string, cwd: string): LanesSectionResult {
	if (!projectName) return LANES_NONE;
	const fromDb = readLatestPublishedRows(cwd, projectName, "development-order");
	if (fromDb) return buildLanesFromRows(fromDb.rows);
	return buildLanesFromFile(projectName, cwd);
}

/**
 * Read the design doc and collect every ADR for the architect-inputs
 * payload. Returns an empty array when the design doc is missing or the
 * section is absent (consistent with gateADR's lenient mode).
 */
function collectADRDecisions(_state: RunState, projectName: string, cwd: string): AdrSummary[] {
	// Phase 11 (Design 11 — gap 2): DB-first. Q3-retired projects (flag
	// DEFAULT OFF) have NO published design file — the payload renders
	// from the store's published rows via the Phase 5 renderer. The file
	// read remains the fallback for legacy / flag-ON projects.
	const fromDb = readLatestPublishedRows(cwd, projectName, "design");
	let content: string | null = fromDb ? renderDesignMarkdown(fromDb.rows, projectName) : null;
	if (!content) {
		const designPath = resolveDocArtifact("design", projectName, cwd);
		if (!designPath) return [];
		try {
			content = readFileSync(designPath.path, "utf8");
		} catch {
			return [];
		}
	}
	const adrs: ADR[] = parseADRSection(content);
	return adrs.map((a) => ({
		id: a.id,
		title: a.title,
		status: a.status,
		stage: a.stage,
		decision: a.decision,
	}));
}
