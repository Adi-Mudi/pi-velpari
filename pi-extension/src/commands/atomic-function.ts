import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleAtomicFunction } from "../stages/atomic-function.js";

export function registerAtomicFunctionCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-atomic-function", {
		description: "Real handler for /velpari-atomic-function (Phase 7).",
		handler: async (_args, ctx) => {
			await handleAtomicFunction(ctx as never, pi as never);
		},
	});
}
