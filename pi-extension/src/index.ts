/**
 * Pi-Velpari extension entry point — composition root (wiring only).
 *
 * Official 4-layer architecture (see src/layers.ts):
 *   L0 domain (core/, io/) → L1 stage logic (stages/, ops/, doctor/, view/)
 *   → L2 presentation (ui/, hooks/) → L3 composition (commands/, this file).
 *
 * This file owns only:
 *   - registerCommands(pi)  — 25 slash commands (commands/, L3)
 *   - registerHooks(pi)     — Pi lifecycle hooks, one file per event (hooks/, L2)
 *   - registerVelpariStatusRenderer(pi) — velpari-status entry renderer (ui/, L2)
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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands/index.js";
import { registerHooks } from "./hooks/index.js";
import { registerBrainstormSessionTool } from "./stages/brainstorm-state-tool.js";
import { registerFeasibilitySessionTool } from "./stages/feasibility-session-tool.js";
import { registerStagePublishTool } from "./stages/stage-publish-tool.js";
import { registerVelpariStatusRenderer } from "./ui/entry-renderer.js";

export default function (pi: ExtensionAPI) {
	// 1. Per-command handlers (25 commands).
	registerCommands(pi);

	// 1a. Lifecycle hooks (one file per event under hooks/).
	registerHooks(pi);

	// 1b. Brainstorm session tool (velpari_brainstorm_session) — the
	// LLM-callable bridge to the brainstorm state helpers in core/state.ts.
	registerBrainstormSessionTool(pi);

	// 1c. Feasibility session tool (velpari_feasibility_session) — the
	// LLM-callable bridge to the feasibility v2 session in core/state.ts.
	registerFeasibilitySessionTool(pi);

	// 1c-bis. Stage publish tool (velpari_stage_publish) — the LLM-callable
	// bridge used by the stage skills' preview-yes branch to run the same
	// publish logic as the publish tool (one-command stage publish).
	registerStagePublishTool(pi);

	// 1b. v0.5.0 Phase I.2: register the custom velpari-status entry
	// renderer (Box+Text via @earendil-works/pi-tui). Without this,
	// Pi uses the default JSON renderer for "velpari-status" entries
	// emitted by ops/status.ts.
	registerVelpariStatusRenderer(pi);

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
