/**
 * /velpari-db-reset command (F23 — the DB half of the reset split; L3, Phase 2).
 *
 * Thin wrapper around `ops/db-reset.ts:handleDbReset` with ONE extra L3 job:
 * resolving the run when state has no active run (GAP 1) — the picker lists the
 * runs that still hold DRAFT rows, so drafts left behind by `/velpari-reset`
 * stay cleanable. All UI stays in L3 (design rule 8); the op is UI-free.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadState } from "../core/state.js";
import { handleDbReset, listDraftRunsByProject } from "../ops/db-reset.js";
import { runSimplePicker } from "../ui/simple-picker.js";

/**
 * Resolve the run for a DB reset: explicit arg → active run → picker over the
 * runs holding draft rows (undefined when there is nothing to clean).
 * @param {ExtensionContext} ctx - UI context for the picker.
 * @param {string} cwd - Working directory root.
 * @returns {Promise<string | undefined>} runId, or undefined when none applies.
 */
export async function resolveRunIdWithPicker(ctx: ExtensionContext, cwd: string): Promise<string | undefined> {
	const active = (loadState(cwd).runId ?? "").trim();
	if (active !== "") return active;
	const items = listDraftRunsByProject(cwd).flatMap((project) =>
		project.runs.map((run) => ({
			id: run.runId,
			label: run.runId,
			hint: `${project.projectName} · ${run.drafts} draft row(s)`,
		})),
	);
	if (items.length === 0) return undefined;
	return await runSimplePicker(ctx, {
		title: "DB reset — pick run",
		subtitle: "Runs holding draft rows (drafts survive /velpari-reset by design — F23).",
		items,
	});
}

/**
 * Register /velpari-db-reset (F23).
 * @param {ExtensionAPI} pi - The Pi extension API.
 * @returns {void}
 */
export function registerDbResetCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-db-reset", {
		description:
			"DB-only reset: delete one run's DRAFT store rows (published rows and revisions are never touched). Confirms first; audits; takes a pre-reset backup snapshot when the backup subsystem is installed. Usage: /velpari-db-reset [runId]",
		handler: async (args, ctx) => {
			const arg = typeof args === "string" ? args.trim() : "";
			const commandCtx = ctx as unknown as ExtensionContext;
			const runId = arg !== "" ? arg : await resolveRunIdWithPicker(commandCtx, process.cwd());
			if (!runId) {
				commandCtx.ui.notify("No active run and no draft rows to clean — nothing to reset (F23).", "info");
				return;
			}
			await handleDbReset(ctx as never, process.cwd(), runId);
		},
	});
}
