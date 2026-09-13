import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showTestplan } from "../view/show.js";

export function registerShowTestplanCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-show-testplan", {
		description: "Real handler for /velpari-show-testplan (Phase 7).",
		handler: async (_args, ctx) => {
			await showTestplan(ctx as never);
		},
	});
}
