import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadState } from "../core/state.js";
import { runHandoff } from "../ops/handoff.js";

export function registerHandoffCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-handoff", {
		description: "Real handler for /velpari-handoff (Phase 7).",
		handler: async (_args, ctx) => {
			const state = loadState();
			await runHandoff(state, ctx as never);
		},
	});
}
