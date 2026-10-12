// Tests — io/db.ts eval DB additions (velpari-evals Phase A, Lane A1.4).
// Covers: migration creates the v1 schema (incl. the G1 `det_config_hash` and
// G4 `attempts` columns), insert/list round-trip, stage filter + limit,
// fresh/missing path reads empty, and the G3 downgrade guard.

import { describe, it, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EVAL_MIGRATIONS, closeStoreDb, insertEvalRow, listEvalRows, maxKnownVersion, openEvalDb } from "../src/io/db.js";
import type { EvalRow } from "../src/core/eval.js";
import { evalDbPath, evalDirPath } from "../src/core/paths.js";

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-eval-db-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** One fully-populated EvalRow for round-trip assertions. */
function sampleRow(overrides: Partial<EvalRow> = {}): EvalRow {
	return {
		project: "TestApp",
		runId: "run-1",
		stage: "building-rtm",
		artifactKind: "RTM",
		version: "1.2.0",
		model: "test-model",
		durationMs: 1234,
		detScores: [
			{ name: "freshness", score: 1 },
			{ name: "publish-gate", score: 0.5, detail: "one warning" },
		],
		judgeScores: null,
		totalScore: 0.75,
		detConfigHash: "abcdef0123456789",
		attempts: 2,
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("eval paths (A1.2)", () => {
	it("build <cwd>/Eval/<project>[ /eval.db] with the plan's (cwd, project) signature", () => {
		assert.equal(evalDirPath("/repo", "TodoApp"), join("/repo", "Eval", "TodoApp"));
		assert.equal(evalDbPath("/repo", "TodoApp"), join("/repo", "Eval", "TodoApp", "eval.db"));
		// Sanitisation matches buildStoreDbPath (project key stays in sync).
		assert.equal(evalDbPath("/repo", "a/b"), join("/repo", "Eval", "a-b", "eval.db"));
	});
});

describe("openEvalDb / eval schema v1", () => {
	it("creates the DB + v1 schema, stamps user_version, and has both new columns", () => {
		const dir = dirs[dirs.length - 1]!;
		const dbPath = join(dir, "Eval", "TestApp", "eval.db");
		assert.equal(existsSync(dbPath), false);

		const db = openEvalDb(dbPath);
		try {
			assert.equal(existsSync(dbPath), true);
			const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			assert.equal(version, maxKnownVersion(EVAL_MIGRATIONS));

			const cols = (db.prepare("PRAGMA table_info(eval_runs)").all() as { name: string }[]).map((c) => c.name);
			for (const required of [
				"project",
				"run_id",
				"stage",
				"artifact_kind",
				"det_scores",
				"judge_scores",
				"total_score",
				"det_config_hash",
				"attempts",
				"created_at",
			]) {
				assert.ok(cols.includes(required), `eval_runs.${required} must exist`);
			}
			const meta = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='eval_meta'").get();
			assert.ok(meta !== undefined, "eval_meta table must exist");
		} finally {
			closeStoreDb(db);
		}
	});

	it("insert/list round-trip preserves every field (incl. det_config_hash + attempts)", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openEvalDb(join(dir, "Eval", "TestApp", "eval.db"));
		try {
			const id = insertEvalRow(db, sampleRow());
			assert.equal(typeof id, "number");
			const rows = listEvalRows(db, "TestApp");
			assert.equal(rows.length, 1);
			const got = rows[0]!;
			assert.equal(got.project, "TestApp");
			assert.equal(got.runId, "run-1");
			assert.equal(got.stage, "building-rtm");
			assert.equal(got.artifactKind, "RTM");
			assert.equal(got.version, "1.2.0");
			assert.equal(got.model, "test-model");
			assert.equal(got.durationMs, 1234);
			assert.deepEqual(got.detScores, [
				{ name: "freshness", score: 1 },
				{ name: "publish-gate", score: 0.5, detail: "one warning" },
			]);
			assert.equal(got.judgeScores, null);
			assert.equal(got.totalScore, 0.75);
			assert.equal(got.detConfigHash, "abcdef0123456789");
			assert.equal(got.attempts, 2);
			assert.equal(got.createdAt, "2026-01-01T00:00:00.000Z");
		} finally {
			closeStoreDb(db);
		}
	});

	it("list filters by stage and honours limit, newest first", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openEvalDb(join(dir, "Eval", "TestApp", "eval.db"));
		try {
			insertEvalRow(db, sampleRow({ stage: "building-rtm", totalScore: 0.1, createdAt: "2026-01-01T00:00:00Z" }));
			insertEvalRow(db, sampleRow({ stage: "designing", totalScore: 0.9, createdAt: "2026-01-02T00:00:00Z" }));
			insertEvalRow(db, sampleRow({ stage: "building-rtm", totalScore: 0.8, createdAt: "2026-01-03T00:00:00Z" }));
			const rtm = listEvalRows(db, "TestApp", "building-rtm");
			assert.equal(rtm.length, 2);
			assert.equal(rtm[0]!.totalScore, 0.8, "newest first");
			assert.equal(listEvalRows(db, "TestApp", "designing").length, 1);
			assert.equal(listEvalRows(db, "TestApp", undefined, 2).length, 2);
			assert.equal(listEvalRows(db, "OtherApp").length, 0);
		} finally {
			closeStoreDb(db);
		}
	});

	it("fresh/missing path read returns an empty list", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openEvalDb(join(dir, "Eval", "TestApp", "eval.db"));
		try {
			assert.deepEqual(listEvalRows(db, "TestApp"), []);
		} finally {
			closeStoreDb(db);
		}
	});
});

describe("openEvalDb guards", () => {
	it("throws on a garbage (non-SQLite) file", () => {
		const dir = dirs[dirs.length - 1]!;
		const dbPath = join(dir, "Eval", "TestApp", "eval.db");
		mkdirSync(join(dir, "Eval", "TestApp"), { recursive: true });
		writeFileSync(dbPath, "this is not a sqlite database", "utf8");
		assert.throws(() => openEvalDb(dbPath));
	});

	it("enforces the eval DB's own G3 downgrade guard", () => {
		const dir = dirs[dirs.length - 1]!;
		const dbPath = join(dir, "Eval", "TestApp", "eval.db");
		const db = openEvalDb(dbPath);
		db.exec("PRAGMA user_version = 99");
		db.close();
		assert.throws(() => openEvalDb(dbPath), /supports at most/);
	});
});
