/**
 * session_start hook (extracted from src/index.ts in Phase 0 reorg).
 *
 * 1. Rehydrate state from session entries (Phase E). Touches the
 *    persistence API even when no entries exist, so the extension loads
 *    cleanly on a fresh session. v0.5.1 Phase J.2 also clears any
 *    leftover velpari status bar from a prior session via the documented
 *    `ctx.ui.setStatus(key, undefined)` API.
 * 2. Emit the cross-extension `velpari:start` event.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadState } from "../core/state.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { countTraceIssues } from "../core/fingerprints.js";

export function registerSessionStartHook(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		const state = loadState();
		ctx?.ui?.setStatus?.("velpari", undefined);
		// Phase 6 (RTM traceability upgrade): with an open run, surface
		// suspect/orphan trace links in the status bar so stale links are
		// visible without a manual /velpari-doctor run. Never throws —
		// session start must load cleanly regardless.
		try {
			if (state.runId && state.currentStage !== "none") {
				const config = loadFilesConfig();
				const projectName = validateFilesConfig(config) ? config.projectName : "";
				const issues = countTraceIssues(process.cwd(), projectName);
				if (issues !== null && issues > 0) {
					ctx?.ui?.setStatus?.(
						"velpari",
						`stage: ${state.currentStage} | run: ${state.runId} | trace: ${issues} suspect/orphan link(s) — run /velpari-doctor`,
					);
				}
			}
		} catch {
			// best-effort status only
		}
	});

	pi.on("session_start", async (_event) => {
		pi.events?.emit?.("velpari:start", { ts: new Date().toISOString() });
	});
}
