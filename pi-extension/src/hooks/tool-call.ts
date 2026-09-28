/**
 * tool_call hook — hard sequence locks at the tool layer.
 *
 * Guards (all fail open on error — a guard bug must never wedge edits):
 *
 *   0. Session worktree gate (Phase A, N18): while the cached session
 *      verdict reports a declared-worktree mismatch or a conflict between
 *      the run binding and the active plan directive, edit/write is
 *      blocked with the exact session message ("Restart the session
 *      there."). Runs FIRST — a wrong-folder session must never see a
 *      stage/brainstorm message instead of the session one.
 *   1. Brainstorm mutation lock (stages/brainstorm/guard.ts): while a
 *      brainstorm is open (currentStage === "brainstorming", with or
 *      without pausedStage), edit/write outside the run's brainstorm
 *      folder is blocked. Runs first and WINS over the stage lock
 *      (D4 precedence) — the stage lock is suppressed for the whole
 *      session, including writes to the paused stage's folder.
 *   2. Stage mutation lock: while any stage draft is in progress
 *      (STAGE_FOLDERS) and no brainstorm is open, edit/write outside
 *      that stage's run folder is
 *      blocked. The working copy may only be written inside
 *      `<runDir>/<stage>/`; publishing happens exclusively via
 *      the publish tool (Doc/ is NOT exempt).
 *   3. Scout spawn guard: during an in-progress scout stage, every
 *      `subagent` spawn must name a `-report.json` path in its task so the
 *      scout's report is declared up front. ("Scout said done but wrote
 *      nothing" is checked at skill level via `test -s`; the async
 *      subagent completion is not observable from tool_result, so only
 *      the spawn half is enforceable here.)
 *   4. Store DB scope lock (Phase 8): edit/write into `Doc/store/**`
 *      (the per-project SQLite store + its exported YAML views) is
 *      blocked ALWAYS — between stages included. Every legitimate store
 *      write is code-side (publish tool, backfill, reconfirm, export);
 *      a hand edit of the committed DB would corrupt the single source
 *      of truth (D2/D7).
 *   5. Store DELETE hard-lock (F12, phase 2): destructive bash verbs
 *      (`rm`, `rmdir`, `shred`, `truncate`, `git rm`, `mv`) that name a
 *      store path are blocked with the guided correction
 *      (`ops/tombstone.ts:deleteAttemptGuidance` → /velpari-tombstone,
 *      /velpari-rollback, /velpari-export). Published revisions are
 *      immutable (F16): a delete is a tracked modification, never a
 *      removal.
 *   6. Worktree write guard (phase 5, N5/N6):
 *      `stages/worktree-lock.ts:verifyRunWorktree` — while a run is active,
 *      edit/write from a folder that is not the run's worktree (or on a
 *      different branch) is blocked with the self-healing fix. Runs last so
 *      it never shadows the brainstorm/stage/scout/store precedence.
 *
 * Accepted boundaries (recorded, not oversights): non-destructive bash
 * writes to the store, and deletes of the legacy `Doc/*.md` views
 * (design rule 12 — the DB is the source of truth, git + the doctor's
 * integrity/orphan audits are the backstop). Checksums backstop everything.
 *
 * The runner does not catch handler errors for tool_call — a throw
 * propagates and blocks the tool entirely. So every step is wrapped in
 * try/catch and FAILS OPEN.
 */

import { relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { STAGE_FOLDERS } from "../core/constants.js";
import { buildRunDir, STORE_DB_DIR } from "../core/paths.js";
import { deleteAttemptGuidance } from "../ops/tombstone.js";
import { loadState, type RunState } from "../core/state.js";
import { sessionGateVerdict } from "../core/plan-binding.js";
import { guardBrainstormMutation } from "../stages/brainstorm/guard.js";
import { verifyRunWorktree } from "../stages/worktree-lock.js";

/**
 * Generalized stage mutation lock: while `state.currentStage` is an
 * in-progress stage listed in STAGE_FOLDERS, block edit/write tool calls
 * whose target path is outside `<runDir>/<folder>/`. Reads stay free.
 * Returns the pi tool_call block shape or undefined to allow.
 *
 * D4 precedence: while a brainstorm session is open (currentStage ===
 * "brainstorming", with or without pausedStage), the brainstorm-folder
 * lock owns ALL edit/write gating and this lock is suppressed. (Today
 * "brainstorming" is absent from STAGE_FOLDERS so the early return is
 * defensive — it keeps the precedence explicit if the folder map ever
 * changes.)
 */
export function guardStageMutation(
	toolName: string,
	input: Record<string, unknown> | undefined,
	state: RunState,
	cwd: string,
): { block: true; reason: string } | undefined {
	if (toolName !== "edit" && toolName !== "write") return undefined;
	if (!state.runId) return undefined;
	if (state.currentStage === "brainstorming") return undefined; // D4 precedence
	const folder = STAGE_FOLDERS[state.currentStage];
	if (!folder) return undefined;

	const target = typeof input?.path === "string" ? resolve(cwd, input.path) : "";
	const allowedRoot = resolve(buildRunDir(state.runId, cwd), folder);
	if (target && target.startsWith(allowedRoot + sep)) return undefined;

	return {
		block: true,
		reason:
			`Locked: stage "${state.currentStage}" in progress. ` +
			`Finish it (working copy → preview → velpari_stage_publish tool) or /velpari-reset.\n` +
			`Target allowed only under ${relative(cwd, allowedRoot)}/.`,
	};
}

/**
 * Store DB scope lock (Phase 8): block edit/write tool calls whose
 * target lands under `<cwd>/Doc/store/` — ALWAYS, run or no run, any
 * stage. The store (SQLite DB + exported YAML views) is written
 * exclusively by code paths (stage publish tool, `/velpari-backfill`,
 * `/velpari-reconfirm`, `/velpari-export`); an LLM hand edit would
 * corrupt the committed source of truth. Runs LAST (after the
 * brainstorm/stage/spawn guards) and blocks only store paths, so it
 * never shadows the existing precedence. Fail-open like its siblings.
 */
export function guardStoreDbMutation(
	toolName: string,
	input: Record<string, unknown> | undefined,
	cwd: string,
): { block: true; reason: string } | undefined {
	if (toolName !== "edit" && toolName !== "write") return undefined;

	const target = typeof input?.path === "string" ? resolve(cwd, input.path) : "";
	const storeRoot = resolve(cwd, STORE_DB_DIR);
	// Fail-open: a malformed/missing path can never be judged in-store,
	// so it is allowed (the block below only fires on a POSITIVE store
	// match — an empty target must never block).
	if (!target) return undefined;
	if (!target.startsWith(storeRoot + sep)) return undefined;

	return {
		block: true,
		reason: deleteAttemptGuidance(target),
	};
}

/**
 * Store DELETE hard-lock (F12, Phase 2): a destructive shell verb aimed at
 * Doc/store/** is blocked with the guided correction from ops/tombstone.ts.
 * Published content is immutable (F16) — the legitimate paths are
 * /velpari-tombstone (with a reason), /velpari-rollback and /velpari-export.
 * Edits/writes stay covered by guardStoreDbMutation; other bash writes remain
 * outside the accepted boundary, and so do non-store files such as the legacy
 * `Doc/*.md` views (design rule 12 — the DB is the source of truth and git +
 * the doctor's integrity audits are the backstop).
 *
 * Fail-open like its siblings: anything unreadable/malformed is allowed.
 */
export function guardStoreDeleteAttempt(
	toolName: string,
	input: Record<string, unknown> | undefined,
	cwd: string,
): { block: true; reason: string } | undefined {
	if (toolName !== "bash") return undefined;
	const command = typeof input?.command === "string" ? input.command.trim() : "";
	if (command === "") return undefined;
	if (!/\b(rm|rmdir|shred|truncate)\b/.test(command) && !/\bgit\s+rm\b/.test(command) && !/\bmv\b/.test(command)) {
		return undefined;
	}
	// Path-boundary match: `Doc/store` must be followed by a separator, a
	// quote or end-of-command — `Doc/storekeeper/x` must NOT match.
	const storeRoot = resolve(cwd, STORE_DB_DIR);
	const relativeStore = relative(cwd, storeRoot) || STORE_DB_DIR;
	/**
	 * True when the given path literal appears in the command followed by a separator, whitespace, quote or end-of-string (never mid-segment); the literal is regex-escaped internally.
	 * @param {string} value - Path literal to search for.
	 * @returns {boolean} Whether the path appears at a token boundary.
	 */
	const atBoundary = (value: string): boolean => new RegExp(`${escapeRegExp(value)}(?=[/\\s'"]|$)`).test(command);
	if (!atBoundary(relativeStore) && !atBoundary(storeRoot)) return undefined;
	return { block: true, reason: deleteAttemptGuidance(command) };
}

/** Escape a literal for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scout spawn guard: during an in-progress scout stage, a `subagent` tool
 * call must declare the scout's report path (a `-report.json` file) in its
 * task text. Blocks spawns that would produce no verifiable report.
 */
function guardScoutSpawn(
	toolName: string,
	input: Record<string, unknown> | undefined,
	state: RunState,
): { block: true; reason: string } | undefined {
	if (toolName !== "subagent") return undefined;
	if (!state.runId) return undefined;
	const folder = STAGE_FOLDERS[state.currentStage];
	if (!folder) return undefined;

	const task = typeof input?.task === "string" ? input.task : "";
	if (task.includes("-report.json")) return undefined;

	return {
		block: true,
		reason:
			`Scout spawn blocked at stage "${state.currentStage}": the subagent task must ` +
			`instruct the scout to write its report file.\n` +
			`Include the report path (ending in "-report.json", under this run's ` +
			`${folder}/scouts/ folder) in the task text.`,
	};
}

/**
 * Worktree write guard (Phase 5, N5/N6): while a run is active, an edit/write
 * whose folder is not the run's stamped worktree (or whose branch is not the
 * run's branch) is blocked with the self-healing message — go back to the run's
 * worktree, or create a separate worktree for a parallel line. This is the
 * "blocks fire BEFORE any write" half of the enforcement; the stage/publish
 * gates cover the commands.
 *
 * Fail-open like its siblings (R4): no run, no stamp, a non-git folder or any
 * error → allowed.
 * @param {string} toolName - Pi tool name (only edit/write are guarded).
 * @param {RunState} state - Current run state.
 * @param {string} cwd - Session folder.
 * @returns {{ block: true; reason: string } | undefined} Block, or undefined.
 */
export function guardWorktreeMutation(
	toolName: string,
	state: RunState,
	cwd: string,
): { block: true; reason: string } | undefined {
	if (toolName !== "edit" && toolName !== "write") return undefined;
	if (!state.runId) return undefined;
	const verdict = verifyRunWorktree(state, cwd);
	return verdict.ok ? undefined : { block: true, reason: verdict.reason };
}

/**
 * Session worktree gate (Phase A, N18/G3): deny edit/write while the
 * session's cached verdict says this folder is not the declared
 * worktree/branch — or that two active declarations conflict (G4: the
 * user decides which line wins). Runs FIRST so the session message always
 * wins over stage/brainstorm guards. Fail-open: any error → allowed (R4).
 * @param {string} toolName - Tool being called.
 * @param {string} cwd - Session folder.
 * @returns {{ block: true; reason: string } | undefined} The block, or undefined when allowed.
 */
export function guardSessionWorktree(toolName: string, cwd: string): { block: true; reason: string } | undefined {
	if (toolName !== "edit" && toolName !== "write") return undefined;
	try {
		const verdict = sessionGateVerdict(cwd);
		if (verdict.kind === "mismatch" || verdict.kind === "conflict") {
			return { block: true, reason: verdict.reason };
		}
		return undefined;
	} catch {
		return undefined; // fail-open (R4)
	}
}

export function registerToolCallHook(pi: ExtensionAPI): void {
	pi.on("tool_call", (event, ctx) => {
		try {
			const state = loadState(ctx.cwd);
			const input = event.input as Record<string, unknown> | undefined;

			// 0. Session worktree gate (Phase A, N18) — a wrong-folder session is
			//    a hard stop before ANY stage/brainstorm message (G3).
			const sessionBlock = guardSessionWorktree(event.toolName, ctx.cwd);
			if (sessionBlock) return sessionBlock;

			// 1. Brainstorm mutation lock (returns { block, reason } or undefined).
			const mutationBlock = guardBrainstormMutation(event.toolName, input, state, ctx.cwd);
			if (mutationBlock) return mutationBlock;

			// 2. Stage mutation lock.
			const stageBlock = guardStageMutation(event.toolName, input, state, ctx.cwd);
			if (stageBlock) return stageBlock;

			// 3. Scout spawn guard.
			const spawnBlock = guardScoutSpawn(event.toolName, input, state);
			if (spawnBlock) return spawnBlock;

			// 4. Store DB scope lock (Phase 8) — runs last, store paths only.
			const storeBlock = guardStoreDbMutation(event.toolName, input, ctx.cwd);
			if (storeBlock) return storeBlock;

			// 5. Store DELETE hard-lock (F12, phase 2) — destructive bash verbs on
			//    store paths, with the self-healing guidance instead of a dead end.
			const deleteBlock = guardStoreDeleteAttempt(event.toolName, input, ctx.cwd);
			if (deleteBlock) return deleteBlock;

			// 6. Worktree write guard (phase 5) — a run may only write inside its
			//    own worktree/branch; a copied folder or a foreign line is blocked.
			const worktreeBlock = guardWorktreeMutation(event.toolName, state, ctx.cwd);
			if (worktreeBlock) return worktreeBlock;
		} catch {
			// Fail open — never wedge edits on a guard bug.
		}
		return undefined;
	});
}
