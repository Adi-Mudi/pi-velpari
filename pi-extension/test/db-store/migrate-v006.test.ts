// Unit tests — io/db.ts migration v005 → v006 (Phase B, N28/G7/G1).
// Covers: fresh create (no backup, audit backupPath null, stamp), genuine
// v005 fixture (BACKUP FIRST + audit with backup path + locked columns +
// stamped digest + rows byte-identical), backup-failure abort (nothing
// changed), G3 downgrade guard intact + boundary open, idempotent re-open
// (one audit, one backup), inspectStoreVersion read-only preflight (D4).
// Conventions: fixtures crafted by running only MIGRATIONS ≤ N (dev-lanes
// recipe); version expectations derive from maxKnownVersion() — never a
// hardcoded 6.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
	openStoreDb,
	closeStoreDb,
	openStoreDbReadOnly,
	inspectStoreVersion,
	maxKnownVersion,
	MIGRATIONS,
	readStoreDigestStamp,
	computeStoreContentDigest,
} from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";

interface FrRow {
	run_id: string;
	kind: string;
	id: string;
	phase: number;
	text_hash: string;
	status: string;
}

describe("io/db — v005 → v006 soft-lock migration (N28 backup-first)", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-migrate-v006-"));
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	/** Backup folder deriveBackupTarget produces for a <dir>/index.db fixture. */
	function backupDir(): string {
		return join(dir, "Backup", "velpari", basename(dir));
	}

	/**
	 * Read the fixture's fr rows in a stable order for byte-compare assertions.
	 * @param {DatabaseSync} db - Open store connection (fixture or post-migration).
	 * @returns {FrRow[]} The fr rows ordered by id.
	 */
	function readFr(db: DatabaseSync): FrRow[] {
		return db
			.prepare("SELECT run_id, kind, id, phase, text_hash, status FROM fr ORDER BY id")
			.all() as unknown as FrRow[];
	}

	/** Craft a genuine v005-era store with seeded fr rows; returns captured rows. */
	async function craftV005(path: string): Promise<FrRow[]> {
		const sqlite = (await import("node:sqlite")) as typeof import("node:sqlite");
		const legacy = new sqlite.DatabaseSync(path);
		let before: FrRow[];
		try {
			legacy.exec("PRAGMA journal_mode = WAL;");
			legacy.exec("PRAGMA foreign_keys = ON;");
			for (const migration of MIGRATIONS) {
				if (migration.version <= 5) migration.up(legacy);
			}
			legacy.exec("PRAGMA user_version = 5");
			assert.equal(
				(legacy.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
				5,
				"fixture is a genuine v005-era DB",
			);
			legacy
				.prepare(
					"INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint) VALUES ('r1', 'prd', 1, 'drafting-prd', '2026-09-27T00:00:00Z', 'fp')",
				)
				.run();
			legacy
				.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'aaa')")
				.run();
			legacy
				.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-2', 1, 'bbb')")
				.run();
			before = readFr(legacy);
		} finally {
			legacy.close();
		}
		assert.equal(before.length, 2, "fixture carries 2 fr rows");
		return before;
	}

	/**
	 * Read every `action = 'migration'` audit entry (the G7 post-migration proof).
	 * @param {DatabaseSync} db - Open store connection.
	 * @returns {{ reason: string; detail_json: string }[]} Audit rows ordered by entry_id.
	 */
	function migrationAudits(db: DatabaseSync): { reason: string; detail_json: string }[] {
		return db
			.prepare("SELECT reason, detail_json FROM audit_ledger WHERE action = 'migration' ORDER BY entry_id")
			.all() as unknown as { reason: string; detail_json: string }[];
	}

	/**
	 * Parse the derived backup folder's manifest and keep only `type: "backup"` lines.
	 * @returns {Record<string, unknown>[]} Backup manifest lines ([] when no manifest exists).
	 */
	function manifestBackupLines(): Record<string, unknown>[] {
		const file = join(backupDir(), "manifest.jsonl");
		if (!existsSync(file)) return [];
		return readFileSync(file, "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l) as Record<string, unknown>)
			.filter((line) => line.type === "backup");
	}

	test("1. fresh create: migrates to maxKnown, NO backup dir, NO migration audit (init ≠ migration), digest stamped", () => {
		const path = join(dir, "index.db");
		const db = openStoreDb(path);
		try {
			const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			assert.equal(version, maxKnownVersion(), "fresh DB reaches the newest registered migration");
			assert.equal(existsSync(join(dir, "Backup")), false, "no Backup dir for a fresh create (D5)");

			// Decision 2026-09-28 (B): init is not a migration event — the audit
			// fires only when a PRE-EXISTING file is migrated (see test 2).
			assert.equal(migrationAudits(db).length, 0, "no migration audit row for a fresh create");
			const tx = db.prepare("SELECT outcome FROM tx_log WHERE operation = 'migration'").all() as unknown as {
				outcome: string;
			}[];
			assert.equal(tx.length, 0, "no migration tx entry for a fresh create");

			const stamp = readStoreDigestStamp(db);
			assert.ok(stamp !== null, "baseline stamp present after fresh create (D11)");
			assert.equal(stamp.digest, computeStoreContentDigest(db), "stamp equals post-create content");
		} finally {
			closeStoreDb(db);
		}
	});

	test("2. v005 fixture: inspect preflight, BACKUP FIRST, rows intact, locked columns, audit names backup", async () => {
		const path = join(dir, "index.db");
		const before = await craftV005(path);

		// (f) read-only preflight — must NOT migrate.
		const probe = inspectStoreVersion(path);
		assert.deepEqual(
			probe,
			{ version: 5, maxKnown: maxKnownVersion(), pending: maxKnownVersion() - 5 },
			"inspectStoreVersion reports the pending migration without opening for write",
		);
		assert.equal(inspectStoreVersion(path)?.version, 5, "still v005 after the read-only inspection (no side effects)");

		const db = openStoreDb(path);
		try {
			const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			assert.equal(version, maxKnownVersion(), "migrated to the newest registered migration");

			// Pre-existing rows byte-identical.
			assert.deepEqual(readFr(db), before, "pre-existing fr rows byte-identical");

			// G1 columns exist and start NULL.
			const cols = (db.prepare("PRAGMA table_info(artifact_revisions)").all() as { name: string }[]).map((c) => c.name);
			assert.ok(cols.includes("locked_at"), "locked_at column added by v006");
			assert.ok(cols.includes("locked_by"), "locked_by column added by v006");
			const locked = db
				.prepare("SELECT COUNT(*) AS n FROM artifact_revisions WHERE locked_at IS NOT NULL OR locked_by IS NOT NULL")
				.get() as { n: number };
			assert.equal(locked.n, 0, "no revision starts locked");

			// N28 backup happened BEFORE the migration.
			const lines = manifestBackupLines();
			assert.equal(lines.length, 1, "exactly one backup manifest line");
			const line = lines[0];
			assert.ok(line !== undefined, "manifest line present");
			assert.equal(line.trigger, "migrate", "backup trigger is 'migrate'");
			assert.equal(line.quickCheck, true, "snapshot passed the N11 self-test");
			const backupPath = String(line.backupPath);
			assert.ok(statSync(join(dir, backupPath)).size > 0, "snapshot file exists and is non-empty");

			// Audit names the backup path.
			const audits = migrationAudits(db);
			assert.equal(audits.length, 1, "exactly one migration audit");
			const audit = audits[0];
			assert.ok(audit !== undefined, "migration audit present");
			assert.equal(audit.reason, `schema v5 → v${maxKnownVersion()}`, "audit reason names both versions");
			const detail = JSON.parse(audit.detail_json) as { from: number; to: number; backupPath: string };
			assert.equal(detail.from, 5, "audit from-version");
			assert.equal(detail.backupPath, backupPath, "audit names the backup path (G7)");

			// Digest stamped post-migration.
			const stamp = readStoreDigestStamp(db);
			assert.ok(stamp !== null, "stamp present");
			assert.equal(stamp.digest, computeStoreContentDigest(db), "stamp equals content");
		} finally {
			closeStoreDb(db);
		}
	});

	test("3. backup failure ABORTS the migration: version still 5, rows untouched, message names N28", async () => {
		const path = join(dir, "index.db");
		const before = await craftV005(path);
		// A regular FILE where the backup folder must be created → mkdir fails →
		// createBackupSnapshot returns null (never throws) → openStoreDb aborts.
		mkdirSync(join(dir, "Backup", "velpari"), { recursive: true });
		writeFileSync(backupDir(), "not a directory");

		assert.throws(
			() => openStoreDb(path),
			/aborted — the pre-migration backup failed \(N28\)/,
			"abort message names the backup failure",
		);

		// Nothing changed: version still 5, rows identical, columns absent.
		const probe = openStoreDbReadOnly(path);
		try {
			const version = (probe.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			assert.equal(version, 5, "no partial apply — still v005");
			assert.deepEqual(readFr(probe), before, "rows untouched by the aborted open");
			const cols = (probe.prepare("PRAGMA table_info(artifact_revisions)").all() as { name: string }[]).map(
				(c) => c.name,
			);
			assert.equal(cols.includes("locked_at"), false, "no DDL ran");
		} finally {
			probe.close();
		}
	});

	test("4. G3 intact: user_version > maxKnown refused; boundary = maxKnown opens without backup", async () => {
		const sqlite = (await import("node:sqlite")) as typeof import("node:sqlite");

		// Downgrade guard.
		const futurePath = join(dir, "future.db");
		const future = new sqlite.DatabaseSync(futurePath);
		future.exec("PRAGMA user_version = 99");
		future.close();
		assert.throws(
			() => openStoreDb(futurePath),
			/has schema version 99.*Upgrade your extension/,
			"G3 downgrade protection unchanged",
		);

		// Boundary: already at maxKnown → opens, no backup, no second audit.
		const edgePath = join(dir, "edge.db");
		const edge = new sqlite.DatabaseSync(edgePath);
		edge.exec("PRAGMA journal_mode = WAL;");
		for (const migration of MIGRATIONS) migration.up(edge);
		edge.exec(`PRAGMA user_version = ${maxKnownVersion()}`);
		edge.close();
		const db = openStoreDb(edgePath);
		try {
			const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			assert.equal(version, maxKnownVersion(), "boundary open succeeds");
			assert.equal(migrationAudits(db).length, 0, "no migration audit when nothing pending");
			assert.equal(existsSync(join(dir, "Backup")), false, "no backup when nothing pending");
		} finally {
			closeStoreDb(db);
		}
	});

	test("5. re-open after migration is idempotent: one audit, one backup, version stable", async () => {
		const path = join(dir, "index.db");
		await craftV005(path);

		const first = openStoreDb(path);
		closeStoreDb(first);
		assert.equal(migrationAudits(openStoreDbReadOnly(path)).length, 1, "first open: one migration audit");

		const second = openStoreDb(path);
		try {
			const version = (second.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			assert.equal(version, maxKnownVersion(), "version stable");
			assert.equal(migrationAudits(second).length, 1, "no second migration audit");
			assert.equal(manifestBackupLines().length, 1, "no second backup");
		} finally {
			closeStoreDb(second);
		}
	});

	test("6. inspectStoreVersion: missing file → null; migrated store → pending 0", () => {
		const path = join(dir, "index.db");
		assert.equal(inspectStoreVersion(path), null, "no file → null (fail-open)");
		const db = openStoreDb(path);
		closeStoreDb(db);
		assert.deepEqual(
			inspectStoreVersion(path),
			{ version: maxKnownVersion(), maxKnown: maxKnownVersion(), pending: 0 },
			"migrated store reports nothing pending",
		);
	});
});
