/**
 * /velpari-reset handler (FR-10; Phase 2 split — F23).
 *
 * Orchestration ONLY: confirms, clears the run state + history, and (N13) can
 * clear a confirmed STALE run lock. No store DB is opened for draft data and no
 * artifact/revision row is read or written — the one DB effect is the reset
 * audit row per existing project store (D1 option (a): the chained
 * `audit_ledger` is the single audit sink). Draft cleanup lives in the separate
 * `/velpari-db-reset` command.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { clearRun, loadState } from "../core/state.js";
import { clearStaleRunLock, readLockStatus } from "../io/run-lock.js";
import { auditResetEvent } from "./db-reset.js";

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
			`state.json and the run's history are cleared. NO store DB row is touched — ` +
			`use /velpari-db-reset to delete this run's draft rows (published rows and revisions always stay).`,
	);
	if (!confirmed) {
		ctx.ui.notify("Reset cancelled.", "info");
		return;
	}

	// N13 — a stale run lock (dead holder / old heartbeat) is cleared only here,
	// only after an explicit confirmation, and always with an audit event.
	const runId = state.runId;
	let clearedStaleLock = false;
	const lock = readLockStatus(cwd);
	if (lock.stale) {
		clearedStaleLock = await ctx.ui.confirm(
			"Stale run lock found",
			`The run lock is held by an inactive holder (pid ${lock.holder?.pid ?? "?"}, ` +
				`command ${lock.holder?.command ?? "?"}, heartbeat ${lock.holder?.heartbeatAt ?? "?"}). ` +
				"Clear it as part of this reset? The clearing is recorded in the store audit ledger.",
		);
		if (clearedStaleLock) {
			clearedStaleLock = clearStaleRunLock(cwd);
		}
	}

	clearRun(cwd);
	// F17 — the reset itself is audited (who/what/when/why), one row per store DB.
	const warnings = auditResetEvent(cwd, runId, {
		staleLockCleared: clearedStaleLock,
		holder: lock.holder ? { pid: lock.holder.pid, command: lock.holder.command } : null,
	});
	ctx.ui.notify(
		`Run ${runId} reset. State is now empty. No store DB rows were touched ` +
			`(draft cleanup: /velpari-db-reset).` +
			(clearedStaleLock ? " Stale run lock cleared (audited)." : ""),
		"info",
	);
	for (const warning of warnings) ctx.ui.notify(warning, "warning");
}
