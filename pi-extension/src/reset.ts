/**
 * /velpari-reset handler (FR-10).
 *
 * Destructive: confirms with the user before discarding the current
 * run state. On confirm, calls clearRun(cwd) and notifies.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { clearRun, loadState } from "./state.js";

export async function handleReset(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const state = loadState(cwd);
	if (state.currentStage === "none") {
		ctx.ui.notify("No active run to reset.", "info");
		return;
	}

	const confirmed = await ctx.ui.confirm(
		"Reset run?",
		`Discard run ${state.runId} (mission: ${state.mission || "(none)"})? ` +
			`Working copies in .IDE_Plans/velpari/runs/${state.runId}/ will remain on disk; ` +
			`only state.json is cleared.`,
	);
	if (!confirmed) {
		ctx.ui.notify("Reset cancelled.", "info");
		return;
	}

	clearRun(cwd);
	ctx.ui.notify(`Run ${state.runId} reset. State is now empty.`, "info");
}
