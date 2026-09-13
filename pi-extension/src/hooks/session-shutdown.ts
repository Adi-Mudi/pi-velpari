/**
 * session_shutdown hook (extracted from src/index.ts in Phase 0 reorg).
 *
 * Emits the cross-extension `velpari:shutdown` event.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerSessionShutdownHook(pi: ExtensionAPI): void {
	pi.on("session_shutdown", async (event) => {
		pi.events?.emit?.("velpari:shutdown", {
			reason: event.reason,
			ts: new Date().toISOString(),
		});
	});
}
