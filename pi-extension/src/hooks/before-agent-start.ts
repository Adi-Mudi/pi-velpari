/**
 * before_agent_start hook (Senai port): inject a `<velpari_status>` block
 * into the system prompt on every agent turn while a run is active.
 *
 * The block carries the current stage, run id, mission, the exact next
 * command(s), and the hard rule for the stage (write-scope and scout
 * freshness for in-progress stages; read-only rule for brainstorming).
 * Per-turn reinforcement survives context compaction — after a compact,
 * the very next turn re-injects the full stage discipline.
 *
 * No-op (returns the prompt unchanged) when there is no active run.
 * Fails open: any error returns the original system prompt untouched.
 */

import { join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { nextCommandsFor, STAGE_FOLDERS } from "../core/constants.js";
import { loadFilesConfig } from "../core/config.js";
import { buildRunDir, hasPublishedFeasibility } from "../core/paths.js";
import { loadState, type RunState } from "../core/state.js";

/**
 * True only at built-rtm when a published feasibility study already exists —
 * the skip to /velpari-architecture-generator is then a real next command. Cheap: the check
 * runs only for the one stage where it matters.
 */
function feasibilitySkipFor(state: RunState, cwd: string): boolean {
	if (state.currentStage !== "built-rtm") return false;
	const projectName = loadFilesConfig(cwd).projectName;
	return projectName !== "" && hasPublishedFeasibility(cwd, projectName);
}

/** Per-stage hard rule injected alongside the status block. */
function stageRule(state: RunState, cwd: string): string | null {
	if (state.currentStage === "brainstorming") {
		const folder = relative(cwd, join(buildRunDir(state.runId, cwd), "brainstorm"));
		return (
			`Brainstorm "${state.runId}" is open: the project is read-only outside ` +
			`${folder}/ until /velpari-approve-brainstorm. Confirm the understanding, ` +
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
			`ready, the user runs /velpari-approve to publish.`
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
			const lines = [
				"<velpari_status>",
				`stage: ${state.currentStage}`,
				`run: ${state.runId}`,
				`mission: ${state.mission}`,
				`next: ${nextCommandsFor(state.currentStage, { feasibilitySkip: feasibilitySkipFor(state, ctx.cwd) }).join(" or ")}`,
			];
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
