import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./core/commands.js";
import { buildCompactionSummary } from "./core/compaction.js";

/**
 * Pi-Velpari extension entry point.
 *
 * Verified architecture (commit 1b227bc):
 * - Peer dep: @earendil-works/pi-coding-agent
 * - Entry shape: default export (pi: ExtensionAPI) => { ... }
 * - Compaction hook returns { compaction: { summary, firstKeptEntryId, tokensBefore } }
 *
 * Subagent guard is retained defensively (unverified — Phase A smoke-tests it).
 */
export default function (pi: ExtensionAPI) {
	// Unverified guard. If `PI_SUBAGENT_NAME` is unset, this is a no-op.
	if (process.env.PI_SUBAGENT_NAME) return;

	registerCommands(pi);

	// Zero-LLM compaction hook (NFR-01).
	pi.on("session_before_compact", async (event) => {
		return {
			compaction: {
				summary: buildCompactionSummary(),
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
			},
		};
	});
}
