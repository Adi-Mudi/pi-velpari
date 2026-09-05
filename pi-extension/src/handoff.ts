/**
 * /velpari-handoff handler (Phase 7 update).
 *
 * Flow:
 * 1. Verify state is at `planned-tests` or `ordered-development`
 * 2. Read projectName from .pi/velpari/files.json
 * 3. Scan 7 required Doc/ artifacts + 2 optional ones (FR-34).
 *    Each artifact is resolved with grouped layout first and legacy
 *    flat layout fallback.
 * 4. Build architect-inputs.json with versioned schema
 * 5. Validate against our schema mirror of Senai's expected shape
 * 6. Preview gate (FR-23)
 * 7. Write to .pi/senai/architect-inputs.json
 * 8. Transition state to handoff-ready
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { advanceStage, loadState, type RunState } from "./state.js";
import {
	buildGroupedPath,
	buildOutputPath,
	resolveDocArtifact,
} from "./paths.js";
import { loadFilesConfig, validateFilesConfig } from "./config.js";

export type DocumentType =
	| "PRD"
	| "RTM"
	| "Feasibility Study"
	| "Design"
	| "Pseudocode"
	| "Test Plan"
	| "Test Cases"
	| "Atomic Functions"
	| "Development Order";

export interface ArchitectDocument {
	type: DocumentType;
	path: string;
}

export interface ArchitectInputs {
	version: 1;
	projectName: string;
	createdAt: string;
	mission: string;
	documents: ArchitectDocument[];
}

const REQUIRED_TYPES: ReadonlyArray<{ type: DocumentType; artifact: string }> = [
	{ type: "PRD", artifact: "PRD" },
	{ type: "RTM", artifact: "RTM" },
	{ type: "Feasibility Study", artifact: "feasibility-study" },
	{ type: "Design", artifact: "design" },
	{ type: "Pseudocode", artifact: "pseudocode" },
	{ type: "Test Plan", artifact: "test-plan" },
	{ type: "Test Cases", artifact: "test-cases" },
];

const OPTIONAL_TYPES: ReadonlyArray<{ type: DocumentType; artifact: string }> = [
	{ type: "Atomic Functions", artifact: "atomic-functions" },
	{ type: "Development Order", artifact: "development-order" },
];

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
		ctx.ui.notify("No active run. Run /velpari-discuss first.", "error");
		return;
	}
	if (state.currentStage !== "planned-tests" && state.currentStage !== "ordered-development") {
		ctx.ui.notify(
			`Cannot handoff at stage "${state.currentStage}". ` +
				`Expected "planned-tests" or "ordered-development".`,
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

	const inputs: ArchitectInputs = {
		version: 1,
		projectName,
		createdAt: new Date().toISOString(),
		mission: state.mission,
		documents,
	};

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

	mkdirSync(dirname(targetPath), { recursive: true });
	writeFileSync(targetPath, JSON.stringify(inputs, null, 2), "utf8");
	ctx.ui.notify(`Handoff written to ${targetPath}`, "info");

	const next = advanceStage(state, "/velpari-handoff", cwd);
	void next;
	void existsSync;
}