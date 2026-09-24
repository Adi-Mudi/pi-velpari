/**
 * /velpari-reset handler (FR-10).
 *
 * Destructive: confirms with the user before discarding the current
 * run state. On confirm, calls clearRun(cwd) and notifies.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { clearRun, loadState } from "../core/state.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { getEffectiveProjectNames } from "../core/projectnames.js";
import { buildStoreDbPath } from "../core/paths.js";
import { existsSync } from "node:fs";
import { openStoreDb, closeStoreDb } from "../io/db.js";
import { deleteRunDrafts } from "../io/store.js";

export async function handleReset(ctx: ExtensionCommandContext, cwd: string = process.cwd()): Promise<void> {
	const state = loadState(cwd);
	if (state.currentStage === "none") {
		ctx.ui.notify("No active run to reset.", "info");
		return;
	}

	const confirmed = await ctx.ui.confirm(
		"Reset run?",
		`Discard run ${state.runId} (mission: ${state.mission || "(none)"})? ` +
			`Working copies in .IDE_Plans/velpari/runs/${state.runId}/ will remain on disk; ` +
			`state.json and the run's history are cleared, and the run's DRAFT store rows are deleted ` +
			`(published rows stay — append-only history).`,
	);
	if (!confirmed) {
		ctx.ui.notify("Reset cancelled.", "info");
		return;
	}

	// Q2 (Phase 8) — delete the run's DRAFT store rows BEFORE clearRun:
	// clearRun wipes state.json, and with it the runId the cleanup needs.
	// Order (locked): capture runId → delete drafts per project DB →
	// clearRun → notify with the count. Multi-design: one DB per
	// projectName; per-DB try/catch — a missing/corrupt DB never wedges
	// the state reset.
	let draftsDeleted = 0;
	const runId = state.runId;
	try {
		const cfg = loadFilesConfig(cwd);
		if (validateFilesConfig(cfg)) {
			for (const projectName of getEffectiveProjectNames(cfg)) {
				const dbPath = buildStoreDbPath(projectName, cwd);
				if (!existsSync(dbPath)) continue;
				try {
					const db = openStoreDb(dbPath);
					try {
						draftsDeleted += deleteRunDrafts(db, runId);
					} finally {
						closeStoreDb(db);
					}
				} catch (err) {
					ctx.ui.notify(
						`Store draft cleanup failed for ${projectName} (state reset continues): ` +
							`${err instanceof Error ? err.message : String(err)}`,
						"warning",
					);
				}
			}
		}
	} catch {
		// Config missing/invalid — skip DB cleanup silently; state reset proceeds.
	}

	clearRun(cwd);
	ctx.ui.notify(
		`Run ${runId} reset. State is now empty.` +
			(draftsDeleted > 0 ? ` ${draftsDeleted} draft store row(s) deleted.` : "") +
			// Phase 11 (§15.6): migration-aware note — published rows
			// (including the one-time migration's run 'migrated' rows)
			// survive a reset; only the reset run's DRAFT rows are deleted.
			` Published store rows (including run 'migrated') stay.`,
		"info",
	);
}
