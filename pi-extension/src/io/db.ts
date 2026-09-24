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
// v002 = prose columns ADD COLUMN (Phase 6, decision §14): 14 nullable
// TEXT additions across fr / nfr / prd_section / pseudocode_block /
// test_case / design_module / atomic_function / dev_step.
// ============================================================================

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_V001_DDL, SCHEMA_V002_ADDITIONS, SCHEMA_V003_STORE_META } from "./db-schema.js";
import { PORTFOLIO_USER_VERSION } from "./portfolio-schema.js";
import { applyPortfolioSchema } from "./portfolio.js";
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
	const ctor = requireDriver("node:sqlite").DatabaseSync as new (path: string, options?: object) => DatabaseSync;
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
				throw new Error(`io/db: expected WAL journal mode, got '${mode.journal_mode}'`);
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
	{
		version: 2,
		name: "prose columns — Phase 6 amendment (§14), 14 nullable TEXT additions",
		up: (db: DatabaseSync) => {
			db.exec(SCHEMA_V002_ADDITIONS);
		},
	},
	{
		version: 3,
		name: "store_meta table — Phase 7 doctor bookkeeping (review v1.1 decision 1)",
		up: (db: DatabaseSync) => {
			db.exec(SCHEMA_V003_STORE_META);
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

// ---------------------------------------------------------------------------
// portfolio REGISTRY (Phase 10 — D6 hub-and-spoke; a SECOND SQLite file with
// its own schema module, version ceiling, and pin test — see io/portfolio.ts)
// ---------------------------------------------------------------------------

/**
 * Open (and create if missing) the portfolio REGISTRY database, apply the
 * same production PRAGMA set (RES-2), enforce the registry's OWN G3 ceiling
 * (independent of the store's — review v1.1 gap 5), and apply v001-p when
 * fresh. Writers must checkpoint this connection exactly like a store one
 * (review v1.2 gap 10 — io/portfolio.ts helpers leave that to the caller).
 *
 * @throws Error when the registry's user_version exceeds PORTFOLIO_USER_VERSION
 *         (downgrade protection — "upgrade your extension").
 */
export function openPortfolioDb(dbPath: string): DatabaseSync {
	mkdirSync(dirname(dbPath), { recursive: true });
	const db = new (databaseSyncCtor())(dbPath);
	applyPragmas(db);

	const current = db.prepare("PRAGMA user_version").get() as {
		user_version: number;
	};
	if (current.user_version > PORTFOLIO_USER_VERSION) {
		db.close();
		throw new Error(
			`velpari portfolio registry: database at '${dbPath}' has schema version ${current.user_version}, ` +
				`but this extension supports at most ${PORTFOLIO_USER_VERSION}. ` +
				`Upgrade your extension to open it.`,
		);
	}

	applyPortfolioSchema(db);
	return db;
}

// ---------------------------------------------------------------------------
// store_meta (v003 — Phase 7 doctor bookkeeping)
// ---------------------------------------------------------------------------

/**
 * Upsert one store_meta row. Write side of the doctor's bookkeeping
 * table; called ONLY from the standalone integrity check (the embedded
 * post-publish doctor run must never write — locked decision 1).
 * @param {DatabaseSync} db - Open store connection.
 * @param {string} key - Metadata key (e.g. "integrity_checked_at").
 * @param {string} value - Value to store (ISO timestamp).
 */
export function storeMetaSet(db: DatabaseSync, key: string, value: string): void {
	db.prepare(
		"INSERT INTO store_meta (key, value) VALUES (?, ?) " + "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	).run(key, value);
}

/**
 * Read one store_meta row, or null when unset.
 * @param {DatabaseSync} db - Open store connection.
 * @param {string} key - Metadata key to read.
 * @returns {string | null} The stored value, or null.
 */
export function storeMetaGet(db: DatabaseSync, key: string): string | null {
	const row = db.prepare("SELECT value FROM store_meta WHERE key = ?").get(key) as { value: string } | undefined;
	return row === undefined ? null : row.value;
}
