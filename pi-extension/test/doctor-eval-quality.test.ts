/**
 * Doctor "Quality (local evals)" section tests (evals Phase A).
 *
 * Asserts the report-only contract: the section renders latest/delta/mean,
 * a per-model breakdown, a per-stage multi-stage trend, and a
 * `det_config_hash` change marker — and NEVER emits an error, even when the
 * eval DB is absent or unreadable (deleting `Eval/` is supported).
 *
 * The rows are seeded through the A1 API (`openEvalDb` + `insertEvalRow`),
 * so this test also exercises the real eval schema round-trip.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	checkEvalQualitySection,
	EVAL_QUALITY_TITLE,
	JUDGE_PENDING_NOTE,
} from "../src/doctor/checks/eval-quality.js";
import { openEvalDb, closeStoreDb, insertEvalRow } from "../src/io/db.js";
import { evalDbPath } from "../src/core/paths.js";
import type { DatabaseSync } from "node:sqlite";
import type { DetScore, EvalRow } from "../src/core/eval.js";

const PROJECT = "EvalApp";

let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "velpari-eval-quality-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

/** Options for a seeded row; sensible defaults for a scored publish. */
interface SeedOpts {
	stage: string;
	totalScore: number;
	createdAt: string;
	model?: string;
	runId?: string;
	detConfigHash?: string;
	attempts?: number;
	detScores?: DetScore[];
}

/** Build and insert one eval row through the A1 API. */
function seedRow(db: DatabaseSync, opts: SeedOpts): void {
	const row: EvalRow = {
		project: PROJECT,
		runId: opts.runId ?? "run-1",
		stage: opts.stage,
		artifactKind: opts.stage,
		version: "1.0.0",
		model: opts.model ?? "test-model",
		durationMs: 1000,
		detScores: opts.detScores ?? [{ name: "freshness", score: opts.totalScore }],
		judgeScores: null,
		totalScore: opts.totalScore,
		detConfigHash: opts.detConfigHash ?? "0123456789abcdef",
		attempts: opts.attempts ?? 1,
		createdAt: opts.createdAt,
	};
	insertEvalRow(db, row);
}

/** Open the eval DB for this project and run `fn`, closing cleanly. */
function withEvalDb(fn: (db: DatabaseSync) => void): void {
	const db = openEvalDb(evalDbPath(cwd, PROJECT));
	try {
		fn(db);
	} finally {
		closeStoreDb(db);
	}
}

describe("checkEvalQualitySection", () => {
	it("no configured project → single info row, never an error", () => {
		const section = checkEvalQualitySection(cwd, "");
		assert.equal(section.title, EVAL_QUALITY_TITLE);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /No configured project/);
	});

	it("missing eval DB → info row + judge-pending note, never an error", () => {
		const section = checkEvalQualitySection(cwd, PROJECT);
		assert.equal(section.title, EVAL_QUALITY_TITLE);
		assert.ok(section.items.some((i) => i.status === "info" && /No eval data yet/.test(i.message)));
		assert.ok(section.items.some((i) => i.message === JUDGE_PENDING_NOTE));
		assert.ok(section.items.every((i) => i.status !== "error"));
	});

	it("populated DB → latest, delta, mean, and per-model breakdown", () => {
		withEvalDb((db) => {
			seedRow(db, { stage: "prd", totalScore: 0.5, createdAt: "2026-10-01T00:00:00.000Z", model: "model-a" });
			seedRow(db, { stage: "prd", totalScore: 0.6, createdAt: "2026-10-02T00:00:00.000Z", model: "model-a" });
			seedRow(db, { stage: "prd", totalScore: 0.7, createdAt: "2026-10-03T00:00:00.000Z", model: "model-b" });
		});
		const section = checkEvalQualitySection(cwd, PROJECT);
		const stage = section.items.find((i) => /Stage 'prd'/.test(i.message) && i.details);
		assert.ok(stage, "expected a prd stage summary");
		assert.equal(stage?.status, "ok");
		assert.match(stage?.message ?? "", /latest 0\.700/);
		assert.match(stage?.message ?? "", /Δ 0\.100/);
		assert.match(stage?.message ?? "", /mean\(last 10\) 0\.600/);
		const details = (stage?.details ?? []).join("\n");
		assert.match(details, /model-a/);
		assert.match(details, /model-b/);
		assert.ok(section.items.every((i) => i.status !== "error"));
	});

	it("multi-stage → one summary per stage", () => {
		withEvalDb((db) => {
			seedRow(db, { stage: "prd", totalScore: 0.4, createdAt: "2026-10-01T00:00:00.000Z" });
			seedRow(db, { stage: "rtm", totalScore: 0.9, createdAt: "2026-10-01T01:00:00.000Z" });
			seedRow(db, { stage: "rtm", totalScore: 0.8, createdAt: "2026-10-01T02:00:00.000Z" });
		});
		const section = checkEvalQualitySection(cwd, PROJECT);
		assert.ok(section.items.some((i) => /Stage 'prd'/.test(i.message)));
		const rtm = section.items.find((i) => /Stage 'rtm'/.test(i.message));
		assert.match(rtm?.message ?? "", /latest 0\.800/);
		assert.match(rtm?.message ?? "", /Δ -0\.100/);
	});

	it("scoring-config hash change → info marker (not an error)", () => {
		withEvalDb((db) => {
			seedRow(db, {
				stage: "prd",
				totalScore: 0.5,
				createdAt: "2026-10-01T00:00:00.000Z",
				detConfigHash: "aaaaaaaaaaaaaaaa",
			});
			seedRow(db, {
				stage: "prd",
				totalScore: 0.9,
				createdAt: "2026-10-02T00:00:00.000Z",
				detConfigHash: "bbbbbbbbbbbbbbbb",
			});
		});
		const section = checkEvalQualitySection(cwd, PROJECT);
		const marker = section.items.find((i) => /scoring config changed/.test(i.message));
		assert.ok(marker, "expected a scoring-config-changed marker");
		assert.equal(marker?.status, "info");
		assert.match(marker?.message ?? "", /aaaaaaaa → bbbbbbbb/);
		assert.ok(section.items.every((i) => i.status !== "error"));
	});

	it("same hash across publishes → no scoring-config marker", () => {
		withEvalDb((db) => {
			seedRow(db, { stage: "prd", totalScore: 0.5, createdAt: "2026-10-01T00:00:00.000Z" });
			seedRow(db, { stage: "prd", totalScore: 0.6, createdAt: "2026-10-02T00:00:00.000Z" });
		});
		const section = checkEvalQualitySection(cwd, PROJECT);
		assert.ok(section.items.every((i) => !/scoring config changed/.test(i.message)));
	});

	it("unreadable eval DB → info row, never throws or errors (fail-open)", () => {
		const dbPath = evalDbPath(cwd, PROJECT);
		mkdirSync(dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, "not a database", "utf8");
		let section: ReturnType<typeof checkEvalQualitySection> | undefined;
		assert.doesNotThrow(() => {
			section = checkEvalQualitySection(cwd, PROJECT);
		});
		assert.ok(section!.items.some((i) => i.status === "info" && /unreadable/i.test(i.message)));
		assert.ok(section!.items.every((i) => i.status !== "error"));
	});
});
