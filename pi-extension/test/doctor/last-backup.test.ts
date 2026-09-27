/**
 * Last-verified-backup report tests (Phase 6 — N11).
 *
 * Covers: missing-config info, pre-store info, zero-backup warning
 * (store exists → warning, N11), the healthy proven report through the
 * real snapshot writer, failed verification (tampered bytes), the
 * manifest-without-files branch, and damaged manifest lines (readers
 * never throw).
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { createBackupSnapshot } from "../../src/core/backup.js";
import { buildStoreDbPath, buildBackupDir } from "../../src/core/paths.js";
import { checkLastBackupSection } from "../../src/doctor/checks/last-backup.js";
import { summarize } from "../../src/doctor/_types.js";

let dirs: string[] = [];
let cwd = "";

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-lastbackup-"));
	dirs.push(dir);
	cwd = dir;
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function seedConfig(config: Record<string, unknown> = {}): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TodoApp", ...config }),
		"utf8",
	);
}

/** Create the store DB (open + close) so "store exists" holds. */
function createStore(): string {
	const dbPath = buildStoreDbPath("TodoApp", cwd);
	const db = openStoreDb(dbPath);
	closeStoreDb(db);
	return dbPath;
}

function takeBackup(trigger: "publish" | "db-reset" | "migrate"): void {
	const dbPath = buildStoreDbPath("TodoApp", cwd);
	const rec = createBackupSnapshot({ cwd, projectName: "TodoApp", trigger, dbPath });
	assert.ok(rec, "snapshot must be created");
}

describe("checkLastBackupSection", () => {
	test("no config → single info item, no throw", () => {
		const section = checkLastBackupSection(cwd);
		assert.equal(section.title, "Last verified backup (N11)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
	});

	test("config but no store DB → info (no backups expected)", () => {
		seedConfig();
		const section = checkLastBackupSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /No store DB yet — no backups expected/);
	});

	test("store DB with no snapshots → WARNING (missing when they should exist)", () => {
		seedConfig();
		createStore();
		const section = checkLastBackupSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "warning");
		assert.match(section.items[0]?.message ?? "", /no backup under Backup\/velpari\/TodoApp/);
		assert.ok(section.items[0]?.suggestion);
		assert.equal(summarize([section]).summary.warning, 1);
	});

	test("real snapshot → ok report with filename, trigger, restore hint", () => {
		seedConfig();
		createStore();
		takeBackup("publish");
		const section = checkLastBackupSection(cwd);
		assert.equal(section.items.length, 1);
		const item = section.items[0];
		assert.equal(item?.status, "ok");
		assert.match(item?.message ?? "", /last backup index-.*\.db/);
		assert.match(item?.message ?? "", /trigger publish, quick_check ok/);
		assert.match(item?.message ?? "", /proven\.$/);
		assert.match(item?.suggestion ?? "", /restoreBackupSnapshot/);
	});

	test("tampered snapshot bytes → WARNING failed verification (digest mismatch)", () => {
		seedConfig();
		createStore();
		takeBackup("publish");
		const dir = buildBackupDir("TodoApp", cwd);
		const file = readdirSync(dir).find((n) => /^index-.*\.db$/.test(n));
		assert.ok(file);
		const path = join(dir, file);
		const buf = readFileSync(path);
		buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff;
		writeFileSync(path, buf);

		const section = checkLastBackupSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "warning");
		assert.match(section.items[0]?.message ?? "", /failed verification/);
	});

	test("manifest lists a backup but files are gone → WARNING", () => {
		seedConfig();
		createStore();
		takeBackup("publish");
		const dir = buildBackupDir("TodoApp", cwd);
		for (const n of readdirSync(dir)) {
			if (/^index-.*\.db$/.test(n)) rmSync(join(dir, n));
		}
		const section = checkLastBackupSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "warning");
		assert.match(section.items[0]?.message ?? "", /manifest lists 1 backup\(s\) but no snapshot files remain/);
	});

	test("damaged manifest lines → readers skip, check still renders (no throw)", () => {
		seedConfig();
		createStore();
		takeBackup("publish");
		const manifest = join(buildBackupDir("TodoApp", cwd), "manifest.jsonl");
		writeFileSync(manifest, '{"type": "backup"\n{not json\n', "utf8");
		const section = checkLastBackupSection(cwd);
		assert.equal(section.items.length, 1);
		// damaged lines are skipped → no manifest entry → verification warning
		assert.equal(section.items[0]?.status, "warning");
		assert.match(section.items[0]?.message ?? "", /failed verification/);
	});
});
