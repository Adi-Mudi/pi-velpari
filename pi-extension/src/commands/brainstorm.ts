import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleBrainstorm } from "../stages/brainstorm/index.js";

export function registerBrainstormCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-brainstorm", {
		description: "Real handler for /velpari-brainstorm (Phase 7).",
		handler: async (args, ctx) => {
			const mission = (args ?? "").trim();
			if (!mission) {
				(ctx as { ui: { notify: (m: string, l: string) => void } }).ui.notify(
					"Usage: /velpari-brainstorm <topic>",
					"error",
				);
				return;
			}
			await handleBrainstorm(mission, ctx as never, pi as never);
		},
	});
}
