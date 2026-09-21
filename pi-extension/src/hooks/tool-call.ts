/**
 * tool_call hook — hard sequence locks at the tool layer.
 *
 * Guards (all fail open on error — a guard bug must never wedge edits):
 *
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
 *
 * The runner does not catch handler errors for tool_call — a throw
 * propagates and blocks the tool entirely. So every step is wrapped in
 * try/catch and FAILS OPEN.
 */

import { relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { STAGE_FOLDERS } from "../core/constants.js";
import { buildRunDir } from "../core/paths.js";
import { loadState, type RunState } from "../core/state.js";
import { guardBrainstormMutation } from "../stages/brainstorm/guard.js";

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

export function registerToolCallHook(pi: ExtensionAPI): void {
	pi.on("tool_call", (event, ctx) => {
		try {
			const state = loadState(ctx.cwd);
			const input = event.input as Record<string, unknown> | undefined;

			// 1. Brainstorm mutation lock (returns { block, reason } or undefined).
			const mutationBlock = guardBrainstormMutation(event.toolName, input, state, ctx.cwd);
			if (mutationBlock) return mutationBlock;

			// 2. Stage mutation lock.
			const stageBlock = guardStageMutation(event.toolName, input, state, ctx.cwd);
			if (stageBlock) return stageBlock;

			// 3. Scout spawn guard.
			const spawnBlock = guardScoutSpawn(event.toolName, input, state);
			if (spawnBlock) return spawnBlock;
		} catch {
			// Fail open — never wedge edits on a guard bug.
		}
		return undefined;
	});
}
