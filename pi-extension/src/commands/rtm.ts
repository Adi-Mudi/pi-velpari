import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleRtm } from "../stages/rtm.js";

export function registerRtmCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-rtm", {
		description: "Real handler for /velpari-rtm (Phase 7).",
		handler: async (_args, ctx) => {
			await handleRtm(ctx as never, pi as never);
		},
	});
}
