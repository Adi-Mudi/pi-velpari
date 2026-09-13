/**
 * session_before_compact hook (extracted from src/index.ts in Phase 0 reorg).
 *
 * 1. Return the compaction payload (zero-LLM summary from run state).
 * 2. Emit the cross-extension `velpari:before-compact` event.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildCompactionSummary } from "../core/compaction.js";

export function registerSessionBeforeCompactHook(pi: ExtensionAPI): void {
	pi.on("session_before_compact", async (event) => {
		return {
			compaction: {
				summary: buildCompactionSummary(),
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
			},
		};
	});

	pi.on("session_before_compact", async (event) => {
		pi.events?.emit?.("velpari:before-compact", {
			reason: event.reason,
			ts: new Date().toISOString(),
		});
	});
}
