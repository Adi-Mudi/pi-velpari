// ============================================================================
// ops/db-reset.ts — DB-only reset (Layer 1, Phase 2, F23)
// ============================================================================
// Decision record: .IDE_Plans/velpari-versioning-locking-recovery_discussion_*_v1.0.md
//   F23 — the reset split: /velpari-reset is orchestration only, THIS command
//         is the DB half. Drafts only; published rows and every published
//         revision stay untouched. Confirm first + write an audit event.
//   F16 — a published revision can never be removed by a reset.
//   N9  — the pre-reset backup trigger: createBackupSnapshot({trigger:"db-reset"})
//         runs BEFORE any delete (a no-op until Phase 3 installs the real one).
//   F17/F18 — the reset is audited per store DB (who/what/when/why + tx entry).
//
// GAP 1 (phase-2 review): the run is resolved as arg → active run, so drafts
// left behind by a previous `/velpari-reset` stay cleanable. The L3 command
// resolves the run through a picker over `listDraftRunsByProject` when state
// has no run.
//
// GAP 1 + rule 11: this module never invents a run and never touches state.json.
// ============================================================================

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { createBackupSnapshot } from "../core/backup.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { buildStoreDbPath } from "../core/paths.js";
import { getEffectiveProjectNames } from "../core/projectnames.js";
import { loadState } from "../core/state.js";
import { closeStoreDb, openStoreDb } from "../io/db.js";
import { appendAuditEntry, appendTxEntry, checkpointNow, deleteRunDrafts } from "../io/store.js";
import { commitProtectionChange, countRunDrafts, listDraftRuns } from "./protection.js";

/** Draft counts for one project store. */
export interface DbResetCounts {
	projectName: string;
	dbPath: string;
	drafts: number;
}

/** Result of one /velpari-db-reset attempt. */
export interface DbResetResult {
	cancelled: boolean;
	deleted: number;
	perProject: DbResetCounts[];
}

/** Existing project store DBs, with the draft count for one run (read-only). */
function projectTargets(cwd: string, runId: string): DbResetCounts[] {
	const targets: DbResetCounts[] = [];
	let projectNames: string[] = [];
	try {
		const cfg = loadFilesConfig(cwd);
		if (!validateFilesConfig(cfg)) return [];
		projectNames = getEffectiveProjectNames(cfg);
	} catch {
		return [];
	}
	for (const projectName of projectNames) {
		const dbPath = buildStoreDbPath(projectName, cwd);
		if (!existsSync(dbPath)) continue;
		try {
			const db = openStoreDb(dbPath);
			try {
				targets.push({ projectName, dbPath, drafts: countRunDrafts(db, runId) });
			} finally {
				closeStoreDb(db);
			}
		} catch {
			// An unreadable DB is reported by the caller's per-project loop, not here.
			targets.push({ projectName, dbPath, drafts: -1 });
		}
	}
	return targets;
}

/**
 * Read-only: per existing project DB, the runs holding DRAFT rows + counts
 * (GAP 1 — the L3 run picker; the UI itself stays in commands/db-reset.ts).
 * @returns {{ projectName: string; dbPath: string; runs: { runId: string; drafts: number }[] }[]}
 */
export function listDraftRunsByProject(
	cwd: string,
): { projectName: string; dbPath: string; runs: { runId: string; drafts: number }[] }[] {
	const out: { projectName: string; dbPath: string; runs: { runId: string; drafts: number }[] }[] = [];
	let projectNames: string[] = [];
	try {
		const cfg = loadFilesConfig(cwd);
		if (!validateFilesConfig(cfg)) return out;
		projectNames = getEffectiveProjectNames(cfg);
	} catch {
		return out;
	}
	for (const projectName of projectNames) {
		const dbPath = buildStoreDbPath(projectName, cwd);
		if (!existsSync(dbPath)) continue;
		try {
			const db = openStoreDb(dbPath);
			try {
				out.push({ projectName, dbPath, runs: listDraftRuns(db) });
			} finally {
				closeStoreDb(db);
			}
		} catch {
			// Unreadable DB → skipped (the reset path reports it).
		}
	}
	return out;
}

/**
 * Record a reset audit event (F17) in every existing project store: one
 * `audit_ledger` row + one commit tx entry per DB, WAL-checkpointed. Used by
 * `/velpari-reset` (D1 option (a): the audit ledger is the single chained
 * sink). Never throws — failures come back as warnings.
 * @param {string} cwd - Project root.
 * @param {string} runId - The run being reset (kept in the audit detail).
 * @param {Record<string, unknown>} detail - Extra who/what context (stale lock, …).
 * @returns {string[]} Warnings (empty = recorded everywhere it could be).
 */
export function auditResetEvent(cwd: string, runId: string, detail: Record<string, unknown>): string[] {
	const warnings: string[] = [];
	const projectNames = projectNamesOf(cwd);
	if (projectNames.length === 0) {
		return ["no files.json project names — the reset audit event could not be recorded"];
	}
	let recorded = 0;
	for (const projectName of projectNames) {
		const dbPath = buildStoreDbPath(projectName, cwd);
		if (!existsSync(dbPath)) continue;
		try {
			const db = openStoreDb(dbPath);
			try {
				appendAuditEntry(db, {
					actor: "velpari-reset",
					action: "reset",
					reason: "orchestration reset (state + history only)",
					detail: { runId, ...detail },
				});
				appendTxEntry(db, { actor: "velpari-reset", operation: "reset", outcome: "commit" });
				checkpointNow(db);
				recorded += 1;
			} finally {
				closeStoreDb(db);
			}
		} catch (err) {
			warnings.push(
				`reset audit event for "${projectName}" failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
	if (recorded === 0) warnings.push("no store DB exists — the reset audit event was recorded nowhere");
	return warnings;
}

/** Configured project names (empty when files.json is missing/invalid). */
function projectNamesOf(cwd: string): string[] {
	try {
		const cfg = loadFilesConfig(cwd);
		return validateFilesConfig(cfg) ? getEffectiveProjectNames(cfg) : [];
	} catch {
		return [];
	}
}

/**
 * `/velpari-db-reset` handler (F23 + N9 + GAP 1).
 *
 * Flow: resolve the run (arg → active run; the L3 command supplies a picked id)
 * → read-only draft counts per project DB → ONE confirmation → per DB: backup
 * trigger (N9) → delete the run's DRAFT rows → audit + tx entry → checkpoint.
 * State is never touched, published rows/revisions are never touched, and the
 * command is reachable only through the confirmed slash command.
 *
 * @param {ExtensionCommandContext} ctx - UI context (confirm + notify).
 * @param {string} cwd - Project root (defaults to process.cwd()).
 * @param {string} runIdArg - Run resolved by the caller (L3 picker or arg).
 * @returns {Promise<void>} Notifies the outcome; never throws.
 */
export async function handleDbReset(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
	runIdArg?: string,
): Promise<void> {
	const state = loadState(cwd);
	const runId = (runIdArg ?? "").trim() !== "" ? (runIdArg as string).trim() : (state.runId ?? "").trim();
	if (runId === "") {
		ctx.ui.notify(
			"No run id available — run /velpari-db-reset <runId>, or pick one of the runs holding drafts.\n" +
				"Draft rows survive /velpari-reset by design (F23), so they can always be cleaned afterwards.",
			"info",
		);
		return;
	}

	const targets = projectTargets(cwd, runId);
	if (targets.length === 0) {
		ctx.ui.notify("No store DB for this project yet — nothing to reset.", "info");
		return;
	}
	const total = targets.reduce((sum, target) => sum + Math.max(0, target.drafts), 0);
	const detail = targets.map((target) => `${target.projectName}=${target.drafts}`).join(", ");
	const confirmed = await ctx.ui.confirm(
		"Reset the store DB?",
		`DB reset for run ${runId}: delete ${total} DRAFT row(s) (${detail}).\n` +
			"Published artifacts and every published revision stay untouched — this can never remove published " +
			"content (F16/F23). A pre-reset snapshot is attempted first (N9).",
	);
	if (!confirmed) {
		ctx.ui.notify("DB reset cancelled — nothing changed.", "info");
		return;
	}

	let deleted = 0;
	const perProject: DbResetCounts[] = [];
	const warnings: string[] = [];
	const touchedPaths: string[] = [];
	for (const target of targets) {
		try {
			const backup = createBackupSnapshot({
				cwd,
				projectName: target.projectName,
				trigger: "db-reset",
				dbPath: target.dbPath,
			});
			if (backup) {
				// Phase 3 returns a repo-relative path + the N11 self-test result;
				// the Foundation no-op returns null, so nothing is reported yet.
				const selfTest = backup.quickCheckOk === null ? "not run" : backup.quickCheckOk ? "ok" : "FAILED";
				warnings.push(`pre-reset backup: ${backup.backupPath} (quick_check: ${selfTest})`);
			}
			const db = openStoreDb(target.dbPath);
			try {
				const removed = deleteRunDrafts(db, runId);
				appendAuditEntry(db, {
					actor: "velpari-db-reset",
					action: "db-reset",
					reason: `removed ${removed} draft row(s) for run ${runId}`,
					detail: { runId, projectName: target.projectName, deletedDrafts: removed },
				});
				appendTxEntry(db, { actor: "velpari-db-reset", operation: "db-reset", outcome: "commit" });
				checkpointNow(db);
				deleted += removed;
				perProject.push({ ...target, drafts: removed });
				touchedPaths.push(target.dbPath);
			} finally {
				closeStoreDb(db);
			}
		} catch (err) {
			warnings.push(
				`draft cleanup failed for "${target.projectName}" (other projects continue): ` +
					`${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	if (touchedPaths.length > 0) {
		warnings.push(
			...commitProtectionChange({
				cwd,
				projectName: perProject.map((entry) => entry.projectName).join(", "),
				paths: touchedPaths,
				message: `velpari(db-reset): ${perProject.map((entry) => entry.projectName).join(", ")} (run ${runId})`,
			}),
		);
	}

	ctx.ui.notify(
		`DB reset for run ${runId}: ${deleted} draft row(s) deleted ` +
			`(${perProject.map((entry) => `${entry.projectName}=${entry.drafts}`).join(", ") || "none"}). ` +
			"Published rows and revisions kept. State is unchanged — use /velpari-reset for the orchestration half.",
		"info",
	);
	for (const warning of warnings) ctx.ui.notify(warning, warning.startsWith("pre-reset backup:") ? "info" : "warning");
}
