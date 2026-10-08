// B-F2 pin (Phase 4) — ESM import-cycle order.
// io/db.ts statically imports core/backup.ts, which imports io/db.ts back.
// The cycle is load-safe ONLY while no cross-module reference sits at module
// top level (a top-level use would hit the TDZ at load). This file's import
// ORDER is the pin: core/backup.js FIRST, then io/db.js — that order must
// evaluate cleanly, and openStoreDb must still run backup-before-migrate
// (N28) on a pre-existing store with pending migrations.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

import "../../src/core/backup.js";
import { closeStoreDb, maxKnownVersion, openStoreDb } from "../../src/io/db.js";

describe("B-F2 — backup-first import order keeps openStoreDb's pre-migration backup", () => {
	let dir: string;

	after(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	test("pre-existing store at version 0 migrates WITH a backup snapshot", () => {
		dir = mkdtempSync(join(tmpdir(), "velpari-import-order-"));
		// Documented non-Doc/store fixture shape (`<tmp>/index.db`):
		// deriveBackupTarget's fallback takes dirname/basename, so the snapshot
		// lands at `<dir>/Backup/velpari/<basename>/index-*.db`.
		const dbPath = join(dir, "index.db");
		// Pre-existing ZERO-BYTE file: a valid empty SQLite db at user_version 0
		// → pending migrations → N28 backup FIRST (existedBefore = true).
		writeFileSync(dbPath, "");

		const db = openStoreDb(dbPath);
		try {
			const v = db.prepare("PRAGMA user_version").get() as { user_version: number };
			assert.equal(v.user_version, maxKnownVersion(), "migrations ran to maxKnownVersion");
		} finally {
			closeStoreDb(db);
		}

		const listing = existsSync(join(dir, "Backup"))
			? (readdirSync(join(dir, "Backup"), { recursive: true }) as string[])
			: [];
		assert.ok(
			listing.some((f) => String(f).includes("index-")),
			`pre-migration backup snapshot written under Backup/ (got: ${listing.join(", ") || "no Backup dir"})`,
		);
	});
});