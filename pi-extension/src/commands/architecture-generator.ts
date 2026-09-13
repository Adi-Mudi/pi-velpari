import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleDesign } from "../stages/design.js";

export function registerArchitectureGeneratorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-architecture-generator", {
		description: "Real handler for /velpari-architecture-generator (Phase 7).",
		handler: async (_args, ctx) => {
			await handleDesign(ctx as never, pi as never);
		},
	});
}
