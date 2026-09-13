import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../ops/approve.js";

export function registerApproveCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-approve", {
		description: "Real handler for /velpari-approve (Phase 7).",
		handler: async (_args, ctx) => {
			await handleApprove(ctx as never, pi as never);
		},
	});
}
