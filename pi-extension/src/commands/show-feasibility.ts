import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showFeasibility } from "../view/show.js";

export function registerShowFeasibilityCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-show-feasibility", {
		description: "Real handler for /velpari-show-feasibility (Phase 7).",
		handler: async (_args, ctx) => {
			await showFeasibility(ctx as never);
		},
	});
}
