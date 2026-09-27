/**
 * Performance budget — backup subsystem (Phase 3.5; Master Outline §5.1).
 *
 * Asserts that:
 *   - a snapshot of a ~200-row store DB finishes under 500ms
 *   - a FIFO prune cycle (5 snapshots, keep 3) finishes under 250ms
 *   - a `restoreBackupSnapshot` round trip finishes under 500ms
 *
 * All three are skipped unless RUN_PERF=1 (the CI perf job is soft-fail per
 * Master Outline §5.1; the budgets exist to catch an accidental
 * `integrity_check`/full-file loop creeping into these paths).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBackupSnapshot, restoreBackupSnapshot } from "../../src/core/backup.js";
import { buildBackupDir, buildStoreDbPath } from "../../src/core/paths.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";

const PERF_ENABLED = process.env.RUN_PERF === "1";
const PROJECT = "PerfApp";

/** Fixture store DB with `rows` rows in `perf_fixture`. */
function fixtureDb(cwd: string, rows: number): string {
	const dbPath = buildStoreDbPath(PROJECT, cwd);
	const db = openStoreDb(dbPath);
	try {
		db.exec("CREATE TABLE IF NOT EXISTS perf_fixture(id INTEGER PRIMARY KEY, v TEXT);");
		const insert = db.prepare("INSERT INTO perf_fixture(v) VALUES (?)");
		for (let i = 0; i < rows; i++) insert.run(`value-${i}`);
	} finally {
		closeStoreDb(db);
	}
	return dbPath;
}

function ms(fn: () => unknown): number {
	const start = Date.now();
	fn();
	return Date.now() - start;
}

describe("backup performance budget", () => {
	it("snapshot of a ~200-row store DB finishes under 500ms", { skip: !PERF_ENABLED }, () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-perf-backup-"));
		try {
			const dbPath = fixtureDb(cwd, 200);
			const elapsed = ms(() => {
				const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
				assert.ok(record !== null, "snapshot must succeed");
			});
			assert.ok(elapsed < 500, `snapshot took ${elapsed}ms (budget 500ms)`);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("FIFO prune cycle (5 snapshots, keep 3) finishes under 250ms", { skip: !PERF_ENABLED }, () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-perf-fifo-"));
		try {
			const dbPath = fixtureDb(cwd, 50);
			mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
			writeFileSync(
				join(cwd, ".pi", "velpari", "files.json"),
				JSON.stringify({
					version: 4,
					projectName: PROJECT,
					velpari: { retention: { revisions: "all", backups: 3 } },
				}),
				"utf8",
			);
			// Warm the folder (2 snapshots, no prune yet) so the budget times
			// the prune cycles rather than the very first VACUUM INTO.
			for (let i = 0; i < 2; i++) {
				assert.ok(createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath }));
			}
			const elapsed = ms(() => {
				for (let i = 0; i < 3; i++) {
					assert.ok(createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath }));
				}
			});
			const dir = buildBackupDir(PROJECT, cwd);
			const files = readdirSync(dir).filter((f) => f.endsWith(".db"));
			assert.equal(files.length, 3, "keep-last-3 applied");
			assert.ok(elapsed < 250, `3 prune cycles took ${elapsed}ms (budget 250ms)`);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("restoreBackupSnapshot round trip finishes under 500ms", { skip: !PERF_ENABLED }, () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-perf-restore-"));
		try {
			const dbPath = fixtureDb(cwd, 200);
			const record = createBackupSnapshot({ cwd, projectName: PROJECT, trigger: "publish", dbPath });
			assert.ok(record !== null);
			rmSync(dbPath, { force: true });

			const elapsed = ms(() => {
				const res = restoreBackupSnapshot({ cwd, projectName: PROJECT, backupPath: record.backupPath });
				assert.equal(res.ok, true, JSON.stringify(res.problems));
			});
			assert.ok(existsSync(dbPath), "target recreated");
			assert.ok(elapsed < 500, `restore took ${elapsed}ms (budget 500ms)`);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
