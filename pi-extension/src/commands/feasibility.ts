import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleFeasibility } from "../stages/feasibility.js";

export function registerFeasibilityCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-feasibility", {
		description: "Real handler for /velpari-feasibility (Phase 7).",
		handler: async (_args, ctx) => {
			await handleFeasibility(ctx as never, pi as never);
		},
	});
}
