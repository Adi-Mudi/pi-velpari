/**
 * Stage publish tool (one-command stage publish upgrade).
 *
 * The stage handlers hand off to the parent LLM via pi.sendUserMessage;
 * the LLM writes the working copy and shows the preview gate. With this
 * tool, the preview "yes" branch publishes directly: the tool executes
 * the SAME handleApprove logic (publish gate → publish → doctor audit →
 * advanceStage) that publish runs. The publish tool stays
 * registered as the manual fallback.
 *
 * Confirm-then-write is preserved: the skill markdown instructs the LLM
 * to call this tool ONLY after the user confirms the preview gate
 * (AskUserQuestion). The tool itself runs the full gate chain, so a bad
 * working copy can never be published — identical guarantees to the
 * manual command.
 *
 * Tool pattern mirrors stages/brainstorm-state-tool.ts and
 * stages/feasibility-session-tool.ts (LLM-callable bridge to L1 logic).
 */

import { join } from "node:path";
import { Type } from "typebox";
import {
	withFileMutationQueue,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { loadState } from "../core/state.js";
import { PATHS } from "../core/constants.js";
import { handleApprove } from "../ops/approve.js";

/**
 * The 9 in-progress stages whose working copy can be published.
 * Completed stages (`drafted-prd`, `built-rtm`, ...) and `handoff-ready`
 * have nothing left to publish — the next stage command must run first.
 */
const PUBLISHABLE_STAGES = [
	"drafting-prd",
	"building-rtm",
	"analyzing-feasibility",
	"designing",
	"analyzing-atomic-functions",
	"writing-pseudocode",
	"planning-tests",
	"ordering-development",
	"finalizing-design",
] as const;

export function registerStagePublishTool(pi: ExtensionAPI): void { // (publish tool)
	pi.registerTool({
		name: "velpari_stage_publish",
		label: "Publish stage working copy",
		description:
			"Publish the current stage's working copy and advance the pipeline. " +
			"Call this automatically when the working copy is ready at the end of " +
			"a stage command like /velpari-prd. The parent LLM is responsible for " +
			"writing the working copy at <runDir>/<stage>/<artifact>_<project>.md " +
			"before invoking this tool; the publish gate verifies the file exists. " +
			"Runs publish gate checks, atomic publish to Doc/, doctor audit, and " +
			"stage advance. If the publish is blocked (gate/doctor errors), the " +
			"block reason is shown to the user — fix the working copy and call this " +
			"tool again. No parameters. Never call this during the brainstorm stage " +
			"(that stage uses /velpari-brainstorm-approve).",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return withFileMutationQueue(
				join(ctx.cwd, PATHS.STATE_FILE),
				async () => {
					const state = loadState(ctx.cwd);
					if (!state.runId || state.currentStage === "none") {
						return errorResult(
							"No active run to publish. Run a stage command (e.g. /velpari-prd) first.",
						);
					}
					if (state.currentStage === "brainstorming" || state.currentStage === "brainstormed") {
						return errorResult(
							`Use /velpari-approve-brainstorm for the brainstorm stage. ` +
								`Current stage: "${state.currentStage}".`,
						);
					}
					if (
						!(PUBLISHABLE_STAGES as readonly string[]).includes(state.currentStage)
					) {
						const completed = !state.currentStage.startsWith("drafting-") &&
							(state.currentStage.endsWith("-prd") ||
								state.currentStage.endsWith("-rtm") ||
								state.currentStage.endsWith("ed"));
						return errorResult(
							completed
								? `Stage "${state.currentStage}" is already published. Run the next stage command (see /velpari-status).`
								: `Cannot publish at stage "${state.currentStage}". Run the correct stage command first (see /velpari-status).`,
						);
					}

					// Delegate to the battle-tested approve handler. It notifies
					// the user on every blocked path (revision gate, publish
					// gate, doctor audit) and advances the stage on success.
					await handleApprove(
						ctx as unknown as Parameters<typeof handleApprove>[0],
						pi,
						ctx.cwd,
					);

					const after = loadState(ctx.cwd);
					return okResult({
						published: after.currentStage !== state.currentStage,
						stage: after.currentStage,
						runId: after.runId,
					});
				},
			);
		},
	});
}

interface PublishResult {
	published: boolean;
	stage: string;
	runId: string;
}

function okResult(state: PublishResult) {
	return {
		content: [
			{ type: "text" as const, text: JSON.stringify(state, null, 2) },
		],
		details: state,
	};
}

function errorResult(reason: string) {
	return {
		content: [{ type: "text" as const, text: reason }],
		details: null,
		isError: true,
	};
}
