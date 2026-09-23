/**
 * Scout agent bootstrap (v2.0 + v3 persistent).
 *
 * On first use of `/velpari-brainstorm`, ensure the 4 scout agent definitions
 * (`extractor`, `prd-checker`, `rtm-checker`, `web-search-agent`) are present
 * in `.pi/agents/`. They are bundled in `skills/agents/*.md` and copied to
 * `.pi/agents/` on demand.
 *
 * v3 — also ensures the 2 persistent sub-agent definitions
 * (`web-research`, `doc-code-analyst`) used by the AUTOMATIC SPAWN step.
 * They live in the same `skills/agents/` directory and bootstrap via the
 * generic `ensureStageAgents` path.
 *
 * Pi discovers agents by walking the directory tree from cwd; `.pi/agents/`
 * is the standard project-local location (per pi-seani AGENTS.md).
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../core/paths.js";
import { resolveAgentName, VELPARI_ROLES, type AgentConfig, type VelpariRole } from "../core/agents-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SCOUT_AGENT_IDS = ["extractor", "prd-checker", "rtm-checker", "web-search-agent"] as const;

export type ScoutAgentId = (typeof SCOUT_AGENT_IDS)[number];

/**
 * v3 — Persistent sub-agent ids used by the AUTOMATIC SPAWN step of the
 * brainstorm v3 lifecycle. These are NOT scouts (one-shot dispatches) —
 * they are long-lived sessions that stay alive across the brainstorm and
 * get routed per user message via `subagent({ session: <handle>, ... })`.
 *
 * Bootstrap happens via `ensureStageAgents(PERSISTENT_AGENT_IDS, cwd)`
 * (Phase 4) on the first spawn call. The bundled markdown files live at
 * `skills/agents/web-research.md` and `skills/agents/doc-code-analyst.md`.
 */
export const PERSISTENT_AGENT_IDS = ["web-research", "doc-code-analyst"] as const;

export type PersistentAgentId = (typeof PERSISTENT_AGENT_IDS)[number];

interface EnsureScoutAgentsResult {
	installed: ScoutAgentId[];
	alreadyPresent: ScoutAgentId[];
}

/**
 * Resolve the path to a bundled agent file in `skills/agents/<id>.md`.
 *
 * Layout-independent: walks up from `__dirname` to the nearest
 * package.json (via findPackageRoot) and joins `skills/agents/<id>.md`.
 * Works for the dist layout, the npm-installed src layout, and any
 * symlinked dev install.
 *
 * Phase v1.0.1: replaced the Phase F 4-level-up probe, which silently
 * resolved one level too high when Pi loaded the source tree directly
 * (the `main: ./pi-extension/src/index.ts` layout). The same bug
 * silently broke scout-agent bootstrap for users on the npm install.
 *
 * v3 — accepts either a `ScoutAgentId` or a `PersistentAgentId`. Both
 * agent classes live in the same `skills/agents/` directory.
 */
export function bundledAgentPath(agentId: ScoutAgentId | PersistentAgentId): string {
	const pkgRoot = findPackageRoot(__dirname);
	return join(pkgRoot, "skills", "agents", `${agentId}.md`);
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

/**
 * v3 — Ensure the 2 persistent sub-agent definitions are present in
 * `.pi/agents/`. Called by the spawn helper (Phase 2) on the first
 * `spawnPersistentSessions` call so both panes are bootable when the
 * parent LLM calls `subagent({ calls: [...] })`.
 *
 * Thin wrapper around `ensureStageAgents` with the right id list.
 * Returns the same shape so the caller can surface "X installed" via
 * a UI notify when needed.
 */
export function ensurePersistentAgents(
	cwd: string = process.cwd(),
	agentConfig?: AgentConfig | null,
): EnsureStageAgentsResult {
	return ensureStageAgents(PERSISTENT_AGENT_IDS, cwd, agentConfig);
}

/**
 * Render a one-line summary for the persistent agents bootstrap. Same
 * shape as `formatScoutAgentsInstalledMessage` but phrased for the
 * v3 AUTOMATIC SPAWN context.
 */
export function formatPersistentAgentsInstalledMessage(result: EnsureStageAgentsResult): string {
	if (result.installed.length === 0) return "";
	const list = result.installed.join(", ");
	return `Installed ${result.installed.length} persistent sub-agent(s) into .pi/agents/: ${list}.`;
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
 * brainstorm-stage scouts. Use this for any other stage (prd, rtm, feasibility,
 * design, pseudocode, testplan, atomic-function, development-order).
 *
 * Bundled files are looked up at `skills/agents/<agentId>.md`. If a bundled
 * file is missing, the agent id is added to `missing` and skipped silently
 * (the parent LLM surfaces the error at subagent-spawn time).
 *
 * When `agentConfig` is provided (the loaded `.pi/velpari/agents.json`, or
 * null when the file is absent), ids are treated as ROLE ids: a role whose
 * resolved agent name differs from the role id is SKIPPED entirely — a
 * remapped role means the user supplied their own agent, which must already
 * exist (doctor checks it). Only default-named roles are bootstrapped.
 * Omitting the parameter preserves the legacy install-everything behavior.
 */
export function ensureStageAgents(
	agentIds: readonly string[],
	cwd: string = process.cwd(),
	agentConfig?: AgentConfig | null,
): EnsureStageAgentsResult {
	const agentsDir = join(cwd, ".pi", "agents");
	const installed: string[] = [];
	const alreadyPresent: string[] = [];
	const missing: string[] = [];

	for (const id of agentIds) {
		if (
			agentConfig !== undefined &&
			(VELPARI_ROLES as readonly string[]).includes(id) &&
			resolveAgentName(agentConfig, id as VelpariRole) !== id
		) {
			// Remapped role — the custom agent must already exist; do not
			// bootstrap the bundled default under the role name.
			continue;
		}
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

// ─── Phase 5: overlay-specific scout bootstrap ─────────────────────────────

/**
 * Copy an overlay's bundled scout markdown files into the project's
 * `.pi/agents/` directory. Overlay scouts are NOT in `skills/agents/` —
 * they live in `skills/standards/overlays/<id>/scouts/<role>.md`.
 *
 * Returns the list of roles that were successfully bootstrapped.
 * Missing scout files are reported via the result (do not throw) so
 * the parent LLM can surface a clear error at spawn time.
 */
interface BootstrapOverlayScoutsResult {
	installed: string[];
	alreadyPresent: string[];
	missing: string[];
}

export function bootstrapOverlayScouts(
	overlayId: string,
	roles: readonly string[],
	cwd: string = process.cwd(),
): BootstrapOverlayScoutsResult {
	const agentsDir = join(cwd, ".pi", "agents");
	const overlayScoutsDir = join(cwd, "skills", "standards", "overlays", overlayId, "scouts");
	const installed: string[] = [];
	const alreadyPresent: string[] = [];
	const missing: string[] = [];

	for (const role of roles) {
		const target = join(agentsDir, `${role}.md`);
		if (existsSync(target)) {
			alreadyPresent.push(role);
			continue;
		}
		const source = join(overlayScoutsDir, `${role}.md`);
		if (!existsSync(source)) {
			missing.push(role);
			continue;
		}
		if (!existsSync(agentsDir)) {
			mkdirSync(agentsDir, { recursive: true });
		}
		copyFileSync(source, target);
		installed.push(role);
	}

	return { installed, alreadyPresent, missing };
}
