/**
 * session_shutdown hook (extracted from src/index.ts in Phase 0 reorg).
 *
 * Emits the cross-extension `velpari:shutdown` event.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// PHASE-F import (N31) — no Excalidraw daemon left behind (§2.2).
import { shutdownLauncher } from "../core/excalidraw.js";

export function registerSessionShutdownHook(pi: ExtensionAPI): void {
	pi.on("session_shutdown", async (event) => {
		pi.events?.emit?.("velpari:shutdown", {
			reason: event.reason,
			ts: new Date().toISOString(),
		});
	});
	// ─── PHASE-F (N31) — stop OUR MCP child + canvas (only if we started it) ───
	pi.on("session_shutdown", async () => {
		try {
			await shutdownLauncher();
		} catch {
			// Best-effort teardown — never blocks or fails session end.
		}
	});
	// ─── PHASE-F END ───
}
