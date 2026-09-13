import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showDesign } from "../view/show.js";

export function registerShowDesignCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-show-design", {
		description: "Real handler for /velpari-show-design (Phase 7).",
		handler: async (_args, ctx) => {
			await showDesign(ctx as never);
		},
	});
}
