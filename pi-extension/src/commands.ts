import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * All 23 commands. Phase A registers every name with a stub handler so the
 * surface exists; later phases replace stubs with real handlers.
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

export function registerCommands(pi: ExtensionAPI): void {
	for (const name of COMMAND_NAMES) {
		pi.registerCommand(name, {
			description: `Stub handler for /${name} (implemented in a later phase).`,
			handler: async (args, ctx) => {
				ctx.ui.notify(`/${name}: Phase A stub. Args: ${args ?? "(none)"}`, "info");
			},
		});
	}
}
