import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../ops/approve.js";

/**
 * Manual recovery command for the pseudocode stage (v1.6.0).
 *
 * The parent LLM normally publishes inline via velpari_stage_publish
 * when the working copy is ready; this command exists only for the case
 * where the LLM-driven publish was unavailable or failed. Runs the same
 * handleApprove gate chain as before.
 */
export function registerPseudocodeApproveCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-pseudocode-approve", {
		description: "Manual fallback publish for the pseudocode stage (v1.6.0).",
		handler: async (_args, ctx) => {
			await handleApprove(ctx as never, pi as never);
		},
	});
}
