// ============================================================================
// io/db.ts — SQLite store connection factory (Layer 0, DB-primary storage)
// ============================================================================
// Decision record: .IDE_Plans/velpari-storage-traceability_decision-record_*_v1.0.md
//   RES-2 — driver = node:sqlite (built-in, zero deps), WAL, foreign_keys=ON,
//           synchronous=NORMAL, busy_timeout, STRICT tables (at DDL level),
//           local file per project (silo pattern).
//   D9    — this is the ONLY module allowed to import `node:sqlite`; a future
//           driver swap touches this file alone.
//   G3    — downgrade protection: refuse to open a DB written by a newer
//           extension (user_version > highest registered migration).
//
// Storage location (G10, LOCKED): Doc/store/<projectName>/index.db — path
// helpers live in core/paths.ts (buildStoreDbPath); openStoreDb stays
// path-agnostic.
//
// Migrations: sequential, forward-only, stamped via PRAGMA user_version
// (§11 governance). v000 = identity (verifies PRAGMA set, creates nothing).
// v001 = core schema DDL (io/db-schema.ts): metadata envelope + 9 §5
// row-sets + links adjacency (Phase 2).
// ============================================================================

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_V001_DDL } from "./db-schema.js";
import type { DatabaseSync } from "node:sqlite";

// Lazy driver load (D9): `node:sqlite` is experimental and prints an
// ExperimentalWarning to stderr the moment the module is FIRST loaded.
// Loading it eagerly here would poison every consumer's stderr on import
// (e.g. RPC bash-channel e2e scripts parse stdout+stderr as JSON). The
// driver is therefore required on first `openStoreDb` call instead —
// import-only consumers never trigger the warning.
const requireDriver = createRequire(import.meta.url);
let cachedCtor: (new (path: string, options?: object) => DatabaseSync) | undefined;
/**
 * Resolve the node:sqlite DatabaseSync constructor on first DB open (lazy).
 * @returns {new (path: string, options?: object) => DatabaseSync} The driver ctor.
 */
function databaseSyncCtor(): new (path: string, options?: object) => DatabaseSync {
	if (cachedCtor !== undefined) return cachedCtor;
	const ctor = requireDriver("node:sqlite").DatabaseSync as new (
		path: string,
		options?: object,
	) => DatabaseSync;
	cachedCtor = ctor;
	return ctor;
}

/** A single forward-only migration step. */
export interface Migration {
	/** Target PRAGMA user_version after this migration runs (strictly sequential). */
	version: number;
	/** Human-readable name for logs/audits. */
	name: string;
	/** Applies the migration inside the caller's transaction. */
	up: (db: DatabaseSync) => void;
}

/**
 * Ordered migration list. v000 is the identity migration: it only proves the
 * connection's PRAGMA configuration is live. Never reorder or edit an
 * applied migration — append new steps with increasing versions (forward-only).
 */
export const MIGRATIONS: readonly Migration[] = [
	{
		version: 0,
		name: "identity — PRAGMA verification, no DDL",
		up: (db: DatabaseSync) => {
			const mode = db.prepare("PRAGMA journal_mode").get() as {
				journal_mode: string;
			};
			if (mode.journal_mode !== "wal") {
				throw new Error(
					`io/db: expected WAL journal mode, got '${mode.journal_mode}'`,
				);
			}
		},
	},
	{
		version: 1,
		name: "core schema — metadata envelope, 9 artifact row-sets, links adjacency",
		up: (db: DatabaseSync) => {
			db.exec(SCHEMA_V001_DDL);
		},
	},
];

/** Highest migration version known to this build (for the G3 downgrade guard). */
export function maxKnownVersion(): number {
	return MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
}

/** Production PRAGMA set per RES-2. Applied on every open, before any use. */
function applyPragmas(db: DatabaseSync): void {
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA foreign_keys = ON;");
	db.exec("PRAGMA synchronous = NORMAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
}

/**
 * Open (and create if missing) the store database at `dbPath`, apply the
 * production PRAGMA set, run pending migrations, and enforce G3.
 *
 * @throws Error when the DB's user_version exceeds maxKnownVersion()
 *         (downgrade protection — "upgrade your extension").
 */
export function openStoreDb(dbPath: string): DatabaseSync {
	mkdirSync(dirname(dbPath), { recursive: true });
	const db = new (databaseSyncCtor())(dbPath); // strict: false default; STRICT is per-DDL
	applyPragmas(db);

	const current = db.prepare("PRAGMA user_version").get() as {
		user_version: number;
	};
	const at = current.user_version;

	// G3 — downgrade protection: a DB from a newer extension must never be
	// opened by an older binary (schema drift can misbehave or corrupt).
	if (at > maxKnownVersion()) {
		db.close();
		throw new Error(
			`velpari store: database at '${dbPath}' has schema version ${at}, ` +
				`but this extension supports at most ${maxKnownVersion()}. ` +
				`Upgrade your extension to open it.`,
		);
	}

	migrate(db);
	return db;
}

/** Run pending migrations sequentially, each in its own transaction. */
export function migrate(db: DatabaseSync): void {
	const current = db.prepare("PRAGMA user_version").get() as {
		user_version: number;
	};
	let at = current.user_version;

	for (const migration of MIGRATIONS) {
		if (migration.version <= at) continue;
		db.exec("BEGIN IMMEDIATE;");
		try {
			migration.up(db);
			// PRAGMA statements cannot take bound parameters in SQLite —
			// interpolate the internal version number (always an integer
			// literal from MIGRATIONS, never user input).
			db.exec(`PRAGMA user_version = ${migration.version}`);
			db.exec("COMMIT;");
			at = migration.version;
		} catch (err) {
			db.exec("ROLLBACK;");
			throw err;
		}
	}
}

/** Close cleanly: checkpoint WAL into the main DB file, then close. */
export function closeStoreDb(db: DatabaseSync): void {
	try {
		db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
	} finally {
		db.close();
	}
}
