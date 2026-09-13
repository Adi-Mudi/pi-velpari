import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleDevelopmentOrder } from "../stages/development-order.js";

export function registerDevelopmentOrderCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-development-order", {
		description: "Real handler for /velpari-development-order (Phase 7).",
		handler: async (_args, ctx) => {
			await handleDevelopmentOrder(ctx as never, pi as never);
		},
	});
}
