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
// v003 = store_meta table (Phase 7 doctor bookkeeping).
// v004 = revision model + audit core (Foundation, 2026-09-27):
// artifact_revisions snapshots, baselines, hash-chained audit_ledger +
// tx_log, artifacts.head_revision_id/frozen/freeze_reason.
// v005 = dev lanes (Phase 7, 2026-09-27): dev_lane + dev_lane_xdep —
// the Stage 9 execution-lane map and its recorded integration points.
// v006 = soft-lock (Phase B, 2026-09-28): artifact_revisions.locked_at /
// locked_by — the downstream-consumption marker (N19/N20): content writes
// to a locked revision are refused (L1 guard), status updates stay audited.
// ============================================================================

import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
	SCHEMA_V001_DDL,
	SCHEMA_V002_ADDITIONS,
	SCHEMA_V003_STORE_META,
	SCHEMA_V004_REVISION_MODEL,
	SCHEMA_V005_DEV_LANES,
	SCHEMA_V006_LOCKING,
	SCHEMA_V007_RTM_NFR,
} from "./db-schema.js";
import { PORTFOLIO_USER_VERSION } from "./portfolio-schema.js";
import { applyPortfolioSchema } from "./portfolio.js";
import { GENESIS_HASH, computeEntryHash } from "../core/hashchain.js"; // L0 (D12 move)
import { createBackupSnapshot } from "../core/backup.js"; // N28: backup-before-migrate (runtime call only — see openStoreDb)
import type { ArtifactKind } from "./store.js"; // type-only: erased at runtime — no store↔db cycle (D12)
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
	{
		version: 4,
		name: "revision model — artifact_revisions, baselines, audit_ledger, tx_log (Foundation)",
		up: (db: DatabaseSync) => {
			db.exec(SCHEMA_V004_REVISION_MODEL);
		},
	},
	{
		version: 5,
		name: "dev lanes — execution lanes (dev_lane, dev_lane_xdep)",
		up: (db: DatabaseSync) => {
			db.exec(SCHEMA_V005_DEV_LANES);
		},
	},
	{
		version: 6,
		name: "soft-lock — artifact_revisions.locked_at/locked_by (N19/N20)",
		up: (db: DatabaseSync) => {
			db.exec(SCHEMA_V006_LOCKING);
		},
	},
	{
		version: 7,
		name: "rtm NFR references — rtm_row.fr_ref nullable + nfr_ref FK (N24-16)",
		up: (db: DatabaseSync) => {
			db.exec(SCHEMA_V007_RTM_NFR);
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
 * N28/D5 — derive (cwd, projectName) for createBackupSnapshot from the DB
 * path alone (openStoreDb receives no context). Production paths from
 * core/paths.ts buildStoreDbPath always end in `Doc/store/<project>/index.db`;
 * any other shape (test fixtures at `<tmp>/index.db`) falls back to
 * dirname/basename so derivation NEVER fails.
 */
function deriveBackupTarget(dbPath: string): { cwd: string; projectName: string } {
	const match = /[/\\]Doc[/\\]store[/\\]([^/\\]+)[/\\]index\.db$/.exec(dbPath);
	if (match) {
		return { cwd: dbPath.slice(0, dbPath.length - match[0].length), projectName: match[1] ?? "store" };
	}
	const dir = dirname(dbPath);
	return { cwd: dir, projectName: basename(dir) || "store" };
}

/**
 * Open (and create if missing) the store database at `dbPath`, apply the
 * production PRAGMA set, run pending migrations, and enforce G3.
 *
 * N28 (Phase B): a PRE-EXISTING file with pending migrations gets an
 * automatic backup FIRST — a null backup record aborts before any DDL
 * (nothing changes), and a successful migration appends an audit entry
 * naming the backup path (G7). Fresh creates skip the backup (nothing to
 * lose) but still audit (backupPath: null). The "one confirmation" for this
 * automatic step is the approved Phase B plan; Phase C's preflight can
 * surface `inspectStoreVersion` BEFORE the first open (D4).
 *
 * @throws Error when the DB's user_version exceeds maxKnownVersion()
 *         (downgrade protection — "upgrade your extension") or when a
 *         required pre-migration backup fails (N28 abort).
 */
export function openStoreDb(dbPath: string): DatabaseSync {
	const existedBefore = existsSync(dbPath); // N28/D5: pre-existing file only
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

	// N28 — backup FIRST: only a pre-existing file with pending migrations.
	const pending = MIGRATIONS.filter((m) => m.version > at);
	let backupPath: string | null = null;
	if (pending.length > 0 && existedBefore) {
		const { cwd, projectName } = deriveBackupTarget(dbPath);
		const record = createBackupSnapshot({ cwd, projectName, trigger: "migrate", dbPath });
		if (!record) {
			db.close();
			throw new Error(
				`velpari store: migration of '${dbPath}' aborted — the pre-migration backup ` +
					`failed (N28). Nothing was changed; fix Backup/velpari and retry.`,
			);
		}
		backupPath = record.backupPath;
	}

	const from = at;
	migrate(db);

	// Post-migration bookkeeping (G7 + D11): a REAL upgrade of a pre-existing
	// store appends one audit + tx entry naming the backup path (G7). A fresh
	// create is initialization, not a migration event — no audit row (decision
	// 2026-09-28: the fresh-create audit broke hashchain/protection index
	// assumptions for zero product value; the backup-path audit is the one
	// N28/G7 exists for). The digest stamp ALWAYS lands when anything ran, so
	// every store starts with a baseline stamp (D11).
	if (pending.length > 0) {
		const to = maxKnownVersion();
		db.exec("BEGIN IMMEDIATE;");
		try {
			if (existedBefore) {
				appendAuditEntry(db, {
					actor: "velpari-migrate",
					action: "migration",
					reason: `schema v${from} → v${to}`,
					detail: { from, to, backupPath },
				});
				appendTxEntry(db, { actor: "velpari-migrate", operation: "migration", outcome: "commit" });
			}
			stampStoreContentDigest(db);
			db.exec("COMMIT;");
		} catch (err) {
			db.exec("ROLLBACK;");
			throw err;
		}
	}
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

/**
 * Open an EXISTING database READ-ONLY: no migrations, no creation, no
 * journal_mode/synchronous mutation (connection pragmas only). Added by the
 * Phase 3 backup subsystem (N9/N11): it is the handle for `VACUUM INTO`
 * (snapshot source) and for `PRAGMA quick_check` on a snapshot.
 *
 * Why not `openStoreDb`: that function MIGRATES and CREATES and switches to
 * WAL — a migrating open would pre-migrate the DB before the "migrate"
 * trigger fires (defeating backup-before-migrate), and a WAL-mode open would
 * rewrite the bytes we are about to digest.
 *
 * D9 note: stays inside this file (the sole `node:sqlite` importer).
 *
 * @param dbPath - Path to an existing database file.
 * @returns A read-only connection (busy_timeout set; close with `db.close()`).
 * @throws when the file is missing or unreadable (callers treat as "no DB").
 */
export function openStoreDbReadOnly(dbPath: string): DatabaseSync {
	const db = new (databaseSyncCtor())(dbPath, { readOnly: true });
	db.exec("PRAGMA busy_timeout = 5000;");
	return db;
}

/** Probe outcome for a store path (E#2/CR D#4 shared classifier). */
export type StoreProbe =
	/** File exists, opens read-only, and carries the Velpari schema. */
	| { status: "ok" }
	/** No file at dbPath — normal for a pre-store project. */
	| { status: "missing" }
	/** File exists but is unusable: not a database, not a Velpari store, or unreadable. */
	| { status: "invalid"; reason: string };

/**
 * Classify a store path without ever throwing (E#2 design — the shared
 * probe behind the handoff store guard and re-usable by audits).
 *
 * Distinguishes the three states callers used to conflate: missing
 * (pre-store, fine), unreadable (dir/permissions — CANTOPEN), and
 * not-a-store (garbage bytes — NOTADB, or a foreign SQLite file with no
 * `store_meta`). Read-only + schema-scoped: never migrates, never
 * creates, never writes.
 * @param dbPath - Candidate store path (buildStoreDbPath output).
 * @returns Discriminated probe outcome — never throws.
 */
export function probeStoreDb(dbPath: string): StoreProbe {
	if (!existsSync(dbPath)) return { status: "missing" };
	let db: DatabaseSync;
	try {
		db = openStoreDbReadOnly(dbPath);
	} catch (err) {
		return { status: "invalid", reason: err instanceof Error ? err.message : String(err) };
	}
	try {
		const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'store_meta'").get();
		if (row === undefined) {
			return { status: "invalid", reason: "not a Velpari store (no store_meta table)" };
		}
		return { status: "ok" };
	} catch (err) {
		return { status: "invalid", reason: err instanceof Error ? err.message : String(err) };
	} finally {
		db.close();
	}
}

/**
 * N28/D4 — read the schema version WITHOUT opening/migrating (Phase C
 * preflight: "store will migrate v005 → v006 (backup at …)" can be shown
 * BEFORE the first open). Fail-open: null when the file is missing or
 * unreadable (callers treat as "no store yet").
 */
export function inspectStoreVersion(dbPath: string): { version: number; maxKnown: number; pending: number } | null {
	try {
		if (!existsSync(dbPath)) return null;
		const db = openStoreDbReadOnly(dbPath);
		try {
			const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			const maxKnown = maxKnownVersion();
			return { version, maxKnown, pending: MIGRATIONS.filter((m) => m.version > version).length };
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// store content digest (Phase B, G6/N21 layer 4) — the Phase C interface
// contract: every content writer re-stamps the stamp; the doctor's foreign-
// modification check compares a freshly computed digest against the stamp.
// ---------------------------------------------------------------------------

/** Digest scope id — bump when the canonical-dump definition below changes. */
export const STORE_DIGEST_SCOPE = "store-content-v1";

/** Tables excluded from the digest (D11): the stamp home + the append-only
 * hash chain (N15 covers those rows), so audit appends never false-positive. */
const DIGEST_EXCLUDED_TABLES = new Set(["store_meta", "audit_ledger", "tx_log"]);

/** Stamped store-content digest (store_meta rows; null = never stamped). */
export interface StoreDigestStamp {
	/** STORE_DIGEST_SCOPE value at stamp time (mismatched scope reads as null). */
	scope: string;
	/** sha256 hex of the canonical content dump. */
	digest: string;
	/** ISO timestamp of the stamp. */
	stampedAt: string;
}

/** Canonical JSON: keys sorted (deep), so the same content always hashes the same. */
function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const rec = value as Record<string, unknown>;
	const keys = Object.keys(rec).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// Audit ledger + tx log append helpers (v004, F17/F18/N15) — MOVED here from
// io/store.ts in Phase B (D12): openStoreDb's post-migration audit must not
// import io/store.ts (store imports this file — a reverse import would be a
// runtime cycle). io/store.ts re-exports these names, so every existing
// importer (backup, db-reset, merge-back, protection, retention, and the
// doctor's hash-chain check) keeps working unchanged.
// ---------------------------------------------------------------------------

/** Canonical payload covering one audit_ledger row's content fields (hash input). */
export function auditCanonicalPayload(row: {
	at: string;
	actor: string;
	action: string;
	artifact_kind: string | null;
	revision_number: number | null;
	reason: string | null;
	detail_json: string;
}): string {
	return canonicalJson(row);
}

/** Canonical payload covering one tx_log row's content fields (hash input). */
export function txCanonicalPayload(row: {
	at: string;
	actor: string;
	operation: string;
	before_digest: string | null;
	after_digest: string | null;
	outcome: string;
}): string {
	return canonicalJson(row);
}

/**
 * Append one audit-ledger entry (F17: who/what/when/why). Chain-anchored
 * (N15): prev_hash = the table's last entry_hash (GENESIS_HASH when empty).
 * Runs inside the caller's transaction when one is open.
 * @returns {number} The new entry_id.
 */
export function appendAuditEntry(
	db: DatabaseSync,
	entry: {
		actor: string;
		action: string;
		artifactKind?: ArtifactKind;
		revisionNumber?: number;
		reason?: string;
		detail?: Record<string, unknown>;
	},
): number {
	const last = db.prepare("SELECT entry_hash FROM audit_ledger ORDER BY entry_id DESC LIMIT 1").get() as
		| { entry_hash: string }
		| undefined;
	const prevHash = last?.entry_hash ?? GENESIS_HASH;
	const row = {
		at: new Date().toISOString(),
		actor: entry.actor,
		action: entry.action,
		artifact_kind: entry.artifactKind ?? null,
		revision_number: entry.revisionNumber ?? null,
		reason: entry.reason ?? null,
		detail_json: JSON.stringify(entry.detail ?? {}),
	};
	const entryHash = computeEntryHash(prevHash, auditCanonicalPayload(row));
	const inserted = db
		.prepare(
			`INSERT INTO audit_ledger (at, actor, action, artifact_kind, revision_number, reason, detail_json, prev_hash, entry_hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			row.at,
			row.actor,
			row.action,
			row.artifact_kind,
			row.revision_number,
			row.reason,
			row.detail_json,
			prevHash,
			entryHash,
		);
	return Number(inserted.lastInsertRowid);
}

/**
 * Append one tx-log entry (F18: every store mutation, before/after digests,
 * outcome). Chain-anchored like audit_ledger. A 'rollback' entry is appended
 * AFTER the failed transaction rolled back (its own write commits separately —
 * a rollback entry inside the failed txn would vanish with it).
 * @returns {number} The new tx_id.
 */
export function appendTxEntry(
	db: DatabaseSync,
	entry: {
		actor: string;
		operation: string;
		beforeDigest?: string;
		afterDigest?: string;
		outcome: "commit" | "rollback";
	},
): number {
	const last = db.prepare("SELECT entry_hash FROM tx_log ORDER BY tx_id DESC LIMIT 1").get() as
		| { entry_hash: string }
		| undefined;
	const prevHash = last?.entry_hash ?? GENESIS_HASH;
	const row = {
		at: new Date().toISOString(),
		actor: entry.actor,
		operation: entry.operation,
		before_digest: entry.beforeDigest ?? null,
		after_digest: entry.afterDigest ?? null,
		outcome: entry.outcome,
	};
	const entryHash = computeEntryHash(prevHash, txCanonicalPayload(row));
	const inserted = db
		.prepare(
			`INSERT INTO tx_log (at, actor, operation, before_digest, after_digest, outcome, prev_hash, entry_hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(row.at, row.actor, row.operation, row.before_digest, row.after_digest, row.outcome, prevHash, entryHash);
	return Number(inserted.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// L1 soft-lock guard (Phase B, N21 layer 1 / D7) — the in-code write guard.
// node:sqlite exposes NO authorizer API (verified on Node v22.22.1), so this
// is the honest ceiling: the ONE sanctioned content writer refuses locked
// revisions, and assertRevisionContentUnlocked documents the matrix for any
// other writer. Enforcement matrix (D7):
//   content columns of a locked revision → REFUSE (LockedRevisionError)
//   status transitions (ops/protection)  → ALLOW + audited (N20)
//   new revision (CAS publish of copy)   → ALLOW (the N19 path)
//   draft writes / revert / backfill     → ALLOW (never touch revision rows)
// ---------------------------------------------------------------------------

/** Columns updateRevisionContent may touch (D7 content allow-list). */
const REVISION_CONTENT_COLUMNS = new Set([
	"yaml_bytes",
	"sha256_fingerprint",
	"inputs",
	"version",
	"change_log",
	"reviewer_verdict",
	"generated_at",
]);

/**
 * Thrown when a content write targets a soft-locked revision. The message is
 * self-healing (tells the user exactly what to do instead).
 */
export class LockedRevisionError extends Error {
	constructor(
		public readonly revisionId: number,
		public readonly lockedBy: string,
		action: string,
	) {
		super(
			`velpari store: revision ${revisionId} is soft-locked (consumed by ${lockedBy}) — ` +
				`its content is immutable. ${action} is refused; create a new version instead ` +
				`(copy → publish). Status updates on this revision are still allowed (N20).`,
		);
		this.name = "LockedRevisionError";
	}
}

/**
 * Read one revision's lock (null = unlocked, absent, or pre-v006 schema —
 * fail-open: no column means locks never existed).
 * @param {DatabaseSync} db - Open store connection.
 * @param {number} revisionId - artifact_revisions.revision_id.
 * @returns {{ lockedAt: string; lockedBy: string } | null} The lock, or null.
 */
export function readRevisionLock(db: DatabaseSync, revisionId: number): { lockedAt: string; lockedBy: string } | null {
	try {
		const row = db
			.prepare("SELECT locked_at, locked_by FROM artifact_revisions WHERE revision_id = ?")
			.get(revisionId) as { locked_at: string | null; locked_by: string | null } | undefined;
		if (row === undefined || row.locked_at === null || row.locked_by === null) return null;
		return { lockedAt: row.locked_at, lockedBy: row.locked_by };
	} catch {
		return null; // pre-v006 schema: no locks concept
	}
}

/**
 * Guard (D7): throw LockedRevisionError when the revision is soft-locked.
 * Call BEFORE any content-column write.
 * @param {DatabaseSync} db - Open store connection.
 * @param {number} revisionId - Target revision.
 * @param {string} action - Human-readable action name for the error message.
 * @throws {LockedRevisionError} When the revision is locked.
 */
export function assertRevisionContentUnlocked(db: DatabaseSync, revisionId: number, action: string): void {
	const lock = readRevisionLock(db, revisionId);
	if (lock !== null) throw new LockedRevisionError(revisionId, lock.lockedBy, action);
}

/**
 * The ONE sanctioned content writer for artifact_revisions: refuses locked
 * revisions (LockedRevisionError), refuses non-content columns (status/head
 * changes route to ops/protection.ts — D7), otherwise updates the patch.
 * @param {DatabaseSync} db - Open store connection.
 * @param {number} revisionId - Target revision.
 * @param {Record<string, string | number | null>} patch - Content columns to set.
 * @param {string} action - Human-readable action name for error messages.
 * @throws {LockedRevisionError} When the revision is locked.
 * @throws {Error} When the patch names a non-content column.
 */
export function updateRevisionContent(
	db: DatabaseSync,
	revisionId: number,
	patch: Record<string, string | number | null>,
	action: string,
): void {
	const columns = Object.keys(patch);
	if (columns.length === 0) throw new Error("store: updateRevisionContent requires at least one column");
	for (const column of columns) {
		if (!REVISION_CONTENT_COLUMNS.has(column)) {
			throw new Error(
				`store: '${column}' is not a content column — status/head changes go through ` +
					`ops/protection.ts, new versions through publish (D7).`,
			);
		}
	}
	assertRevisionContentUnlocked(db, revisionId, action);
	const assignments = columns.map((column) => `${column} = ?`).join(", ");
	db.prepare(`UPDATE artifact_revisions SET ${assignments} WHERE revision_id = ?`).run(
		...columns.map((column) => patch[column] ?? null),
		revisionId,
	);
}

/**
 * Canonical content dump → sha256 (STORE_DIGEST_SCOPE definition).
 * Covers `PRAGMA user_version` + every user table NOT in
 * DIGEST_EXCLUDED_TABLES, rows serialized as canonical-JSON lines
 * ordered by rowid — a deterministic byte image of business content.
 * @param {DatabaseSync} db - Open store connection.
 * @returns {string} sha256 hex digest.
 */
export function computeStoreContentDigest(db: DatabaseSync): string {
	const { createHash } = requireDriver("node:crypto") as typeof import("node:crypto");
	const hash = createHash("sha256");
	const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
	hash.update(`user_version:${version}\n`);
	const tables = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
		.all() as { name: string }[];
	for (const { name } of tables) {
		if (DIGEST_EXCLUDED_TABLES.has(name)) continue;
		hash.update(`table:${name}\n`);
		// PRAGMA/table names come from sqlite_master (never user input) —
		// a quoted identifier is the only interpolation here.
		const rows = db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}" ORDER BY rowid`).all() as Record<
			string,
			unknown
		>[];
		for (const row of rows) hash.update(`${canonicalJson(row)}\n`);
	}
	return hash.digest("hex");
}

/**
 * Read the stamp (fail-open → null when absent, malformed, or scope-mismatched).
 * @param {DatabaseSync} db - Open store connection.
 * @returns {StoreDigestStamp | null} The stamp, or null.
 */
export function readStoreDigestStamp(db: DatabaseSync): StoreDigestStamp | null {
	try {
		const scope = storeMetaGet(db, "store_digest_scope");
		const digest = storeMetaGet(db, "store_digest");
		const stampedAt = storeMetaGet(db, "store_digest_at");
		if (scope !== STORE_DIGEST_SCOPE || digest === null || stampedAt === null) return null;
		return { scope, digest, stampedAt };
	} catch {
		return null;
	}
}

/**
 * Compute the current digest + upsert it into store_meta (three keys).
 * Called inside every content writer's transaction (D11 re-stamp contract).
 * @param {DatabaseSync} db - Open store connection (txn open or autocommit).
 * @returns {StoreDigestStamp} The fresh stamp.
 */
export function stampStoreContentDigest(db: DatabaseSync): StoreDigestStamp {
	const stamp: StoreDigestStamp = {
		scope: STORE_DIGEST_SCOPE,
		digest: computeStoreContentDigest(db),
		stampedAt: new Date().toISOString(),
	};
	storeMetaSet(db, "store_digest_scope", stamp.scope);
	storeMetaSet(db, "store_digest", stamp.digest);
	storeMetaSet(db, "store_digest_at", stamp.stampedAt);
	return stamp;
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
