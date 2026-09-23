/**
 * Store DB integrity check tests (Phase 7, G4).
 *
 * Covers: standalone stamp (store_meta.integrity_checked_at written),
 * embedded run (no stamp — the post-publish doctor must never dirty a
 * just-committed DB), pre-store info note, missing-config info note,
 * v003 migration presence (user_version 3 + store_meta STRICT).
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStoreDb, closeStoreDb, storeMetaGet } from "../../src/io/db.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { checkDbIntegritySection } from "../../src/doctor/checks/integrity.js";
import type { DatabaseSync } from "node:sqlite";

let dirs: string[] = [];
let cwd = "";

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-integrity-"));
	dirs.push(dir);
	cwd = dir;
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Write a minimal valid files.json (single design). */
function seedConfig(projectName: string): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify({ version: 4, projectName }), "utf8");
}

/** Seed an empty store DB for the project (schema only). */
function seedStore(projectName: string): DatabaseSync {
	return openStoreDb(buildStoreDbPath(projectName, cwd));
}

describe("checkDbIntegritySection", () => {
	test("no config → single info item, no throw", () => {
		const section = checkDbIntegritySection(cwd);
		assert.equal(section.title, "Store DB integrity");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
	});

	test("config but no store DB → info note (pre-store project)", () => {
		seedConfig("TodoApp");
		const section = checkDbIntegritySection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /No store DB/);
	});

	test("v003 migration: fresh DB reaches user_version 3 with a STRICT store_meta table", () => {
		const db = seedStore("TodoApp");
		try {
			const at = db.prepare("PRAGMA user_version").get() as { user_version: number };
			assert.equal(at.user_version, 3);
			// STRICT: inserting a BLOB into a TEXT column must be rejected
			// (node:sqlite pre-converts numbers, so a BLOB is the reliable probe).
			assert.throws(() => {
				db.prepare("INSERT INTO store_meta VALUES (?, ?)").run(Buffer.from("k"), Buffer.from("v"));
			});
		} finally {
			closeStoreDb(db);
		}
	});

	test("standalone run: integrity ok + store_meta stamp written", () => {
		seedConfig("TodoApp");
		seedStore("TodoApp").close();
		const section = checkDbIntegritySection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /integrity ok/);
		// The stamp must exist and be an ISO timestamp.
		const db = openStoreDb(buildStoreDbPath("TodoApp", cwd));
		try {
			const stamp = storeMetaGet(db, "integrity_checked_at");
			assert.ok(stamp, "expected store_meta.integrity_checked_at after a standalone run");
			assert.match(stamp ?? "", /^\d{4}-\d{2}-\d{2}T/);
		} finally {
			closeStoreDb(db);
		}
	});

	test("embedded run (opts.embedded): no stamp — the committed DB stays clean", () => {
		seedConfig("TodoApp");
		seedStore("TodoApp").close();
		checkDbIntegritySection(cwd, { embedded: true });
		const db = openStoreDb(buildStoreDbPath("TodoApp", cwd));
		try {
			assert.equal(storeMetaGet(db, "integrity_checked_at"), null);
		} finally {
			closeStoreDb(db);
		}
	});

	test("standalone run after a stamp UPDATES the timestamp (not a duplicate row)", () => {
		seedConfig("TodoApp");
		seedStore("TodoApp").close();
		checkDbIntegritySection(cwd);
		checkDbIntegritySection(cwd);
		const db = openStoreDb(buildStoreDbPath("TodoApp", cwd));
		try {
			const rows = db.prepare("SELECT COUNT(*) AS n FROM store_meta WHERE key = 'integrity_checked_at'").get() as {
				n: number;
			};
			assert.equal(rows.n, 1);
		} finally {
			closeStoreDb(db);
		}
	});
});
