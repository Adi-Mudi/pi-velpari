// Unit tests — io/db-schema.ts (Phase 2: core schema DDL v001; Phase 4 final
// amendment: per-run composite PKs, composite same-run FKs, links.run_id,
// dual feasibility vocabulary).
// Covers: v001 application + table/index inventory, envelope FK integrity +
// cascade, status CHECK (Q2), STRICT enforcement, links CHECKs (G6),
// FK chains + step_dep self-edge ban, per-run PK coexistence + same-run
// duplicate rejection + cross-run FK rejection, quick_check (G4), store path
// helpers, feasibility trio (3.1; dual vocab per Phase 4 amendment).
// Assertions follow observed node:sqlite driver behavior (probe-verified).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";
import {
	STORE_DB_DIR,
	buildStoreDbPath,
	buildStoreYamlPath,
} from "../../src/core/paths.js";

const EXPECTED_TABLES = [
	"adr",
	"approach",
	"artifacts",
	"atomic_function",
	"design_module",
	"dev_step",
	"diagram",
	"feasibility_decision",
	"feasibility_spike",
	"final_section",
	"fr",
	"links",
	"module_source_fr",
	"nfr",
	"prd_section",
	"pseudocode_block",
	"reuse_scan",
	"rtm_row",
	"step_af",
	"step_dep",
	"tc_trace",
	"test_case",
];

/** Insert an envelope row (defaults: draft status, empty inputs/change_log). */
function insertEnvelope(db: DatabaseSync, runId: string, kind: string): void {
	db.prepare(
		"INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint) VALUES (?, ?, 1, 'stage', '2026-09-22T00:00:00Z', 'abc')",
	).run(runId, kind);
}

describe("db-schema — v001 core schema", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-schema-"));
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("v001 applied: user_version = 1, all tables + G6 indexes present", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			const v = db.prepare("PRAGMA user_version").get() as {
				user_version: number;
			};
			assert.equal(v.user_version, 1);
			const tables = (
				db
					.prepare(
						"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
					)
					.all() as Array<{ name: string }>
			).map((r) => r.name);
			assert.deepEqual(tables, EXPECTED_TABLES);
			const idx = (
				db
					.prepare(
						"SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name",
					)
					.all() as Array<{ name: string }>
			).map((r) => r.name);
			assert.deepEqual(idx, ["idx_links_from", "idx_links_to"]);
		} finally {
			closeStoreDb(db);
		}
	});

	test("envelope FK: child insert with unknown (run_id, kind) violates; valid insert works; envelope delete cascades", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			insertEnvelope(db, "r1", "prd");
			db.prepare(
				"INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')",
			).run();
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('rX', 'prd', 'FR-2', 1, 'h2')",
						)
						.run(),
				/FOREIGN KEY constraint failed/,
			);
			// Cascade: deleting the envelope removes its children (via the
			// artifacts FK and then downstream rtm_row rows via fr_ref).
			insertEnvelope(db, "r1", "rtm");
			db.prepare(
				"INSERT INTO rtm_row (run_id, kind, id, fr_ref, phase, target_sha256) VALUES ('r1', 'rtm', 'RTM-1', 'FR-1', 1, 't1')",
			).run();
			db.prepare("DELETE FROM artifacts WHERE run_id = 'r1' AND kind = 'prd'").run();
			assert.equal(
				(db.prepare("SELECT COUNT(*) AS n FROM fr").get() as { n: number }).n,
				0,
			);
			assert.equal(
				(db.prepare("SELECT COUNT(*) AS n FROM rtm_row").get() as { n: number }).n,
				0,
				"rtm_row cascades away when its referenced fr row is cascade-deleted",
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("status CHECK (Q2): only draft/published accepted on artifact tables", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			insertEnvelope(db, "r1", "prd");
			db.prepare(
				"INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')",
			).run();
			// Default is draft (checked before any update touches this row).
			const s0 = db.prepare("SELECT status FROM fr WHERE id = 'FR-1'").get() as {
				status: string;
			};
			assert.equal(s0.status, "draft");
			db.prepare("UPDATE fr SET status = 'published' WHERE id = 'FR-1'").run();
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO fr (run_id, kind, id, phase, text_hash, status) VALUES ('r1', 'prd', 'FR-2', 1, 'h2', 'live')",
						)
						.run(),
				/CHECK constraint failed/,
			);
			assert.throws(
				() =>
					db
						.prepare("UPDATE fr SET status = 'archived' WHERE id = 'FR-1'")
						.run(),
				/CHECK constraint failed/,
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("STRICT: wrong column type rejected (TEXT into INTEGER phase)", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			insertEnvelope(db, "r1", "prd");
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 'one', 'h1')",
						)
						.run(),
				/cannot store TEXT value in INTEGER column/,
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("links (G6): valid edge accepted, PK dedupes per-run, bad relation/kind rejected", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			db.prepare(
				"INSERT INTO links VALUES ('r1', 'fr', 'FR-1', 'rtm', 'RTM-1', 'traces')",
			).run();
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO links VALUES ('r1', 'fr', 'FR-1', 'rtm', 'RTM-1', 'traces')",
						)
						.run(),
				/UNIQUE constraint failed/,
			);
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO links VALUES ('r1', 'fr', 'FR-1', 'rtm', 'RTM-1', 'owns')",
						)
						.run(),
				/CHECK constraint failed/,
			);
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO links VALUES ('r1', 'foo', 'FR-1', 'rtm', 'RTM-1', 'traces')",
						)
						.run(),
				/CHECK constraint failed/,
			);
			assert.equal(
				(db.prepare("SELECT COUNT(*) AS n FROM links").get() as { n: number }).n,
				1,
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("per-run PKs (Phase 4 amendment): cross-run same-id coexistence + same-run duplicate rejection", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			insertEnvelope(db, "r1", "prd");
			insertEnvelope(db, "r2", "prd");
			// Same natural id in two runs — coexistence is the update-mode invariant.
			db.prepare(
				"INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')",
			).run();
			db.prepare(
				"INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r2', 'prd', 'FR-1', 1, 'h2')",
			).run();
			assert.equal(
				(db.prepare("SELECT COUNT(*) AS n FROM fr").get() as { n: number }).n,
				2,
			);
			// Within one run the natural key is still unique.
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h3')",
						)
						.run(),
				/UNIQUE constraint failed|PRIMARY KEY constraint failed/,
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("composite same-run FKs: cross-run references structurally impossible", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			insertEnvelope(db, "r1", "prd");
			insertEnvelope(db, "r1", "rtm");
			insertEnvelope(db, "r2", "rtm");
			db.prepare(
				"INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')",
			).run();
			// r2's rtm_row cannot reference r1's FR-1 — the FK is (run_id, fr_ref).
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO rtm_row (run_id, kind, id, fr_ref, phase, target_sha256) VALUES ('r2', 'rtm', 'RTM-1', 'FR-1', 1, 't1')",
						)
						.run(),
				/FOREIGN KEY constraint failed/,
			);
			// Same-run reference still works.
			db.prepare(
				"INSERT INTO rtm_row (run_id, kind, id, fr_ref, phase, target_sha256) VALUES ('r1', 'rtm', 'RTM-1', 'FR-1', 1, 't1')",
			).run();
		} finally {
			closeStoreDb(db);
		}
	});

	test("FK chains: rtm_row.fr_ref and pseudocode_block.af_ref enforced; step_dep self-edge banned", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			insertEnvelope(db, "r1", "prd");
			insertEnvelope(db, "r1", "rtm");
			insertEnvelope(db, "r1", "pseudocode");
			insertEnvelope(db, "r1", "development-order");
			insertEnvelope(db, "r1", "atomic-functions");
			db.prepare(
				"INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')",
			).run();
			db.prepare(
				"INSERT INTO rtm_row (run_id, kind, id, fr_ref, phase, target_sha256) VALUES ('r1', 'rtm', 'RTM-1', 'FR-1', 1, 't1')",
			).run();
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO rtm_row (run_id, kind, id, fr_ref, phase, target_sha256) VALUES ('r1', 'rtm', 'RTM-2', 'FR-99', 1, 't2')",
						)
						.run(),
				/FOREIGN KEY constraint failed/,
			);
			db.prepare(
				"INSERT INTO atomic_function (run_id, kind, id, name, signature, tier, criticality, sil, is_leaf) VALUES ('r1', 'atomic-functions', 'AF-1', 'doThing', 'doThing(): void', 'basic', 'A', 'none', 1)",
			).run();
			db.prepare(
				"INSERT INTO pseudocode_block (run_id, kind, id, af_ref, content_hash) VALUES ('r1', 'pseudocode', 'PC-1', 'AF-1', 'ch1')",
			).run();
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO pseudocode_block (run_id, kind, id, af_ref, content_hash) VALUES ('r1', 'pseudocode', 'PC-2', 'AF-99', 'ch2')",
						)
						.run(),
				/FOREIGN KEY constraint failed/,
			);
			db.prepare(
				"INSERT INTO dev_step (run_id, kind, id, module) VALUES ('r1', 'development-order', 'S1', 'm')",
			).run();
			db.prepare(
				"INSERT INTO dev_step (run_id, kind, id, module) VALUES ('r1', 'development-order', 'S2', 'm')",
			).run();
			db.prepare(
				"INSERT INTO step_dep (run_id, kind, step_id, depends_on_id) VALUES ('r1', 'development-order', 'S2', 'S1')",
			).run();
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO step_dep (run_id, kind, step_id, depends_on_id) VALUES ('r1', 'development-order', 'S1', 'S1')",
						)
						.run(),
				/CHECK constraint failed: step_id <> depends_on_id/,
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("feasibility tables (3.1): dual-vocab verdict CHECK + per-run natural PKs + envelope cascade", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			insertEnvelope(db, "r1", "feasibility");
			insertEnvelope(db, "r2", "feasibility");
			db.prepare(
				"INSERT INTO feasibility_decision (run_id, kind, verdict, decided_by, at) VALUES ('r1', 'feasibility', 'go', 'user', '2026-09-22T00:00:00Z')",
			).run();
			// verdict CHECK rejects values outside BOTH vocabularies.
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO feasibility_decision (run_id, kind, verdict, decided_by, at) VALUES ('r1', 'feasibility', 'maybe', 'user', 't2')",
						)
						.run(),
				/CHECK constraint failed/,
			);
			// One decision row per publish — PRIMARY KEY (run_id).
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO feasibility_decision (run_id, kind, verdict, decided_by, at) VALUES ('r1', 'feasibility', 'no-go', 'user', 't3')",
						)
						.run(),
				/UNIQUE constraint failed|PRIMARY KEY constraint failed/,
			);
			// Dual vocabulary (Phase 4 amendment): the verified record's
			// reuse/partial/build accepted verbatim, cross-run.
			for (const verdict of ["reuse", "partial", "build"]) {
				db.prepare(
					"INSERT INTO feasibility_decision (run_id, kind, verdict, language, decided_by, at) VALUES ('r2', 'feasibility', ?, 'typescript', 'user', 't4')",
				).run(verdict);
				db.prepare(
					"DELETE FROM feasibility_decision WHERE run_id = 'r2'",
				).run();
			}
			// Spike: language natural key + passed CHECK.
			db.prepare(
				"INSERT INTO feasibility_spike (run_id, kind, language, passed, result_ref) VALUES ('r1', 'feasibility', 'typescript', 1, 'spike-out')",
			).run();
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO feasibility_spike (run_id, kind, language, passed) VALUES ('r1', 'feasibility', 'typescript', 0)",
						)
						.run(),
				/UNIQUE constraint failed|PRIMARY KEY constraint failed/,
			);
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO feasibility_spike (run_id, kind, language, passed) VALUES ('r1', 'feasibility', 'golang', 2)",
						)
						.run(),
				/CHECK constraint failed/,
			);
			// reuse_scan: candidate natural key, nullable license/freshness.
			db.prepare(
				"INSERT INTO reuse_scan (run_id, kind, candidate, license, repo_freshness, verdict) VALUES ('r1', 'feasibility', 'lib-a', 'MIT', 'fresh', 'reuse')",
			).run();
			db.prepare(
				"INSERT INTO reuse_scan (run_id, kind, candidate, verdict) VALUES ('r1', 'feasibility', 'lib-b', 'build')",
			).run();
			// Envelope delete cascades all three feasibility child tables.
			db.prepare(
				"DELETE FROM artifacts WHERE run_id = 'r1' AND kind = 'feasibility'",
			).run();
			for (const table of [
				"feasibility_decision",
				"feasibility_spike",
				"reuse_scan",
			]) {
				const row = db
					.prepare("SELECT COUNT(*) AS n FROM " + table)
					.get() as { n: number };
				assert.equal(row.n, 0, table + " should be cascade-empty");
			}
		} finally {
			closeStoreDb(db);
		}
	});

	test("G4: quick_check reports ok after v001 DDL", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			const row = db.prepare("PRAGMA quick_check").get() as Record<
				string,
				unknown
			>;
			assert.equal(Object.values(row)[0], "ok");
		} finally {
			closeStoreDb(db);
		}
	});

	test("store path helpers (2.1): locked layout + sanitization (G10/RES-4)", () => {
		assert.equal(STORE_DB_DIR, "Doc/store");
		const cwd = "/proj";
		assert.equal(
			buildStoreDbPath("TodoApp", cwd),
			join(cwd, "Doc", "store", "TodoApp", "index.db"),
		);
		assert.equal(
			buildStoreDbPath("Weird Name/x", cwd),
			join(cwd, "Doc", "store", "Weird-Name-x", "index.db"),
		);
		assert.equal(
			buildStoreYamlPath("TodoApp", "PRD", cwd),
			join(cwd, "Doc", "store", "TodoApp", "PRD_TodoApp.yaml"),
		);
		assert.equal(
			buildStoreYamlPath("TodoApp", "test-cases", cwd),
			join(cwd, "Doc", "store", "TodoApp", "test-cases_TodoApp.yaml"),
		);
	});
});
