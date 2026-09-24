// ============================================================================
// ops/portfolio.ts — portfolio registry sync/repair (Layer 1, Phase 10)
// ============================================================================
// Decision record §15.5 (D6 hub-and-spoke; Q5 metadata-only). The registry
// (Doc/store/portfolio.db) is DERIVED state: every write is a pure function
// of the spokes' newest published envelopes, so sync is idempotent and
// drift self-corrects (the rollback path re-runs repair best-effort).
//
// Registry G1 (review v1.2 gap 10): EVERY registry write ends with
// checkpointNow (PRAGMA wal_checkpoint(TRUNCATE)) — the committed
// portfolio.db must never trail its git-ignored WAL. Checkpoint failure is
// FAIL-OPEN: recorded in the returned report, never thrown (R2 — a registry
// problem must never block a publish).
//
// Sync order (review v1.3): db-publish calls this PRE-commit so the
// registry joins the same commit it describes; on the Q6d failure path it
// is re-run best-effort in step 8.
// ============================================================================

import { existsSync, readdirSync } from "node:fs";
import { relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openPortfolioDb, openStoreDb, closeStoreDb } from "../io/db.js";
import { buildPortfolioDbPath } from "../core/paths.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { listProjects, removeProject, syncProject } from "../io/portfolio.js";
import { checkpointNow } from "../io/store.js";

/** One sync/repair step outcome (human-readable — notify/report verbatim). */
export interface PortfolioChange {
	kind: "added" | "updated" | "removed" | "warning";
	projectName: string;
	detail: string;
}

/** syncPortfolioRegistry / repairPortfolioRegistry result. */
export interface PortfolioSyncResult {
	ok: boolean;
	changes: PortfolioChange[];
	/** True when ANY change carried kind "warning" (fail-open failures). */
	hasWarnings: boolean;
}

/**
 * Read the newest published envelope of one spoke DB (or null when the DB
 * is absent or has no published rows). Opens read-only in spirit — never
 * writes to spokes.
 */
function readSpokeMeta(spokeDbPath: string): {
	lastPublishedAt: string | null;
	lastRunId: string | null;
	lastStage: string | null;
} | null {
	if (!existsSync(spokeDbPath)) return null;
	let db: DatabaseSync | null = null;
	try {
		// The spoke IS a store DB — same opener, same pragmas. Never writes.
		db = openStoreDb(spokeDbPath);
		const row = db
			.prepare(
				"SELECT run_id, stage, generated_at FROM artifacts WHERE status = 'published' ORDER BY generated_at DESC LIMIT 1",
			)
			.get() as { run_id: string; stage: string; generated_at: string } | undefined;
		if (!row) return { lastPublishedAt: null, lastRunId: null, lastStage: null };
		return { lastPublishedAt: row.generated_at, lastRunId: row.run_id, lastStage: row.stage };
	} catch {
		return null;
	} finally {
		if (db) closeStoreDb(db);
	}
}

/**
 * Sync the registry from the spokes (idempotent, fail-open). Called by the
 * publish chain (pre-commit) and by /velpari-portfolio --repair.
 *
 * Spoke enumeration: every per-project index.db under Doc/store (the dir
 * name IS the projectName). Registry rows whose db_path no longer exists
 * are removed (orphans); spokes missing from the registry are added;
 * existing rows refreshed.
 *
 * @param {string} cwd - Project root.
 * @returns {PortfolioSyncResult} Changes + warnings (never throws).
 */
export function syncPortfolioRegistry(cwd: string): PortfolioSyncResult {
	const changes: PortfolioChange[] = [];
	const registryPath = buildPortfolioDbPath(cwd);

	// displayName: files.json projectName when valid, else dir-name fallback
	// (review v1.3 minor 5) — resolved per project below.
	let configuredName: string | null = null;
	try {
		const cfg = loadFilesConfig(cwd);
		if (validateFilesConfig(cfg) && cfg.projectName) configuredName = cfg.projectName;
	} catch {
		// No config → fallback names only.
	}

	try {
		const db = openPortfolioDb(registryPath);
		try {
			// 1. Enumerate spokes.
			const storeDir = `${cwd}/Doc/store`;
			const spokeNames = existsSync(storeDir)
				? readdirSync(storeDir, { withFileTypes: true })
						.filter((e) => e.isDirectory() && existsSync(`${storeDir}/${e.name}/index.db`))
						.map((e) => e.name)
						.sort()
				: [];
			const spokeSet = new Set(spokeNames);

			// 2. Upsert every spoke.
			for (const name of spokeNames) {
				const spokePath = `${storeDir}/${name}/index.db`;
				const meta = readSpokeMeta(spokePath);
				const before = listProjects(db).find((p) => p.projectName === name);
				syncProject(db, {
					projectName: name,
					dbPath: relative(cwd, spokePath),
					displayName: configuredName === name ? configuredName : name,
					lastPublishedAt: meta?.lastPublishedAt ?? null,
					lastRunId: meta?.lastRunId ?? null,
					lastStage: meta?.lastStage ?? null,
				});
				if (!before) {
					changes.push({ kind: "added", projectName: name, detail: relative(cwd, spokePath) });
				} else if (
					before.lastPublishedAt !== (meta?.lastPublishedAt ?? null) ||
					before.lastRunId !== (meta?.lastRunId ?? null) ||
					before.dbPath !== relative(cwd, spokePath)
				) {
					changes.push({ kind: "updated", projectName: name, detail: "refreshed from spoke" });
				}
			}

			// 3. Remove registry rows whose spoke vanished (orphans).
			for (const row of listProjects(db)) {
				if (!spokeSet.has(row.projectName)) {
					removeProject(db, row.projectName);
					changes.push({ kind: "removed", projectName: row.projectName, detail: `spoke gone: ${row.dbPath}` });
				}
			}

			// 4. Registry G1 — checkpoint before returning (fail-open).
			try {
				checkpointNow(db);
			} catch (err) {
				changes.push({
					kind: "warning",
					projectName: "(registry)",
					detail: `wal_checkpoint failed (registry may trail its WAL): ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		} finally {
			closeStoreDb(db);
		}
	} catch (err) {
		changes.push({
			kind: "warning",
			projectName: "(registry)",
			detail: `registry sync failed (fail-open): ${err instanceof Error ? err.message : String(err)}`,
		});
	}

	return {
		ok: !changes.some((c) => c.kind === "warning"),
		changes,
		hasWarnings: changes.some((c) => c.kind === "warning"),
	};
}

/**
 * Full resync (adds missing, removes orphans, refreshes stale). Today the
 * sync IS the repair (one derived-state pass does all three); the alias
 * exists so the command surface and future policies can diverge without a
 * call-site change.
 * @param {string} cwd - Project root.
 * @returns {PortfolioSyncResult} Same as syncPortfolioRegistry.
 */
export function repairPortfolioRegistry(cwd: string): PortfolioSyncResult {
	return syncPortfolioRegistry(cwd);
}
