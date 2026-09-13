import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handlePseudocode } from "../stages/pseudocode.js";

export function registerPseudocodeCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-pseudocode", {
		description: "Real handler for /velpari-pseudocode (Phase 7).",
		handler: async (_args, ctx) => {
			await handlePseudocode(ctx as never, pi as never);
		},
	});
}
