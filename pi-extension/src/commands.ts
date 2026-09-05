import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleDiscuss } from "./discuss.js";
import { handlePrd } from "./prd.js";
import { handleRtm } from "./rtm.js";
import { handleApproveDiscuss } from "./discuss-approve.js";
import { handleFeasibility } from "./feasibility.js";
import { handleDesign } from "./design.js";
import { handlePseudocode } from "./pseudocode.js";
import { handleTestplan } from "./testplan.js";
import { handleAtomicFunction } from "./atomic-function.js";
import { handleDevelopmentOrder } from "./development-order.js";
import { handleApprove } from "./approve.js";
import { handlePrdRtm } from "./prd-rtm.js";
import { handleConfigureRequirements } from "./configure-requirements.js";
import { runHandoff } from "./handoff.js";
import {
	showDiscussion,
	showPrd,
	showRtm,
	showFeasibility,
	showDesign,
	showPseudocode,
	showTestplan,
} from "./show.js";
import { handleStatus } from "./status.js";
import { handleReset } from "./reset.js";
import { handleConfigureInputs } from "./configure-inputs.js";
import { handleDoctor } from "./doctor.js";
import { loadState } from "./state.js";

/**
 * All 25 commands. Adds /velpari-configure-requirements and
 * /velpari-prd-rtm on top of the 22 existing stage + discipline +
 * view commands (Phase 7 / Requirements Factory).
 */
export const COMMAND_NAMES = [
	// Stage commands (9)
	"velpari-discuss",
	"velpari-prd",
	"velpari-rtm",
	"velpari-feasibility",
	"velpari-design",
	"velpari-pseudocode",
	"velpari-testplan",
	"velpari-atomic-function",
	"velpari-development-order",
	// Discipline commands (8)
	"velpari-approve",
	"velpari-approve-discuss",
	"velpari-status",
	"velpari-reset",
	"velpari-configure-inputs",
	"velpari-configure-requirements",
	"velpari-doctor",
	"velpari-handoff",
	// Wrapper command (1)
	"velpari-prd-rtm",
	// View commands (7)
	"velpari-show-discussion",
	"velpari-show-prd",
	"velpari-show-rtm",
	"velpari-show-feasibility",
	"velpari-show-design",
	"velpari-show-pseudocode",
	"velpari-show-testplan",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

// v2.0: handlers may receive `pi` (ExtensionAPI) so they can call
// pi.sendUserMessage to hand off a prompt to the parent LLM.
type RealHandler = (args: string, ctx: unknown, pi?: ExtensionAPI) => Promise<void>;
const REAL_HANDLERS: Record<string, RealHandler> = {
	"velpari-discuss": async (args, ctx, pi) => {
		const mission = (args ?? "").trim();
		if (!mission) {
			(ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
				"Usage: /velpari-discuss <topic>",
				"error",
			);
			return;
		}
		await handleDiscuss(mission, ctx as never, pi as never);
	},
	"velpari-prd": async (_args, ctx, pi) => {
		await handlePrd(ctx as never, pi as never);
	},
	"velpari-rtm": async (_args, ctx, pi) => {
		await handleRtm(ctx as never, pi as never);
	},
	"velpari-approve-discuss": async (_args, ctx, pi) => {
		await handleApproveDiscuss(ctx as never, pi as never);
	},
	"velpari-feasibility": async (_args, ctx, pi) => {
		await handleFeasibility(ctx as never, pi as never);
	},
	"velpari-design": async (_args, ctx, pi) => {
		await handleDesign(ctx as never, pi as never);
	},
	"velpari-pseudocode": async (_args, ctx, pi) => {
		await handlePseudocode(ctx as never, pi as never);
	},
	"velpari-testplan": async (_args, ctx, pi) => {
		await handleTestplan(ctx as never, pi as never);
	},
	"velpari-atomic-function": async (_args, ctx, pi) => {
		await handleAtomicFunction(ctx as never, pi as never);
	},
	"velpari-development-order": async (_args, ctx, pi) => {
		await handleDevelopmentOrder(ctx as never, pi as never);
	},
	"velpari-approve": async (_args, ctx) => {
		await handleApprove(ctx as never);
	},
	"velpari-prd-rtm": async (_args, ctx, pi) => {
		await handlePrdRtm(ctx as never, pi as never);
	},
	"velpari-configure-requirements": async (_args, ctx, pi) => {
		await handleConfigureRequirements(ctx as never, pi as never);
	},
	"velpari-handoff": async (_args, ctx) => {
		const state = loadState();
		await runHandoff(state, ctx as never);
	},
	"velpari-show-discussion": async (_args, ctx) => {
		await showDiscussion(ctx as never);
	},
	"velpari-show-prd": async (_args, ctx) => {
		await showPrd(ctx as never);
	},
	"velpari-show-rtm": async (_args, ctx) => {
		await showRtm(ctx as never);
	},
	"velpari-show-feasibility": async (_args, ctx) => {
		await showFeasibility(ctx as never);
	},
	"velpari-show-design": async (_args, ctx) => {
		await showDesign(ctx as never);
	},
	"velpari-show-pseudocode": async (_args, ctx) => {
		await showPseudocode(ctx as never);
	},
	"velpari-show-testplan": async (_args, ctx) => {
		await showTestplan(ctx as never);
	},
	"velpari-status": async (_args, ctx) => {
		await handleStatus(ctx as never);
	},
	"velpari-reset": async (_args, ctx) => {
		await handleReset(ctx as never);
	},
	"velpari-configure-inputs": async (_args, ctx) => {
		await handleConfigureInputs(ctx as never);
	},
	"velpari-doctor": async (_args, ctx) => {
		await handleDoctor(ctx as never);
	},
};

export function registerCommands(pi: ExtensionAPI): void {
	for (const name of COMMAND_NAMES) {
		const realHandler = REAL_HANDLERS[name];
		pi.registerCommand(name, {
			description:
				realHandler !== undefined
					? `Real handler for /${name} (Phase 7).`
					: `Stub handler for /${name} (implemented in a later phase).`,
			handler: realHandler
				? async (args, ctx) => realHandler(args, ctx, pi)
				: async (args, ctx) => {
						ctx.ui.notify(`/${name}: stub. Args: ${args ?? "(none)"}`, "info");
					},
		});
	}
}