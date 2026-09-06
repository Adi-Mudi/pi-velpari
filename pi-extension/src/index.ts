/**
 * Pi-Velpari extension entry point (Phase E — Pi-native features; Phase 0
 * restructured to layered architecture).
 *
 * Phase 0 moved the per-command wiring into commands/index.ts
 * (registerCommands). The hooks composer scaffold lives in hooks/index.ts
 * (expanded in Phase F). This file now owns:
 *   - Pi lifecycle hooks (session_start rehydrate, session_before_compact,
 *     session_shutdown)
 *   - Cross-extension events (pi.events.emit on the velpari:* channel)
 *   - Keyboard shortcuts (Ctrl+Shift+V / Ctrl+Shift+R)
 *   - CLI flags (--velpari-skip-doctor, --velpari-stage)
 *
 * Verified architecture (commit 1b227bc):
 * - Peer dep: @earendil-works/pi-coding-agent
 * - Entry shape: default export (pi: ExtensionAPI) => { ... }
 * - Compaction hook returns { compaction: { summary, firstKeptEntryId, tokensBefore } }
 *
 * Phase E removed the unverified `PI_SUBAGENT_NAME` guard. AGENTS.md
 * explicitly marked the guard unverified, and Pi's documented guarantee
 * (command namespace isolation) supersedes the defensive check.
 */

import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands/index.js";
import { buildCompactionSummary } from "./core/compaction.js";
import { registerHooks } from "./hooks/index.js";
import { loadState } from "./core/state.js";
import { registerVelpariStatusRenderer } from "./ui/entry-renderer.js";

export default function (pi: ExtensionAPI) {
	// 1. Per-command handlers (25 commands).
	registerCommands(pi);

	// 1a. Lifecycle hooks (Phase 0 scaffold; expanded in Phase F).
	registerHooks(pi);

	// 1b. v0.5.0 Phase I.2: register the custom velpari-status entry
	// renderer (Box+Text via @earendil-works/pi-tui). Without this,
	// Pi uses the default JSON renderer for "velpari-status" entries
	// emitted by discipline/status.ts.
	registerVelpariStatusRenderer(pi);

	// 2. Compaction hook (unchanged from prior phases; uses run-state file).
	pi.on("session_before_compact", async (event) => {
		return {
			compaction: {
				summary: buildCompactionSummary(),
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
			},
		};
	});

	// 2b. Phase F: contribute the project's `skills/` directory as an
	// additional Pi resource path. Pi's auto-discovery may already find
	// this, but the explicit registration documents the contract.
	pi.on("resources_discover", async () => ({
		skillPaths: [join(process.cwd(), "skills")],
	}));

	// 3. Rehydrate state from session entries on session_start (Phase E).
	// Touch the persistence API even when no entries exist, so the
	// extension loads cleanly on a fresh session. v0.5.1 Phase J.2 also
	// clears any leftover velpari status bar from a prior session via
	// the documented `ctx.ui.setStatus(key, undefined)` API.
	pi.on("session_start", async (_event, ctx) => {
		void loadState();
		ctx?.ui?.setStatus?.("velpari", undefined);
	});

	// 4. Cross-extension events on the `velpari:*` channel.
	pi.on("session_start", async (_event) => {
		pi.events?.emit?.("velpari:start", { ts: new Date().toISOString() });
	});
	pi.on("session_before_compact", async (event) => {
		pi.events?.emit?.("velpari:before-compact", {
			reason: event.reason,
			ts: new Date().toISOString(),
		});
	});
	pi.on("session_shutdown", async (event) => {
		pi.events?.emit?.("velpari:shutdown", {
			reason: event.reason,
			ts: new Date().toISOString(),
		});
	});

	// 5. Keyboard shortcuts.
	pi.registerShortcut("ctrl+shift+v", {
		description: "Velpari: show status",
		handler: async () => {
			pi.sendUserMessage("/velpari-status", { expandPromptTemplates: true });
		},
	});
	pi.registerShortcut("ctrl+shift+r", {
		description: "Velpari: reset current run",
		handler: async () => {
			pi.sendUserMessage("/velpari-reset", { expandPromptTemplates: true });
		},
	});

	// 6. CLI flags.
	pi.registerFlag("velpari-skip-doctor", {
		description: "Skip doctor checks during stage approval",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("velpari-stage", {
		description: "Override current stage (testing)",
		type: "string",
	});
}
