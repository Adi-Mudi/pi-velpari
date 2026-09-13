import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handlePrdRtm } from "../stages/prd-rtm.js";

export function registerPrdRtmCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-prd-rtm", {
		description: "Real handler for /velpari-prd-rtm (Phase 7).",
		handler: async (_args, ctx) => {
			await handlePrdRtm(ctx as never, pi as never);
		},
	});
}
