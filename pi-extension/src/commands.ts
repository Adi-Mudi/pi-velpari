import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleDiscuss } from "./discuss.js";
import { handlePrd } from "./prd.js";
import { handleRtm } from "./rtm.js";
import { handleApproveDiscuss } from "./discuss-approve.js";
import { handleFeasibility } from "./feasibility.js";
import { handleDesign } from "./design.js";
import { handlePseudocode } from "./pseudocode.js";
import { handleTestplan } from "./testplan.js";
import { handleApprove } from "./approve.js";
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
import { loadState } from "./state.js";

/**
 * All 23 commands. Phase B wires 4 of them (discuss, prd, rtm, approve-discuss)
 * to real handlers; the remaining 19 keep stub handlers until later phases.
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
	// Discipline commands (7)
	"velpari-approve",
	"velpari-approve-discuss",
	"velpari-status",
	"velpari-reset",
	"velpari-configure-inputs",
	"velpari-doctor",
	"velpari-handoff",
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

// Phase B: 4 commands wired to real handlers.
// Phase C: 5 more wired (feasibility, design, pseudocode, testplan, approve).
const REAL_HANDLERS: Record<string, (args: string, ctx: unknown) => Promise<void>> = {
	"velpari-discuss": async (args, ctx) => {
		const mission = (args ?? "").trim();
		if (!mission) {
			(ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
				"Usage: /velpari-discuss <topic>",
				"error",
			);
			return;
		}
		await handleDiscuss(mission, ctx as never);
	},
	"velpari-prd": async (_args, ctx) => {
		await handlePrd(ctx as never);
	},
	"velpari-rtm": async (_args, ctx) => {
		await handleRtm(ctx as never);
	},
	"velpari-approve-discuss": async (_args, ctx) => {
		await handleApproveDiscuss(ctx as never);
	},
	"velpari-feasibility": async (_args, ctx) => {
		await handleFeasibility(ctx as never);
	},
	"velpari-design": async (_args, ctx) => {
		await handleDesign(ctx as never);
	},
	"velpari-pseudocode": async (_args, ctx) => {
		await handlePseudocode(ctx as never);
	},
	"velpari-testplan": async (_args, ctx) => {
		await handleTestplan(ctx as never);
	},
	"velpari-approve": async (_args, ctx) => {
		await handleApprove(ctx as never);
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
};

export function registerCommands(pi: ExtensionAPI): void {
	for (const name of COMMAND_NAMES) {
		const realHandler = REAL_HANDLERS[name];
		pi.registerCommand(name, {
			description:
				realHandler !== undefined
					? `Real handler for /${name} (Phase B).`
					: `Stub handler for /${name} (implemented in a later phase).`,
			handler: realHandler ?? (async (args, ctx) => {
				ctx.ui.notify(`/${name}: Phase A stub. Args: ${args ?? "(none)"}`, "info");
			}),
		});
	}
}
