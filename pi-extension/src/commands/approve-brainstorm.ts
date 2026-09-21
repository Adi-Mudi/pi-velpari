import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleApproveBrainstorm } from "../stages/brainstorm-approve.js";

export function registerApproveBrainstormCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-approve-brainstorm", {
		description: "Real handler for /velpari-approve-brainstorm (Phase 7).",
		handler: async (args, ctx) => {
			await handleApproveBrainstorm(ctx as never, pi as never, undefined, args ?? "");
		},
	});
}
