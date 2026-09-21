/**
 * Brainstorm — persistent sub-agent spawn helper (v3, AUTOMATIC SPAWN).
 *
 * Step 2 of the new brainstorm sequence: opens 2 named persistent
 * sessions (web-research + doc-code-analyst) immediately after the
 * handler's createRun, BEFORE the UNDERSTAND loop starts. Both sessions
 * stay alive in the multiplexer right column until
 * `/velpari-approve-brainstorm` fires `subagent_interrupt` on each.
 *
 * Design — single source of truth:
 *   - Session handle names (BRAINSTORM_SESSION_HANDLES) are exported
 *     and reused by the dispatcher, the prompt renderer, and the
 *     approve-close step. Rename here = rename everywhere.
 *   - The helper is IDEMPOTENT: re-calling with both handles already
 *     present returns `alreadySpawned: true` so the handler can safely
 *     re-enter on resume / rehydrate.
 *   - The helper does NOT call subagent() itself. It prepares the
 *     `subagent()` call args for the parent LLM, mirroring the
 *     dispatcher pattern. The parent LLM executes the spawn, receives
 *     the handles from the extension, and persists them via the
 *     `velpari_brainstorm_session({ action: "spawn-sessions" })` tool
 *     action (which calls `setActiveSubagents`).
 *
 * Layer 1 (stage-logic). Imports from core/state.js (L0) and the
 * extension API type from @earendil-works/pi-coding-agent (external).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	loadState,
	setActiveSubagents,
	type RunState,
} from "../../core/state.js";
import {
	ensurePersistentAgents,
	formatPersistentAgentsInstalledMessage,
} from "../../io/agents-install.js";

/**
 * v3 — Logical session handles for the 2 persistent sub-agent panes.
 *
 * These strings are the `session:` argument the parent LLM spreads into
 * `subagent({ calls: [{ session, ... }] })`. They MUST be stable across
 * rehydrate — they identify the child Pi session in the parent's
 * session namespace (per @mjakl/pi-subagent Named Session Semantics).
 *
 * Single source of truth — the dispatcher (Phase 3), the prompt
 * renderer (Phase 5), and the approve-close step (Phase 8) all import
 * this constant. Do NOT hardcode "web" or "doc-code" anywhere else.
 */
export const BRAINSTORM_SESSION_HANDLES = {
	web: "web",
	docCode: "doc-code",
} as const;

/** Agent names for the 2 persistent sub-agents. Match the bundled agent
 *  markdown files under skills/agents/ (Phase 4). */
export const BRAINSTORM_PERSISTENT_AGENTS = {
	web: "web-research",
	docCode: "doc-code-analyst",
} as const;

/** Timeout per spawn — generous because the first call has to bring up
 *  the child Pi process + load agent frontmatter. */
export const BRAINSTORM_SPAWN_TIMEOUT_MS = 60_000;

/** Single subagent() call payload the parent LLM spreads into
 *  `subagent({ calls: [{ ... }] })`. */
interface SpawnCall {
	agent: string;
	session: string;
	prompt: string;
	timeoutMs: number;
}

/** What `spawnPersistentSessions` returns.
 *  - ok=true, alreadySpawned=true   → return existing handles, no work
 *  - ok=true, needsDispatch=true    → parent LLM must call subagent()
 *                                    with the prepared calls, then
 *                                    persist via the tool action
 *  - ok=false                       → hard error; do not proceed */
type SpawnSessionsResult =
	| {
			ok: true;
			alreadySpawned: true;
			web: string;
			docCode: string;
			spawnedAt: string;
	  }
	| {
			ok: true;
			alreadySpawned: false;
			needsDispatch: true;
			calls: SpawnCall[];
			/** Project name from files.json — included so the agent prompts
			 *  can mention it. */
			projectName: string | null;
	  }
	| { ok: false; error: string };

/**
 * Prepare the spawn payload for the 2 persistent sessions.
 *
 * Caller contract:
 *   1. Caller invokes this helper at step 2 (right after createRun).
 *   2. If result.alreadySpawned: nothing to do — handler proceeds to
 *      step 3 (UNDERSTAND loop).
 *   3. If result.needsDispatch: caller (parent LLM) calls
 *      `subagent({ calls: result.calls })`, receives the session handles
 *      back from the extension, then invokes
 *      `velpari_brainstorm_session({ action: "spawn-sessions", web, docCode })`
 *      to persist. The tool action calls `setActiveSubagents` which
 *      writes state.json.
 *   4. On error: caller surfaces via `ctx.ui.notify` and halts.
 *
 * @param cwd project root
 * @param mission the brainstorm mission string
 * @param projectName from files.json (optional; improves agent prompts)
 */
export function spawnPersistentSessions(opts: {
	cwd?: string;
	mission: string;
	projectName?: string | null;
	/** Optional notification sink — receives the "installed N persistent
	 *  sub-agents" message on first bootstrap. When omitted, the message
	 *  is dropped silently (useful for tests). */
	onInstallNotice?: (message: string) => void;
}): SpawnSessionsResult {
	const cwd = opts.cwd ?? process.cwd();

	// Step 0 — Bootstrap the 2 persistent agent definitions into
	// `.pi/agents/`. Idempotent — copies only files that don't already
	// exist. The result is available so the handler can show a notify
	// on first-use.
	const bootstrap = ensurePersistentAgents(cwd);
	if (bootstrap.installed.length > 0 && opts.onInstallNotice) {
		opts.onInstallNotice(formatPersistentAgentsInstalledMessage(bootstrap));
	}

	// Read state to check idempotency + validate we have an active run.
	let state: RunState;
	try {
		state = loadState(cwd);
	} catch (err) {
		return {
			ok: false,
			error: `Cannot read state for AUTOMATIC SPAWN: ${(err as Error).message}`,
		};
	}
	if (!state.runId) {
		return {
			ok: false,
			error:
				"No active run — call createRun before spawnPersistentSessions. " +
				"This is a programming error in the brainstorm handler.",
		};
	}

	// Idempotency: both handles present → return them, no work.
	const existing = state.activeSubagents;
	if (existing?.web && existing?.docCode) {
		return {
			ok: true,
			alreadySpawned: true,
			web: existing.web,
			docCode: existing.docCode,
			spawnedAt: existing.spawnedAt ?? new Date().toISOString(),
		};
	}

	// Build the 2 spawn calls. The agent name and session handle are
	// pinned by BRAINSTORM_PERSISTENT_AGENTS + BRAINSTORM_SESSION_HANDLES;
	// the prompt carries the mission so the child Pi session has context.
	const projectHint = opts.projectName
		? ` for project "${opts.projectName}"`
		: "";
	const basePrompt = (role: "web" | "docCode") =>
		[
			`You are the ${role === "web" ? "web-research" : "doc-code-analyst"} sub-agent${projectHint}.`,
			`Brainstorm mission: ${opts.mission}`,
			"",
			`This is a NAMED PERSISTENT session (handle: ${role === "web" ? BRAINSTORM_SESSION_HANDLES.web : BRAINSTORM_SESSION_HANDLES.docCode}).`,
			`The parent LLM will route messages to you via subagent({ session: "<your handle>", prompt: <message> }).`,
			`Stay alive until the parent sends subagent_interrupt. Accumulate context across all turns.`,
			`Acknowledge briefly and wait.`,
		].join("\n");

	const calls: SpawnCall[] = [
		{
			agent: BRAINSTORM_PERSISTENT_AGENTS.web,
			session: BRAINSTORM_SESSION_HANDLES.web,
			prompt: basePrompt("web"),
			timeoutMs: BRAINSTORM_SPAWN_TIMEOUT_MS,
		},
		{
			agent: BRAINSTORM_PERSISTENT_AGENTS.docCode,
			session: BRAINSTORM_SESSION_HANDLES.docCode,
			prompt: basePrompt("docCode"),
			timeoutMs: BRAINSTORM_SPAWN_TIMEOUT_MS,
		},
	];

	return {
		ok: true,
		alreadySpawned: false,
		needsDispatch: true,
		calls,
		projectName: opts.projectName ?? null,
	};
}

/**
 * Persist the session handles returned from subagent() calls. Called by
 * the `velpari_brainstorm_session({ action: "spawn-sessions" })` tool
 * action after the parent LLM executes the prepared spawn.
 *
 * Throws on invalid input — the tool action surfaces the error to the
 * user via ctx.ui.notify.
 */
export function persistSpawnHandles(
	state: RunState,
	handles: { web: string; docCode: string },
	cwd: string = process.cwd(),
): RunState {
	return setActiveSubagents(state, { ...handles }, cwd);
}

/** Re-export the ExtensionAPI type so callers don't need to import it
 *  from the upstream package for typing alone. */
export type { ExtensionAPI, ExtensionCommandContext };
