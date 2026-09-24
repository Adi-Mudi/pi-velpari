// ============================================================================
// io/portfolio.ts — portfolio REGISTRY API (Layer 0, Phase 10)
// ============================================================================
// Decision record §15.5 (D6 hub-and-spoke, Q5 metadata-only narrowing).
// The registry is a SECOND SQLite file (Doc/store/portfolio.db) with its own
// schema module (io/portfolio-schema.ts) and version ceiling — the store's
// migrations/pins are untouched. Metadata only (user-locked): project name,
// db path, display name, last publish/run/stage. No artifact rollups.
//
// Writers are code-only (Phase 8 store-scope lock covers Doc/store/**):
// publish-chain sync (ops/db-publish.ts step 7b), /velpari-portfolio --repair,
// and the doctor's reads. Every WRITE ends with checkpointNow (review v1.2
// gap 10 — G1 for the registry: the committed portfolio.db must never trail
// its git-ignored WAL); checkpoint failure is fail-open (warning semantics
// belong to the caller).
// ============================================================================

import type { DatabaseSync } from "node:sqlite"; // type-only: driver stays behind io/db.ts (D9)
import { PORTFOLIO_SCHEMA_V001_DDL } from "./portfolio-schema.js";

/** File name of the registry inside Doc/store/ (user-locked home). */
export const PORTFOLIO_DB_FILENAME = "portfolio.db";

/** One registry row — mirrors the projects table 1:1 (camelCase). */
export interface PortfolioProject {
	projectName: string;
	displayName: string | null;
	dbPath: string;
	lastPublishedAt: string | null;
	lastRunId: string | null;
	lastStage: string | null;
}

/** syncProject input — the upsert payload (repo-relative dbPath). */
export interface PortfolioProjectInput {
	projectName: string;
	dbPath: string;
	displayName?: string | null;
	lastPublishedAt?: string | null;
	lastRunId?: string | null;
	lastStage?: string | null;
}

/**
 * Open-and-migrate helper for the REGISTRY DB — runs the v001-p DDL when the
 * file is fresh. The caller (io/db.ts:openPortfolioDb) applies pragmas + the
 * G3 guard; this function only stamps schema content. Kept here so the DDL
 * and its application stay in one module family.
 * @param {DatabaseSync} db - Fresh registry connection (pragmas already applied).
 */
export function applyPortfolioSchema(db: DatabaseSync): void {
	const current = db.prepare("PRAGMA user_version").get() as { user_version: number };
	if (current.user_version >= 1) return;
	db.exec("BEGIN IMMEDIATE;");
	try {
		db.exec(PORTFOLIO_SCHEMA_V001_DDL);
		db.exec("PRAGMA user_version = 1");
		db.exec("COMMIT;");
	} catch (err) {
		try {
			db.exec("ROLLBACK;");
		} catch {
			// Txn already closed — the original error is the one that matters.
		}
		throw err;
	}
}

/**
 * Upsert one project row (idempotent). Does NOT checkpoint — callers that
 * mutate should call the write wrapper below (or checkpointNow themselves).
 * @param {DatabaseSync} db - Open REGISTRY connection.
 * @param {PortfolioProjectInput} input - Project metadata to upsert.
 */
export function syncProject(db: DatabaseSync, input: PortfolioProjectInput): void {
	db.prepare(
		`INSERT INTO projects (project_name, display_name, db_path, last_published_at, last_run_id, last_stage)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(project_name) DO UPDATE SET
		   display_name = excluded.display_name,
		   db_path = excluded.db_path,
		   last_published_at = excluded.last_published_at,
		   last_run_id = excluded.last_run_id,
		   last_stage = excluded.last_stage`,
	).run(
		input.projectName,
		input.displayName ?? null,
		input.dbPath,
		input.lastPublishedAt ?? null,
		input.lastRunId ?? null,
		input.lastStage ?? null,
	);
}

/**
 * Remove one project row. No-op when absent (idempotent).
 * @param {DatabaseSync} db - Open REGISTRY connection.
 * @param {string} projectName - Row to remove.
 * @returns {boolean} true when a row was deleted.
 */
export function removeProject(db: DatabaseSync, projectName: string): boolean {
	const result = db.prepare("DELETE FROM projects WHERE project_name = ?").run(projectName);
	return Number(result.changes) > 0;
}

/**
 * List all registry rows ordered by project_name (deterministic, G5-style).
 * @param {DatabaseSync} db - Open REGISTRY connection.
 * @returns {PortfolioProject[]} All rows (empty registry → []).
 */
export function listProjects(db: DatabaseSync): PortfolioProject[] {
	const rows = db
		.prepare(
			"SELECT project_name, display_name, db_path, last_published_at, last_run_id, last_stage FROM projects ORDER BY project_name",
		)
		.all() as Record<string, unknown>[];
	return rows.map((r) => ({
		projectName: String(r.project_name),
		displayName: r.display_name === null || r.display_name === undefined ? null : String(r.display_name),
		dbPath: String(r.db_path),
		lastPublishedAt:
			r.last_published_at === null || r.last_published_at === undefined ? null : String(r.last_published_at),
		lastRunId: r.last_run_id === null || r.last_run_id === undefined ? null : String(r.last_run_id),
		lastStage: r.last_stage === null || r.last_stage === undefined ? null : String(r.last_stage),
	}));
}
