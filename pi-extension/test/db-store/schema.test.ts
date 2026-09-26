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
import { STORE_DB_DIR, buildStoreDbPath, buildStoreYamlPath } from "../../src/core/paths.js";

const EXPECTED_TABLES = [
	"adr",
	"approach",
	"artifact_revisions",
	"artifacts",
	"atomic_function",
	"audit_ledger",
	"baselines",
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
	"store_meta",
	"tc_trace",
	"test_case",
	"tx_log",
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

	test("v001 applied: user_version >= 1 (v4 after the v002 prose + v003 store_meta + v004 revision migrations), all tables + G6 indexes present", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			const v = db.prepare("PRAGMA user_version").get() as {
				user_version: number;
			};
			assert.ok(v.user_version >= 1, "v001 DDL applied (user_version >= 1)");
			const tables = (
				db
					.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
					.all() as Array<{ name: string }>
			).map((r) => r.name);
			assert.deepEqual(tables, EXPECTED_TABLES);
			const idx = (
				db
					.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
					.all() as Array<{ name: string }>
			).map((r) => r.name);
			assert.deepEqual(idx, ["idx_links_from", "idx_links_to", "idx_revisions_kind"]);
		} finally {
			closeStoreDb(db);
		}
	});

	test("envelope FK: child insert with unknown (run_id, kind) violates; valid insert works; envelope delete cascades", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			insertEnvelope(db, "r1", "prd");
			db.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')").run();
			assert.throws(
				() =>
					db.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('rX', 'prd', 'FR-2', 1, 'h2')").run(),
				/FOREIGN KEY constraint failed/,
			);
			// Cascade: deleting the envelope removes its children (via the
			// artifacts FK and then downstream rtm_row rows via fr_ref).
			insertEnvelope(db, "r1", "rtm");
			db.prepare(
				"INSERT INTO rtm_row (run_id, kind, id, fr_ref, phase, target_sha256) VALUES ('r1', 'rtm', 'RTM-1', 'FR-1', 1, 't1')",
			).run();
			db.prepare("DELETE FROM artifacts WHERE run_id = 'r1' AND kind = 'prd'").run();
			assert.equal((db.prepare("SELECT COUNT(*) AS n FROM fr").get() as { n: number }).n, 0);
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
			db.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')").run();
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
				() => db.prepare("UPDATE fr SET status = 'archived' WHERE id = 'FR-1'").run(),
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
						.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 'one', 'h1')")
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
			db.prepare("INSERT INTO links VALUES ('r1', 'fr', 'FR-1', 'rtm', 'RTM-1', 'traces')").run();
			assert.throws(
				() => db.prepare("INSERT INTO links VALUES ('r1', 'fr', 'FR-1', 'rtm', 'RTM-1', 'traces')").run(),
				/UNIQUE constraint failed/,
			);
			assert.throws(
				() => db.prepare("INSERT INTO links VALUES ('r1', 'fr', 'FR-1', 'rtm', 'RTM-1', 'owns')").run(),
				/CHECK constraint failed/,
			);
			assert.throws(
				() => db.prepare("INSERT INTO links VALUES ('r1', 'foo', 'FR-1', 'rtm', 'RTM-1', 'traces')").run(),
				/CHECK constraint failed/,
			);
			assert.equal((db.prepare("SELECT COUNT(*) AS n FROM links").get() as { n: number }).n, 1);
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
			db.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')").run();
			db.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r2', 'prd', 'FR-1', 1, 'h2')").run();
			assert.equal((db.prepare("SELECT COUNT(*) AS n FROM fr").get() as { n: number }).n, 2);
			// Within one run the natural key is still unique.
			assert.throws(
				() =>
					db.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h3')").run(),
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
			db.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')").run();
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
			db.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')").run();
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
			db.prepare("INSERT INTO dev_step (run_id, kind, id, module) VALUES ('r1', 'development-order', 'S1', 'm')").run();
			db.prepare("INSERT INTO dev_step (run_id, kind, id, module) VALUES ('r1', 'development-order', 'S2', 'm')").run();
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
				db.prepare("DELETE FROM feasibility_decision WHERE run_id = 'r2'").run();
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
			db.prepare("DELETE FROM artifacts WHERE run_id = 'r1' AND kind = 'feasibility'").run();
			for (const table of ["feasibility_decision", "feasibility_spike", "reuse_scan"]) {
				const row = db.prepare("SELECT COUNT(*) AS n FROM " + table).get() as { n: number };
				assert.equal(row.n, 0, table + " should be cascade-empty");
			}
		} finally {
			closeStoreDb(db);
		}
	});

	test("G4: quick_check reports ok after v001 DDL", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			const row = db.prepare("PRAGMA quick_check").get() as Record<string, unknown>;
			assert.equal(Object.values(row)[0], "ok");
		} finally {
			closeStoreDb(db);
		}
	});

	test("store path helpers (2.1): locked layout + sanitization (G10/RES-4)", () => {
		assert.equal(STORE_DB_DIR, "Doc/store");
		const cwd = "/proj";
		assert.equal(buildStoreDbPath("TodoApp", cwd), join(cwd, "Doc", "store", "TodoApp", "index.db"));
		assert.equal(buildStoreDbPath("Weird Name/x", cwd), join(cwd, "Doc", "store", "Weird-Name-x", "index.db"));
		assert.equal(buildStoreYamlPath("TodoApp", "PRD", cwd), join(cwd, "Doc", "store", "TodoApp", "PRD_TodoApp.yaml"));
		assert.equal(
			buildStoreYamlPath("TodoApp", "test-cases", cwd),
			join(cwd, "Doc", "store", "TodoApp", "test-cases_TodoApp.yaml"),
		);
	});
});

/**
 * Phase 6 amendment (decision §14): the prose columns listed in §14.4 land
 * as a forward-only ALTER TABLE migration v2. Each new column is TEXT and
 * nullable so existing rows stay valid with NULL prose until re-published
 * or backfilled. ADD COLUMN is supported since SQLite 3.1.3 (no gate).
 */
describe("db-schema — v002 prose columns (Phase 6, §14)", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-schema-v002-"));
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	/** Columns the v002 amendment must land (table → column → table for inspection). */
	const V002_COLUMNS: ReadonlyArray<[string, string]> = [
		["fr", "text"],
		["nfr", "text"],
		["prd_section", "body"],
		["pseudocode_block", "content"],
		["test_case", "steps"],
		["test_case", "objective"],
		["test_case", "expected"],
		["design_module", "description"],
		["atomic_function", "purpose"],
		["atomic_function", "source"],
		["atomic_function", "cohesion"],
		["atomic_function", "verification"],
		["atomic_function", "testable"],
		["dev_step", "description"],
	];

	test("v002 applies on a fresh open: user_version = 4 (v002 + v003 store_meta + v004 revision model), all 14 prose columns present + nullable", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			const v = db.prepare("PRAGMA user_version").get() as {
				user_version: number;
			};
			assert.equal(v.user_version, 4, "v002 + v003 + v004 migrations applied → user_version = 4");
			for (const [table, col] of V002_COLUMNS) {
				const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
					name: string;
					notnull: number;
					type: string;
				}>;
				const found = info.find((r) => r.name === col);
				assert.ok(found, `column ${table}.${col} must exist after v002`);
				assert.equal(found.type.toUpperCase(), "TEXT", `${table}.${col} type = TEXT`);
				assert.equal(found.notnull, 0, `${table}.${col} is nullable (NOT NULL = 0)`);
			}
			// Schema integrity still ok after the migration (G4 + Phase 2 invariant).
			const row = db.prepare("PRAGMA quick_check").get() as Record<string, unknown>;
			assert.equal(Object.values(row)[0], "ok");
		} finally {
			closeStoreDb(db);
		}
	});

	test("v002 idempotent: re-opening the same DB does not re-run the migration", () => {
		const path = join(dir, "index.db");
		const db1 = openStoreDb(path);
		closeStoreDb(db1);
		const db2 = openStoreDb(path);
		try {
			const v = db2.prepare("PRAGMA user_version").get() as {
				user_version: number;
			};
			assert.equal(v.user_version, 4);
		} finally {
			closeStoreDb(db2);
		}
	});

	test("G3 downgrade guard: user_version > 4 refuses to open", async () => {
		const path = join(dir, "index.db");
		const seed = openStoreDb(path);
		closeStoreDb(seed);
		// Bump to v5 — a future, unknown migration. This extension only knows up to v4.
		// Uses dynamic import (ESM-friendly) to reach node:sqlite without polluting
		// the registered lazy loader. The test proves the downgrade guard reads
		// PRAGMA user_version directly and refuses an opening from an older extension.
		const sqlite = (await import("node:sqlite")) as typeof import("node:sqlite");
		const bump = new sqlite.DatabaseSync(path);
		bump.exec("PRAGMA user_version = 5");
		bump.close();
		assert.throws(() => openStoreDb(path), /schema version|Upgrade your extension/);
	});

	test("prose columns land with NULL on existing rows after a v001→v002 migration", () => {
		const path = join(dir, "index.db");
		const seed = openStoreDb(path);
		try {
			insertEnvelope(seed, "r1", "prd");
			insertEnvelope(seed, "r1", "pseudocode");
			insertEnvelope(seed, "r1", "testplan");
			insertEnvelope(seed, "r1", "atomic-functions");
			insertEnvelope(seed, "r1", "design");
			insertEnvelope(seed, "r1", "development-order");
			seed.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'FR-1', 1, 'h1')").run();
			seed.prepare("INSERT INTO nfr (run_id, kind, id, phase, text_hash) VALUES ('r1', 'prd', 'NFR-1', 1, 'h2')").run();
		} finally {
			closeStoreDb(seed);
		}
		// Re-open via the registered flow — migration applies, rows stay.
		const reopened = openStoreDb(path);
		try {
			const frText = reopened.prepare("SELECT text FROM fr WHERE id = 'FR-1'").get() as { text: unknown };
			const nfrText = reopened.prepare("SELECT text FROM nfr WHERE id = 'NFR-1'").get() as { text: unknown };
			assert.equal(frText.text, null, "v001 rows carry NULL prose before backfill/republish");
			assert.equal(nfrText.text, null);
		} finally {
			closeStoreDb(reopened);
		}
	});

	test("tables untouched by v002 still keep their v001 shape (no accidental drops)", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			// art / rtm_row / diagram / adr / feasibility_* / links have no
			// new prose columns per §14.4. Spot-check a couple of column lists.
			const rtmCols = (db.prepare("PRAGMA table_info(rtm_row)").all() as Array<{ name: string }>).map((r) => r.name);
			assert.ok(rtmCols.includes("fr_ref"));
			assert.ok(rtmCols.includes("af_ref"));
			const adrCols = (db.prepare("PRAGMA table_info(adr)").all() as Array<{ name: string }>).map((r) => r.name);
			assert.ok(adrCols.includes("options"));
			assert.ok(adrCols.includes("chosen"));
			assert.ok(adrCols.includes("rationale"));
			const linksCols = (db.prepare("PRAGMA table_info(links)").all() as Array<{ name: string }>).map((r) => r.name);
			assert.equal(linksCols.length, 6, "links table still has 6 columns (no adds)");
		} finally {
			closeStoreDb(db);
		}
	});
});

/**
 * Foundation (2026-09-27): v004 revision model + audit core. Immutable
 * full-snapshot history lives in `artifact_revisions` (no artifacts rebuild);
 * freeze lives on `artifacts`; audit_ledger/tx_log are hash-chained.
 */
describe("db-schema — v004 revision model (Foundation)", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-schema-v004-"));
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function columnNames(db: DatabaseSync, table: string): string[] {
		return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
	}

	test("artifacts gains head_revision_id / frozen / freeze_reason; frozen defaults to 0", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			const cols = columnNames(db, "artifacts");
			assert.ok(cols.includes("head_revision_id"));
			assert.ok(cols.includes("frozen"));
			assert.ok(cols.includes("freeze_reason"));
			insertEnvelope(db, "r1", "prd");
			const row = db
				.prepare("SELECT frozen, freeze_reason, head_revision_id FROM artifacts WHERE run_id = 'r1' AND kind = 'prd'")
				.get() as {
				frozen: number;
				freeze_reason: unknown;
				head_revision_id: unknown;
			};
			assert.equal(row.frozen, 0, "new artifacts rows are unfrozen by default");
			assert.equal(row.freeze_reason, null);
			assert.equal(row.head_revision_id, null);
		} finally {
			closeStoreDb(db);
		}
	});

	test("artifact_revisions: UNIQUE(kind, revision_number), status CHECK rejects 'frozen', STRICT mode", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			const insert = db.prepare(
				"INSERT INTO artifact_revisions (kind, run_id, revision_number, version, stage, generated_at, published_at, sha256_fingerprint, yaml_bytes) VALUES (?, ?, ?, 1, 'stage', '2026-09-27T00:00:00Z', '2026-09-27T00:00:01Z', 'fp', 'yaml: bytes')",
			);
			insert.run("prd", "r1", 1);
			assert.throws(() => insert.run("prd", "r2", 1), /UNIQUE/i, "duplicate (kind, revision_number) rejected");
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO artifact_revisions (kind, run_id, revision_number, status, version, stage, generated_at, published_at, sha256_fingerprint, yaml_bytes) VALUES ('rtm', 'r1', 1, 'frozen', 1, 'stage', '2026-09-27T00:00:00Z', '2026-09-27T00:00:01Z', 'fp', 'y')",
						)
						.run(),
				/CHECK/i,
				"status 'frozen' rejected — freeze lives on artifacts, not revisions",
			);
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO artifact_revisions (kind, run_id, revision_number, version, stage, generated_at, published_at, sha256_fingerprint, yaml_bytes) VALUES ('design', 'r1', 1, 'not-a-number', 'stage', '2026-09-27T00:00:00Z', '2026-09-27T00:00:01Z', 'fp', 'y')",
						)
						.run(),
				/STRICT|datatype|cannot store/i,
				"STRICT mode rejects wrong types",
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("artifact_revisions: supersedes_revision_id is a real FK to artifact_revisions", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			const insert = db.prepare(
				"INSERT INTO artifact_revisions (kind, run_id, revision_number, supersedes_revision_id, version, stage, generated_at, published_at, sha256_fingerprint, yaml_bytes) VALUES (?, ?, ?, ?, 1, 'stage', '2026-09-27T00:00:00Z', '2026-09-27T00:00:01Z', 'fp', 'y')",
			);
			insert.run("prd", "r1", 1, null);
			const first = db
				.prepare("SELECT revision_id FROM artifact_revisions WHERE kind = 'prd' AND revision_number = 1")
				.get() as {
				revision_id: number;
			};
			insert.run("prd", "r1", 2, first.revision_id);
			assert.throws(
				() => insert.run("rtm", "r1", 1, 999999),
				/FOREIGN KEY/i,
				"dangling supersedes_revision_id rejected",
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("baselines: composite PK (kind, consumer_stage) + FK to artifact_revisions", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			db.prepare(
				"INSERT INTO artifact_revisions (kind, run_id, revision_number, version, stage, generated_at, published_at, sha256_fingerprint, yaml_bytes) VALUES ('prd', 'r1', 1, 1, 'stage', '2026-09-27T00:00:00Z', '2026-09-27T00:00:01Z', 'fp', 'y')",
			).run();
			const rev = db.prepare("SELECT revision_id FROM artifact_revisions WHERE kind = 'prd'").get() as {
				revision_id: number;
			};
			const insert = db.prepare(
				"INSERT INTO baselines (kind, consumer_stage, revision_id, baselined_at) VALUES (?, ?, ?, ?)",
			);
			insert.run("prd", "building-rtm", rev.revision_id, "2026-09-27T00:00:02Z");
			assert.throws(
				() => insert.run("prd", "building-rtm", rev.revision_id, "2026-09-27T00:00:03Z"),
				/UNIQUE|PRIMARY/i,
				"duplicate (kind, consumer_stage) rejected",
			);
			assert.throws(
				() => insert.run("rtm", "designing", 999999, "2026-09-27T00:00:04Z"),
				/FOREIGN KEY/i,
				"dangling revision_id rejected",
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("audit_ledger + tx_log: entry_hash UNIQUE, tx_log outcome CHECK", () => {
		const db = openStoreDb(join(dir, "index.db"));
		try {
			const insertAudit = db.prepare(
				"INSERT INTO audit_ledger (at, actor, action, prev_hash, entry_hash) VALUES ('2026-09-27T00:00:00Z', 'test', 'publish', ?, ?)",
			);
			insertAudit.run("0".repeat(64), "aa");
			assert.throws(() => insertAudit.run("aa", "aa"), /UNIQUE/i, "duplicate entry_hash rejected");
			db.prepare(
				"INSERT INTO tx_log (at, actor, operation, outcome, prev_hash, entry_hash) VALUES ('2026-09-27T00:00:00Z', 'test', 'publish', 'commit', ?, 'bb')",
			).run("0".repeat(64));
			assert.throws(
				() =>
					db
						.prepare(
							"INSERT INTO tx_log (at, actor, operation, outcome, prev_hash, entry_hash) VALUES ('2026-09-27T00:00:01Z', 'test', 'reset', 'maybe', 'bb', 'cc')",
						)
						.run(),
				/CHECK/i,
				"outcome outside commit/rollback rejected",
			);
		} finally {
			closeStoreDb(db);
		}
	});
});
