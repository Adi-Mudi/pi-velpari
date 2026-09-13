import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleFinalDesign } from "../stages/final-design.js";

export function registerFinalDesignCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-design", {
		description: "Real handler for /velpari-design (final-design consolidation, plan 3).",
		handler: async (_args, ctx) => {
			await handleFinalDesign(ctx as never, pi as never);
		},
	});
}
