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
import { readFileSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { atomicWriteJson } from "../io/atomic-write.js";
import { advanceStage, type RunState } from "../core/state.js";
import {
	buildGroupedPath,
	buildOutputPath,
	resolveDocArtifact,
} from "../core/paths.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { checkMvpCoverage } from "../core/mvp-coverage.js";
import { computeStaleSet } from "../core/freshness.js";
import { checkIdCoverage } from "../core/id-coverage.js";
import { parseADRSection, type ADR } from "../core/adr.js";
import { loadPublishedLoggingPlanMarkdown } from "../core/logging-plan.js";
import { getEffectiveProjectNames } from "../core/projectnames.js";

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
	| "Final Design";

export interface ArchitectDocument {
	type: DocumentType;
	path: string;
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
}

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

const OPTIONAL_TYPES: ReadonlyArray<{ type: DocumentType; artifact: string }> = [];

/**
 * Read all approved Doc/ artifacts. Returns the documents array.
 * Required artifacts that are missing throw an error listing them.
 * Each artifact path prefers the grouped layout and falls back to the
 * legacy flat layout (Phase 7 backwards compatibility).
 */
export function readApprovedArtifacts(
	projectName: string,
	cwd: string = process.cwd(),
): ArchitectDocument[] {
	const docs: ArchitectDocument[] = [];
	const missing: string[] = [];

	for (const { type, artifact } of REQUIRED_TYPES) {
		const resolved = resolveDocArtifact(artifact, projectName, cwd);
		if (resolved) {
			// Persist the actual on-disk path (absolute) so downstream
			// tooling can read it without re-deriving the layout.
			docs.push({ type, path: resolved.path });
		} else {
			missing.push(`${join(cwd, buildGroupedPath(artifact, projectName))} (or legacy: ${join(cwd, buildOutputPath(artifact, projectName))})`);
		}
	}

	for (const { type, artifact } of OPTIONAL_TYPES) {
		const resolved = resolveDocArtifact(artifact, projectName, cwd);
		if (resolved) {
			docs.push({ type, path: resolved.path });
		}
	}

	if (missing.length > 0) {
		throw new Error(
			`Missing required Doc/ artifacts:\n${missing.map((p) => `  - ${p}`).join("\n")}`,
		);
	}

	return docs;
}

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
				`MVP coverage ${mvp.covered}/${mvp.total} — warnings:\n` +
					mvp.issues.map((i) => `  - ${i.message}`).join("\n"),
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
				unstamped
					.map((s) => `  - ${s.key}: no freshness stamp — republish to stamp.`)
					.join("\n"),
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
						(r) =>
							`  - ${r.rule.id} (${r.rule.downstream}, ${r.projectName}): ` +
							`missing ${r.missingIds.join(", ")}`,
					)
					.join("\n") +
				`\nRevise the listed downstream stages to cover the missing ids, then republish.`,
			"error",
		);
		return;
	}
	const coverageWarnings = coverage.results.filter(
		(r) => r.status === "not-checkable" || r.duplicateIds.length > 0,
	);
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

	atomicWriteJson(targetPath, inputs);
	ctx.ui.notify(`Handoff written to ${targetPath}`, "info");

	const next = advanceStage(state, "/velpari-handoff", cwd);
	void next;
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
function readLoggingPlanFrontmatter(
	content: string,
): { version: string; status: "draft" | "approved" | "deprecated"; generatedAt: string; overlay?: string } {
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

/**
 * Read the design doc and collect every ADR for the architect-inputs
 * payload. Returns an empty array when the design doc is missing or the
 * section is absent (consistent with gateADR's lenient mode).
 */
function collectADRDecisions(
	_state: RunState,
	projectName: string,
	cwd: string,
): AdrSummary[] {
	const designPath = resolveDocArtifact("design", projectName, cwd);
	if (!designPath) return [];
	let content: string;
	try {
		content = readFileSync(designPath.path, "utf8");
	} catch {
		return [];
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