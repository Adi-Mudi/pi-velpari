import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleReset } from "../ops/reset.js";

export function registerResetCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-reset", {
		description: "Real handler for /velpari-reset (Phase 7).",
		handler: async (_args, ctx) => {
			await handleReset(ctx as never);
		},
	});
}
