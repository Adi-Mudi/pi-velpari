// Unit tests — io/db.ts migration v006 → v007 (Phase 3, N24-16).
// Covers: genuine v006 fixture (no nfr_ref column, fr_ref NOT NULL) →
// rebuild preserves every existing rtm_row (fr_ref intact, nfr_ref NULL),
// adds the nfr_ref column + FK, relaxes fr_ref to nullable, and the new
// XOR FK accepts an NFR reference while still rejecting a bad one.
// Version expectations derive from maxKnownVersion() — never a hardcoded 7.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStoreDb, closeStoreDb, inspectStoreVersion, maxKnownVersion, MIGRATIONS } from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";

interface RtmRow {
	run_id: string;
	kind: string;
	id: string;
	fr_ref: string | null;
	nfr_ref: string | null;
	af_ref: string | null;
	tc_ref: string | null;
	phase: number;
	target_sha256: string;
	status: string;
}

describe("io/db — v006 → v007 rtm NFR migration (N24-16)", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-migrate-v007-"));
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	/** Read rtm_row in a stable order for byte-compare assertions. */
	function readRtm(db: DatabaseSync): RtmRow[] {
		return db
			.prepare(
				"SELECT run_id, kind, id, fr_ref, nfr_ref, af_ref, tc_ref, phase, target_sha256, status FROM rtm_row ORDER BY id",
			)
			.all() as unknown as RtmRow[];
	}

	/** Craft a genuine v006-era store: no nfr_ref column, fr_ref NOT NULL. */
	async function craftV006(path: string): Promise<void> {
		const sqlite = (await import("node:sqlite")) as typeof import("node:sqlite");
		const legacy = new sqlite.DatabaseSync(path);
		try {
			legacy.exec("PRAGMA journal_mode = WAL;");
			legacy.exec("PRAGMA foreign_keys = ON;");
			for (const migration of MIGRATIONS) {
				if (migration.version <= 6) migration.up(legacy);
			}
			legacy.exec("PRAGMA user_version = 6");
			assert.equal(
				(legacy.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
				6,
				"fixture is a genuine v006-era DB",
			);
			// Pre-v007 rtm_row has NO nfr_ref column — old column list only.
			const cols = (legacy.prepare("PRAGMA table_info(rtm_row)").all() as { name: string }[]).map((c) => c.name);
			assert.equal(cols.includes("nfr_ref"), false, "v006 fixture has no nfr_ref column yet");
			legacy
				.prepare(
					"INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint) VALUES ('r1', 'prd', 1, 'drafting-prd', '2026-10-05T00:00:00Z', 'fp')",
				)
				.run();
			legacy
				.prepare(
					"INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint) VALUES ('r1', 'rtm', 1, 'building-rtm', '2026-10-05T00:00:00Z', 'fp')",
				)
				.run();
			legacy
				.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'aaa')")
				.run();
			legacy
				.prepare("INSERT INTO nfr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'NFR-1', 1, 'bbb')")
				.run();
			legacy
				.prepare(
					"INSERT INTO rtm_row (run_id, kind, id, fr_ref, phase, target_sha256) VALUES ('r1', 'rtm', 'RTM-1', 'FR-1', 1, 't1')",
				)
				.run();
		} finally {
			legacy.close();
		}
	}

	test("1. fresh create already lands on maxKnown (v007 registered)", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			assert.equal(version, maxKnownVersion(), "fresh DB reaches the newest registered migration");
			const cols = (db.prepare("PRAGMA table_info(rtm_row)").all() as { name: string }[]).map((c) => c.name);
			assert.ok(cols.includes("nfr_ref"), "nfr_ref present on a fresh create");
		} finally {
			closeStoreDb(db);
		}
	});

	test("2. v006 fixture: preflight pending, rows preserved, nfr_ref added, fr_ref nullable, new NFR FK works", async () => {
		const path = join(dir, "index.db");
		await craftV006(path);

		// Read-only preflight must report exactly one pending migration without migrating.
		const probe = inspectStoreVersion(path);
		assert.deepEqual(
			probe,
			{ version: 6, maxKnown: maxKnownVersion(), pending: 1 },
			"inspectStoreVersion reports the pending v007 migration without opening for write",
		);

		const db = openStoreDb(path);
		try {
			const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			assert.equal(version, maxKnownVersion(), "migrated to the newest registered migration");

			// Existing rtm_row preserved: fr_ref intact, nfr_ref backfilled to NULL.
			const rows = readRtm(db);
			assert.equal(rows.length, 1, "pre-existing rtm_row survives the rebuild");
			const r1 = rows[0];
			assert.ok(r1 !== undefined, "row present");
			assert.equal(r1.id, "RTM-1", "id preserved");
			assert.equal(r1.fr_ref, "FR-1", "fr_ref preserved by the INSERT…SELECT");
			assert.equal(r1.nfr_ref, null, "existing rows get nfr_ref = NULL");
			assert.equal(r1.phase, 1, "phase preserved");
			assert.equal(r1.target_sha256, "t1", "target_sha256 preserved");

			// Column shape: nfr_ref added, fr_ref no longer NOT NULL.
			const cols = db.prepare("PRAGMA table_info(rtm_row)").all() as { name: string; notnull: number }[];
			const names = cols.map((c) => c.name);
			assert.ok(names.includes("nfr_ref"), "nfr_ref column added by v007");
			const frCol = cols.find((c) => c.name === "fr_ref");
			assert.ok(frCol !== undefined, "fr_ref column present");
			assert.equal(frCol.notnull, 0, "fr_ref is nullable after v007");

			// The new FK accepts an NFR reference and still rejects a bad one.
			db.prepare(
				"INSERT INTO rtm_row (run_id, kind, id, nfr_ref, phase, target_sha256) VALUES ('r1', 'rtm', 'RTM-2', 'NFR-1', 1, 't2')",
			).run();
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO rtm_row (run_id, kind, id, nfr_ref, phase, target_sha256) VALUES ('r1', 'rtm', 'RTM-3', 'NFR-99', 1, 't3')",
						)
						.run(),
				/FOREIGN KEY constraint failed/,
				"bad NFR id still rejected by the new nfr_ref FK",
			);
			assert.equal(readRtm(db).length, 2, "only the valid NFR row landed");
		} finally {
			closeStoreDb(db);
		}
	});

	test("3. migration snapshot happened before the rebuild (N28 backup-first)", async () => {
		const path = join(dir, "index.db");
		await craftV006(path);
		const db = openStoreDb(path);
		try {
			assert.equal(existsSync(join(dir, "Backup")), true, "backup dir exists for a genuine migration");
		} finally {
			closeStoreDb(db);
		}
	});
});
