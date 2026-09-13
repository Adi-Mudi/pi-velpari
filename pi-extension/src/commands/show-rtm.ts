import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showRtm } from "../view/show.js";

export function registerShowRtmCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-show-rtm", {
		description: "Real handler for /velpari-show-rtm (Phase 7).",
		handler: async (_args, ctx) => {
			await showRtm(ctx as never);
		},
	});
}
