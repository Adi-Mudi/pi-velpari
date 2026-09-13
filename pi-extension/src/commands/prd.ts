import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handlePrd } from "../stages/prd.js";

export function registerPrdCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-prd", {
		description: "Real handler for /velpari-prd (Phase 7).",
		handler: async (_args, ctx) => {
			await handlePrd(ctx as never, pi as never);
		},
	});
}
