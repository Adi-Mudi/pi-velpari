import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showPrd } from "../view/show.js";

export function registerShowPrdCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-show-prd", {
		description: "Real handler for /velpari-show-prd (Phase 7).",
		handler: async (_args, ctx) => {
			await showPrd(ctx as never);
		},
	});
}
