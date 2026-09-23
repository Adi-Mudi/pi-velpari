import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleFinalDesign } from "../stages/final-design.js";

export function registerFinalDesignCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-final-design", {
		description:
			"Final-design consolidation (renamed from /velpari-html-design on 2026-09-14; today produces Doc/design/final-design_<project>.md, not actual HTML).",
		handler: async (_args, ctx) => {
			await handleFinalDesign(ctx as never, pi as never);
		},
	});
}
