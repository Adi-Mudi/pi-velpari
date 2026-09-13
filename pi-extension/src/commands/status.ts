import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleStatus } from "../ops/status.js";

export function registerStatusCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-status", {
		description: "Real handler for /velpari-status (Phase 7).",
		handler: async (_args, ctx) => {
			await handleStatus(ctx as never, pi as never);
		},
	});
}
