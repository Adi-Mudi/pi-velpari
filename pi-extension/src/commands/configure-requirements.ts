import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleConfigureRequirements } from "../ops/configure-requirements/index.js";

export function registerConfigureRequirementsCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-configure-requirements", {
		description: "Real handler for /velpari-configure-requirements (Phase 7).",
		handler: async (_args, ctx) => {
			await handleConfigureRequirements(ctx as never, pi as never);
		},
	});
}
