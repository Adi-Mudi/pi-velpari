/**
 * Scout agent bootstrap (v2.0).
 *
 * On first use of `/velpari-discuss`, ensure the 4 scout agent definitions
 * (`extractor`, `prd-checker`, `rtm-checker`, `web-search-agent`) are present
 * in `.pi/agents/`. They are bundled in `skills/agents/*.md` and copied to
 * `.pi/agents/` on demand.
 *
 * Pi discovers agents by walking the directory tree from cwd; `.pi/agents/`
 * is the standard project-local location (per pi-seani AGENTS.md).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SCOUT_AGENT_IDS = ["extractor", "prd-checker", "rtm-checker", "web-search-agent"] as const;

export type ScoutAgentId = (typeof SCOUT_AGENT_IDS)[number];

export interface EnsureScoutAgentsResult {
	installed: ScoutAgentId[];
	alreadyPresent: ScoutAgentId[];
}

/**
 * Resolve the path to a bundled agent file in `skills/agents/<id>.md`.
 * Handles both the dist layout (dist/pi-extension/src → repo root, 3 levels)
 * and the source layout (pi-extension/src → repo root, 2 levels).
 */
export function bundledAgentPath(agentId: ScoutAgentId): string {
	const candidates = [
		// Phase A: new core/ layout — dist/pi-extension/src/core → repo root → skills/agents
		resolve(__dirname, "../../../..", "skills", "agents", `${agentId}.md`),
		// Legacy: dist/pi-extension/src → repo root → skills/agents
		resolve(__dirname, "../../..", "skills", "agents", `${agentId}.md`),
		// Legacy: src layout — pi-extension/src/core → repo root → skills/agents
		resolve(__dirname, "../..", "skills", "agents", `${agentId}.md`),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return candidates[0]!;
}

/**
 * Ensure all 4 scout agents are present in `<cwd>/.pi/agents/`.
 * Creates `.pi/agents/` if needed. Returns which were installed vs already present.
 *
 * Silent by design; callers emit a `ctx.ui.notify` if any were installed.
 */
export function ensureScoutAgents(cwd: string = process.cwd()): EnsureScoutAgentsResult {
	const agentsDir = join(cwd, ".pi", "agents");
	const installed: ScoutAgentId[] = [];
	const alreadyPresent: ScoutAgentId[] = [];

	for (const id of SCOUT_AGENT_IDS) {
		const target = join(agentsDir, `${id}.md`);
		if (existsSync(target)) {
			alreadyPresent.push(id);
			continue;
		}
		if (!existsSync(agentsDir)) {
			mkdirSync(agentsDir, { recursive: true });
		}
		const source = bundledAgentPath(id);
		if (!existsSync(source)) {
			// Bundled file missing — skip silently. The LLM will surface the error
			// at subagent spawn time.
			continue;
		}
		copyFileSync(source, target);
		installed.push(id);
	}

	return { installed, alreadyPresent };
}

/**
 * Render a one-line summary of an EnsureScoutAgentsResult for `ctx.ui.notify`.
 * Empty string when nothing was installed (caller can skip the notify).
 */
export function formatScoutAgentsInstalledMessage(result: EnsureScoutAgentsResult): string {
	if (result.installed.length === 0) return "";
	const list = result.installed.join(", ");
	return `Installed ${result.installed.length} scout agent(s) into .pi/agents/: ${list}.`;
}

export interface EnsureStageAgentsResult {
	installed: string[];
	alreadyPresent: string[];
	missing: string[];
}

/**
 * Generic stage agent bootstrap (Phase 1 of the all-stages refactor).
 *
 * Ensures the named agents (any string id) are present in `.pi/agents/`.
 * Differs from `ensureScoutAgents` (above) which is hardcoded to the 4
 * discuss-stage scouts. Use this for any other stage (prd, rtm, feasibility,
 * design, pseudocode, testplan, atomic-function, development-order).
 *
 * Bundled files are looked up at `skills/agents/<agentId>.md`. If a bundled
 * file is missing, the agent id is added to `missing` and skipped silently
 * (the parent LLM surfaces the error at subagent-spawn time).
 */
export function ensureStageAgents(
	agentIds: readonly string[],
	cwd: string = process.cwd(),
): EnsureStageAgentsResult {
	const agentsDir = join(cwd, ".pi", "agents");
	const installed: string[] = [];
	const alreadyPresent: string[] = [];
	const missing: string[] = [];

	for (const id of agentIds) {
		const target = join(agentsDir, `${id}.md`);
		if (existsSync(target)) {
			alreadyPresent.push(id);
			continue;
		}
		const source = bundledAgentPath(id as ScoutAgentId);
		if (!existsSync(source)) {
			missing.push(id);
			continue;
		}
		if (!existsSync(agentsDir)) {
			mkdirSync(agentsDir, { recursive: true });
		}
		copyFileSync(source, target);
		installed.push(id);
	}

	return { installed, alreadyPresent, missing };
}

// Keep imports referenced for the bundler
void readFileSync;
void writeFileSync;