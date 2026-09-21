/**
 * Project-context loader (generator v2 — per-phase; spec
 * Doc/velpari-sequence/05-sub-agent-generation.md).
 *
 * The context feeds `buildGeneratedAgentMarkdown`'s "## Project context"
 * block and the technology-resource matcher. Inputs are published `Doc/`
 * artifacts ONLY (never working copies, never `.IDE_Plans` run folders),
 * sidecar-first where a sidecar exists:
 *
 *   Phase 1 — mission keyword scan + files.json framework (no artifacts
 *             exist yet; the only phase without document input)
 *   Phase 2 — + published brainstorm notes (tech-hint scan)
 *   Phase 3 — + feasibility decision record (selected language) and the
 *             RTM sidecar (the concrete requirement list verifiers check)
 *   Phase 4 — + atomic-functions sidecar (key functions of the project)
 *
 * Every source is optional: a missing artifact simply contributes nothing,
 * so generation never dead-ends on an incomplete project.
 *
 * Layer 0. Imports node builtins + same-layer core modules only.
 */

import { readFileSync } from "node:fs";
import { loadState } from "./state.js";
import { loadFilesConfig } from "./config.js";
import { loadFeasibilityRecord } from "./feasibility-record.js";
import { resolveBrainstormArtifact, resolveDocArtifact, slugify } from "./paths.js";
import { loadRtmSidecarData } from "./rtm-data.js";
import { loadAfSidecarData } from "./af-data.js";
import type { GenerationPhase } from "./agents-config.js";

/** Lowercase substring hints the extractor scans for in mission/notes text. */
const TECH_HINTS: readonly string[] = [
	"typescript",
	"ts",
	"node",
	"nodejs",
	"deno",
	"bun",
	"react",
	"vue",
	"angular",
	"svelte",
	"solid",
	"next.js",
	"nextjs",
	"express",
	"fastify",
	"nestjs",
	"hono",
	"python",
	"django",
	"flask",
	"fastapi",
	"go",
	"golang",
	"rust",
	"java",
	"kotlin",
	"swift",
	"ruby",
	"rails",
	"elixir",
	"phoenix",
	"c++",
	"cpp",
	"c#",
	"dotnet",
	".net",
];

export interface ProjectContext {
	techStack: string[];
	atomicFunctions: string[];
	constraints: string[];
}

/** Minimal run-state shape that loadProjectContext reads. Callers may
 *  pass the full `RunState` from `./state.js`; only these fields are
 *  inspected. */
export interface MinimalRunState {
	mission?: string;
	history?: ReadonlyArray<{ notes?: string; stage?: string }>;
}

export function emptyProjectContext(): ProjectContext {
	return { techStack: [], atomicFunctions: [], constraints: [] };
}

function extractTechStack(text: string | undefined): string[] {
	if (!text) return [];
	const haystack = text.toLowerCase();
	const techStack: string[] = [];
	const seen = new Set<string>();
	for (const hint of TECH_HINTS) {
		if (haystack.includes(hint) && !seen.has(hint)) {
			techStack.push(hint);
			seen.add(hint);
		}
	}
	return techStack;
}

/** Append trimmed, non-empty, not-yet-present values. */
function mergeUnique(target: string[], additions: Iterable<string | undefined>): void {
	for (const addition of additions) {
		if (!addition) continue;
		const value = addition.trim();
		if (value && !target.includes(value)) target.push(value);
	}
}

/** files.json framework hints (language + runtime + libraries). Never throws. */
function frameworkHints(cwd: string): string[] {
	try {
		const config = loadFilesConfig(cwd);
		const hints: string[] = [];
		mergeUnique(hints, [
			config.framework?.language,
			config.framework?.runtime,
			...(config.framework?.libraries ?? []),
		]);
		return hints;
	} catch {
		return [];
	}
}

/** Primary project name from files.json (projectName, else first of
 *  projectNames). Empty string when unconfigured. Never throws. */
function projectNameOf(cwd: string): string {
	try {
		const config = loadFilesConfig(cwd);
		return config.projectName || config.projectNames?.[0] || "";
	} catch {
		return "";
	}
}

/** Phase 2 — tech hints from the published brainstorm notes. */
function brainstormTechHints(cwd: string, mission: string | undefined): string[] {
	if (!mission) return [];
	const resolved = resolveBrainstormArtifact(slugify(mission), cwd);
	if (!resolved) return [];
	let content: string;
	try {
		content = readFileSync(resolved.path, "utf8");
	} catch {
		return [];
	}
	return extractTechStack(content);
}

/** Phase 3 — the selected language from the feasibility decision record. */
function feasibilityTechHints(cwd: string, projectName: string): string[] {
	if (!projectName) return [];
	const record = loadFeasibilityRecord(cwd, projectName);
	if (!record) return [];
	const hints: string[] = [];
	mergeUnique(hints, [record.selectedLanguage]);
	return hints;
}

/** Phase 3+ — the concrete requirement list ("FR-1 — title") from the
 *  published RTM sidecar. Deprecated rows are dropped. Loose read: any
 *  shape problem yields an empty list, never a throw. */
function rtmConstraints(cwd: string, projectName: string): string[] {
	if (!projectName) return [];
	const resolved = resolveDocArtifact("RTM", projectName, cwd);
	if (!resolved) return [];
	const sidecar = loadRtmSidecarData(resolved.path);
	if (!sidecar) return [];
	const rows = (sidecar.data as { rows?: unknown }).rows;
	if (!Array.isArray(rows)) return [];
	const constraints: string[] = [];
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const r = row as Record<string, unknown>;
		if (r.status === "deprecated") continue;
		if (typeof r.id === "string" && typeof r.title === "string") {
			constraints.push(`${r.id} — ${r.title}`);
		}
	}
	return constraints;
}

/** Phase 4 — key functions ("AF-1 — name") from the published
 *  atomic-functions sidecar. Deprecated records are dropped. Loose read. */
function afKeyFunctions(cwd: string, projectName: string): string[] {
	if (!projectName) return [];
	const resolved = resolveDocArtifact("atomic-functions", projectName, cwd);
	if (!resolved) return [];
	const data = loadAfSidecarData(resolved.path);
	if (typeof data !== "object" || data === null) return [];
	const functions = (data as Record<string, unknown>).functions;
	if (!Array.isArray(functions)) return [];
	const keyFunctions: string[] = [];
	for (const fn of functions) {
		if (typeof fn !== "object" || fn === null) continue;
		const f = fn as Record<string, unknown>;
		if (f.status === "deprecated") continue;
		if (typeof f.afId === "string" && typeof f.name === "string") {
			keyFunctions.push(`${f.afId} — ${f.name}`);
		}
	}
	return keyFunctions;
}

/** Load a project context for the given generation phase. Caller may pass:
 *  - a live `RunState` (preferred, no extra IO)
 *  - `null` / undefined → load the current run state from `cwd` via
 *    `loadState` (honors the B1 legacy migration)
 *  - both `cwd` and `runState` are passed; `runState` wins.
 *  `phase` defaults to 1 (mission + files.json only). */
export function loadProjectContext(
	cwd: string,
	runState?: MinimalRunState | null,
	phase: GenerationPhase = 1,
): ProjectContext {
	let state: MinimalRunState | null = runState ?? null;
	if (state === null) {
		try {
			state = loadState(cwd);
		} catch {
			// Corrupt or unreadable; fall through with no mission.
		}
	}
	const mission = state?.mission;

	const techStack: string[] = [];
	mergeUnique(techStack, extractTechStack(mission));
	mergeUnique(techStack, frameworkHints(cwd));

	const context: ProjectContext = { techStack, atomicFunctions: [], constraints: [] };

	if (phase >= 2) {
		mergeUnique(techStack, brainstormTechHints(cwd, mission));
	}
	if (phase >= 3) {
		const projectName = projectNameOf(cwd);
		mergeUnique(techStack, feasibilityTechHints(cwd, projectName));
		context.constraints = rtmConstraints(cwd, projectName);
	}
	if (phase >= 4) {
		context.atomicFunctions = afKeyFunctions(cwd, projectNameOf(cwd));
	}
	return context;
}
