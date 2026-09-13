import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleTestplan } from "../stages/testplan.js";

export function registerTestplanCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-testplan", {
		description: "Real handler for /velpari-testplan (Phase 7).",
		handler: async (_args, ctx) => {
			await handleTestplan(ctx as never, pi as never);
		},
	});
}
