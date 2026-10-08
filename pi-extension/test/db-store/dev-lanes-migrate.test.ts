// Unit tests — io/db.ts migration v004 → v005 (Phase 7 / N16, dev lanes).
// Covers: a genuine v004-era store (crafted by running only MIGRATIONS ≤ 4)
// opens through the registered chain, reaches user_version 5, gains the two
// new tables, keeps every pre-existing dev_step/step_dep row byte-identical,
// and starts with empty lane tables (nothing backfilled by the migration).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStoreDb, closeStoreDb, maxKnownVersion, MIGRATIONS } from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";

interface StepRow {
	run_id: string;
	kind: string;
	id: string;
	module: string;
	status: string;
}

interface DepRow {
	run_id: string;
	kind: string;
	step_id: string;
	depends_on_id: string;
}

describe("io/db — v004 → v005 dev-lanes migration", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-migrate-v005-"));
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	/** Rows the v004-era fixture carries, captured before the migration. */
	function readRun(db: DatabaseSync): { steps: StepRow[]; deps: DepRow[] } {
		const steps = db
			.prepare("SELECT run_id, kind, id, module, status FROM dev_step ORDER BY id")
			.all() as unknown as StepRow[];
		const deps = db
			.prepare("SELECT run_id, kind, step_id, depends_on_id FROM step_dep ORDER BY step_id, depends_on_id")
			.all() as unknown as DepRow[];
		return { steps, deps };
	}

	test("v004-era fixture migrates to v005: rows intact, lane tables empty", async () => {
		const path = join(dir, "index.db");

		// Craft the old store: same PRAGMAs + migrations 0..4 only.
		const sqlite = (await import("node:sqlite")) as typeof import("node:sqlite");
		const legacy = new sqlite.DatabaseSync(path);
		let before: { steps: StepRow[]; deps: DepRow[] };
		try {
			legacy.exec("PRAGMA journal_mode = WAL;");
			legacy.exec("PRAGMA foreign_keys = ON;");
			for (const migration of MIGRATIONS) {
				if (migration.version <= 4) migration.up(legacy);
			}
			legacy.exec("PRAGMA user_version = 4");
			assert.equal(
				(legacy.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
				4,
				"fixture is a genuine v004-era DB",
			);

			legacy
				.prepare(
					"INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint) VALUES ('r1', 'development-order', 1, 'ordering-development', '2026-09-27T00:00:00Z', 'fp')",
				)
				.run();
			for (const [id, module] of [
				["DO-1", "M-1 (core)"],
				["DO-2", "M-2 (api)"],
				["DO-3", "M-3 (database)"],
			] as const) {
				legacy
					.prepare("INSERT INTO dev_step (run_id, kind, id, module) VALUES ('r1', 'development-order', ?, ?)")
					.run(id, module);
			}
			for (const [stepId, dependsOn] of [
				["DO-2", "DO-1"],
				["DO-3", "DO-2"],
			] as const) {
				legacy
					.prepare(
						"INSERT INTO step_dep (run_id, kind, step_id, depends_on_id) VALUES ('r1', 'development-order', ?, ?)",
					)
					.run(stepId, dependsOn);
			}
			before = readRun(legacy);
		} finally {
			legacy.close();
		}
		assert.equal(before.steps.length, 3, "fixture carries 3 steps");
		assert.equal(before.deps.length, 2, "fixture carries 2 dependency edges");

		// Registered open → migration 5 runs on top of the old store.
		const db = openStoreDb(path);
		try {
			const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			assert.equal(version, maxKnownVersion(), "reached the newest registered migration");
			assert.ok(
				(MIGRATIONS as readonly { version: number }[]).some((m) => m.version === 5),
				"v005 is registered (dev lanes)",
			);

			const tables = new Set(
				(
					db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
						name: string;
					}>
				).map((r) => r.name),
			);
			assert.ok(tables.has("dev_lane"), "dev_lane created by the migration");
			assert.ok(tables.has("dev_lane_xdep"), "dev_lane_xdep created by the migration");

			const after = readRun(db);
			assert.deepEqual(after.steps, before.steps, "pre-existing dev_step rows byte-identical");
			assert.deepEqual(after.deps, before.deps, "pre-existing step_dep rows byte-identical");

			const lanes = db.prepare("SELECT COUNT(*) AS n FROM dev_lane").get() as { n: number };
			const xdeps = db.prepare("SELECT COUNT(*) AS n FROM dev_lane_xdep").get() as { n: number };
			assert.equal(lanes.n, 0, "migration backfills no lanes");
			assert.equal(xdeps.n, 0, "migration backfills no integration points");

			const check = db.prepare("PRAGMA quick_check").get() as Record<string, unknown>;
			assert.equal(Object.values(check)[0], "ok", "store intact after the migration (G4)");
		} finally {
			closeStoreDb(db);
		}
	});

	test("re-opening a migrated store is idempotent: version stays, no duplicate DDL", async () => {
		const path = join(dir, "index.db");
		const first = openStoreDb(path);
		closeStoreDb(first);

		const second = openStoreDb(path);
		try {
			const version = (second.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			assert.equal(version, maxKnownVersion());
			const laneTables = (
				second
					.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('dev_lane', 'dev_lane_xdep')")
					.all() as Array<{ name: string }>
			).map((r) => r.name);
			assert.deepEqual([...laneTables].sort(), ["dev_lane", "dev_lane_xdep"]);
		} finally {
			closeStoreDb(second);
		}
	});
});
