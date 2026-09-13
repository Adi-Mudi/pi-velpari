import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showPseudocode } from "../view/show.js";

export function registerShowPseudocodeCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-show-pseudocode", {
		description: "Real handler for /velpari-show-pseudocode (Phase 7).",
		handler: async (_args, ctx) => {
			await showPseudocode(ctx as never);
		},
	});
}
