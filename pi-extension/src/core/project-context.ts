/**
 * Project-context loader (Phase 2 of /velpari-generate-sub-agents).
 *
 * v1: minimal extraction from the run's mission text and history notes.
 *     The mission is a free-text string the user typed into
 *     `/velpari-brainstorm <mission>`; we scan it for well-known tech
 *     keywords and surface them as `techStack` hints.
 *
 * v2: pull from PRD + RTM JSON sidecars when present (deferred).
 *
 * The shape (`techStack`, `atomicFunctions`, `constraints`) is the
 * minimal contract `buildGeneratedAgentMarkdown` consumes today. PRD/RTM
 * additions will extend the shape without breaking callers.
 *
 * Layer 0. Imports only `node:*`. No IO helpers, no peer deps.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Lowercase substring hints the extractor scans for in mission text. */
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

function extractTechStack(mission: string | undefined): string[] {
	if (!mission) return [];
	const haystack = mission.toLowerCase();
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

/** Load a project context. Caller may pass:
 *  - a live `RunState` (preferred, no extra IO)
 *  - `null` / undefined → load `.IDE_Plans/velpari/state.json` from `cwd`
 *    if present
 *  - both `cwd` and `runState` are passed; `runState` wins. */
export function loadProjectContext(cwd: string, runState?: MinimalRunState | null): ProjectContext {
	let state: MinimalRunState | null = runState ?? null;
	if (state === null) {
		try {
			const statePath = join(cwd, ".IDE_Plans", "velpari", "state.json");
			if (existsSync(statePath)) {
				state = JSON.parse(readFileSync(statePath, "utf8")) as MinimalRunState;
			}
		} catch {
			// Corrupt or missing; fall through to empty context.
		}
	}
	if (state === null) return emptyProjectContext();
	return {
		techStack: extractTechStack(state.mission),
		atomicFunctions: [],
		constraints: [],
	};
}
