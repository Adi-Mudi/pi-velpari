import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleConfigureStandards } from "../ops/configure-standards.js";

export function registerConfigureStandardsCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-configure-standards", {
		description: "Pick a standards overlay for this Velpari run (Phase 3).",
		handler: async (_args, ctx) => {
			await handleConfigureStandards({
				ui: ctx.ui as never,
				cwd: ctx.cwd,
			});
		},
	});
}
