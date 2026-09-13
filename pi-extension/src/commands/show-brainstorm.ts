import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showBrainstorm } from "../view/show.js";

export function registerShowBrainstormCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-show-brainstorm", {
		description: "Real handler for /velpari-show-brainstorm (Phase 7).",
		handler: async (_args, ctx) => {
			await showBrainstorm(ctx as never);
		},
	});
}
