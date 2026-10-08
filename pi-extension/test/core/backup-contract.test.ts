// Unit tests — core/backup.ts contract (Foundation 2026-09-27, N9/N10/N11;
// retargeted by Phase 3 2026-09-27 — the no-op default is gone, the contract
// Phases 1/2 compile against stays pinned).
// Covers: exact BACKUP_TRIGGERS, the three null-not-throw guard paths
// (rule 1/2), and the exact BackupRecord key set.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKUP_TRIGGERS, createBackupSnapshot } from "../../src/core/backup.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";

describe("backup contract (Phase 3 implementation)", () => {
	let root: string;

	before(() => {
		root = mkdtempSync(join(tmpdir(), "velpari-backup-contract-"));
	});

	after(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("BACKUP_TRIGGERS is exactly publish / db-reset / migrate", () => {
		assert.deepEqual([...BACKUP_TRIGGERS], ["publish", "db-reset", "migrate"]);
	});

	test("nonexistent dbPath → null for every trigger (never throws)", () => {
		for (const trigger of BACKUP_TRIGGERS) {
			const result = createBackupSnapshot({
				cwd: join(root, "missing-cwd"),
				projectName: "TestApp",
				trigger,
				dbPath: join(root, "missing", "index.db"),
			});
			assert.equal(result, null, `trigger ${trigger}`);
		}
		assert.equal(createBackupSnapshot === undefined, false, "still exported");
	});

	test("a directory instead of a file → null for every trigger (never throws)", () => {
		const dirAsDb = join(root, "dir-as-db");
		mkdirSync(dirAsDb, { recursive: true });
		for (const trigger of BACKUP_TRIGGERS) {
			const result = createBackupSnapshot({
				cwd: join(root, "dir-cwd"),
				projectName: "TestApp",
				trigger,
				dbPath: dirAsDb,
			});
			assert.equal(result, null, `trigger ${trigger}`);
		}
	});

	test("corrupt file → null for every trigger (never throws)", () => {
		const corrupt = join(root, "corrupt.db");
		writeFileSync(corrupt, "this is definitely not a sqlite database, it is text.", "utf8");
		for (const trigger of BACKUP_TRIGGERS) {
			const result = createBackupSnapshot({
				cwd: join(root, "corrupt-cwd"),
				projectName: "TestApp",
				trigger,
				dbPath: corrupt,
			});
			assert.equal(result, null, `trigger ${trigger}`);
		}
	});

	test("successful snapshot returns exactly the Foundation BackupRecord keys", () => {
		const cwd = join(root, "keys-cwd");
		mkdirSync(cwd, { recursive: true });
		const dbPath = join(cwd, "index.db");
		const db = openStoreDb(dbPath);
		try {
			db.exec("CREATE TABLE IF NOT EXISTS contract_t(id INTEGER PRIMARY KEY, v TEXT);");
			db.prepare("INSERT INTO contract_t(v) VALUES (?)").run("row-1");
		} finally {
			closeStoreDb(db);
		}

		const record = createBackupSnapshot({
			cwd,
			projectName: "ContractApp",
			trigger: "publish",
			dbPath,
		});
		assert.ok(record !== null, "snapshot should succeed");
		assert.deepEqual(
			Object.keys(record).sort(),
			["createdAt", "dbDigest", "gitCommit", "projectName", "quickCheckOk", "backupPath"].sort(),
			"Phase 1/2 call sites depend on this exact field set",
		);
		assert.equal(record.projectName, "ContractApp");
		assert.equal(typeof record.createdAt, "string");
		assert.equal(record.quickCheckOk, true);
	});
});
