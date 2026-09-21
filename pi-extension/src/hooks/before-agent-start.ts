/**
 * before_agent_start hook (Senai port): inject a `<velpari_status>` block
 * into the system prompt on every agent turn while a run is active.
 *
 * The block carries the current stage, run id, mission, the exact next
 * command(s) FROM THE TRANSITION LOCK (A1 — the single source of legal-
 * command truth: two-door collapse while a brainstorm is open, earliest-
 * stale routing when the chain is stale, forward table otherwise), the
 * paused stage while a brainstorm session is open, and the hard rule for
 * the stage (write-scope and scout freshness for in-progress stages;
 * read-only rule for brainstorming).
 *
 * No-op (returns the prompt unchanged) when there is no active run.
 * Fails open: any error returns the original system prompt untouched.
 */

import { join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { STAGE_FOLDERS } from "../core/constants.js";
import { buildRunDir } from "../core/paths.js";
import { loadState, type RunState } from "../core/state.js";
import { STAGE_LOCK_SPECS } from "../stages/registry.js";
import { computeLegalCommands } from "../stages/transition-lock.js";

/** Per-stage hard rule injected alongside the status block. */
function stageRule(state: RunState, cwd: string): string | null {
	if (state.currentStage === "brainstorming") {
		const folder = relative(cwd, join(buildRunDir(state.runId, cwd), "brainstorm"));
		const paused = state.pausedStage
			? ` (paused from "${state.pausedStage}" — approve offers: continue "${state.pausedStage}" or restart at /velpari-prd)`
			: "";
		return (
			`Brainstorm "${state.runId}" is open${paused}: the project is read-only outside ` +
			`${folder}/ until /velpari-approve-brainstorm (or close without an artifact via ` +
			`velpari_brainstorm_session({ action: "discard" })). Confirm the understanding, ` +
			`finish every open question (agreed / not-wanted+reason / replaced), then approve.`
		);
	}
	const folder = STAGE_FOLDERS[state.currentStage];
	if (folder) {
		const allowed = relative(cwd, join(buildRunDir(state.runId, cwd), folder));
		return (
			`Stage "${state.currentStage}" in progress: MUST spawn the 4 scouts fresh ` +
			`via the subagent tool — never reuse, copy, or read scout reports from any ` +
			`previous run folder; each scout task must name its -report.json path under ` +
			`${allowed}/scouts/; write only inside ${allowed}/; when the working copy is ` +
			`ready and the user confirms the preview, publish via the velpari_stage_publish ` +
			`tool (or the publish tool as fallback).`
		);
	}
	return null;
}

export function registerBeforeAgentStartHook(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event, ctx) => {
		try {
			const state = loadState(ctx.cwd);
			if (!state.runId || state.currentStage === "none") {
				return { systemPrompt: event.systemPrompt };
			}
			const lock = computeLegalCommands(ctx.cwd, STAGE_LOCK_SPECS);
			const lines = [
				"<velpari_status>",
				`stage: ${state.currentStage}`,
				`run: ${state.runId}`,
				`mission: ${state.mission}`,
				`next: ${lock.nextCommands.join(" or ")}`,
			];
			if (lock.pausedStage) {
				lines.push(`paused: ${lock.pausedStage} (brainstorm open — approve resumes it, or restart at /velpari-prd)`);
			}
			const rule = stageRule(state, ctx.cwd);
			if (rule) lines.push(`rule: ${rule}`);
			lines.push("</velpari_status>");
			return { systemPrompt: `${event.systemPrompt}\n\n${lines.join("\n")}` };
		} catch {
			// Fail open — never break a turn on a status-injection bug.
			return { systemPrompt: event.systemPrompt };
		}
	});
}
