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
import type { DetScore, EvalRow, JudgeScores } from "../src/core/eval.js";

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
	judgeScores?: JudgeScores;
}

/** Build a judge-scores block with sensible defaults. */
function judgeBlock(overrides: Partial<JudgeScores> = {}): JudgeScores {
	return {
		rubricId: "pseudocode",
		rubricVersion: 1,
		rubricHash: "0123456789abcdef",
		judgeModel: "model-a",
		criteria: [
			{ id: "per-atomic-function-coverage", score: 0.9, note: "one AF thin" },
			{ id: "algorithmic-completeness", score: 0.7 },
		],
		overall: 0.8,
		...overrides,
	};
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
		judgeScores: opts.judgeScores ?? null,
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

	it("judged row → per-stage judge line (overall, criteria, identity), no pending note", () => {
		withEvalDb((db) => {
			seedRow(db, {
				stage: "pseudocode",
				totalScore: 0.7,
				createdAt: "2026-10-01T00:00:00.000Z",
				judgeScores: judgeBlock(),
			});
		});
		const section = checkEvalQualitySection(cwd, PROJECT);
		const judgeLine = section.items.find((i) => /Stage 'pseudocode': judge/.test(i.message));
		assert.ok(judgeLine, "expected a per-stage judge line");
		assert.equal(judgeLine?.status, "ok");
		assert.match(judgeLine?.message ?? "", /judge 0\.800/);
		assert.match(judgeLine?.message ?? "", /model-a/);
		assert.match(judgeLine?.message ?? "", /pseudocode@v1/);
		assert.match(judgeLine?.message ?? "", /01234567/);
		const details = (judgeLine?.details ?? []).join("\n");
		assert.match(details, /per-atomic-function-coverage: 0\.900/);
		assert.match(details, /algorithmic-completeness: 0\.700/);
		assert.ok(section.items.every((i) => i.message !== JUDGE_PENDING_NOTE), "no pending note when judged rows exist");
		assert.ok(section.items.every((i) => i.status !== "error"));
	});

	it("judge overall mismatch note → warning, never an error", () => {
		withEvalDb((db) => {
			seedRow(db, {
				stage: "pseudocode",
				totalScore: 0.7,
				createdAt: "2026-10-01T00:00:00.000Z",
				judgeScores: judgeBlock({ note: "reported overall 0.400 disagrees with the rubric-weighted recompute 0.800" }),
			});
		});
		const section = checkEvalQualitySection(cwd, PROJECT);
		const warning = section.items.find((i) => /judge overall mismatch/.test(i.message));
		assert.ok(warning, "expected the mismatch warning");
		assert.equal(warning?.status, "warning");
		assert.ok(section.items.every((i) => i.status !== "error"));
	});

	it("judge identity change between consecutive rows → info discontinuity marker", () => {
		withEvalDb((db) => {
			seedRow(db, {
				stage: "pseudocode",
				totalScore: 0.6,
				createdAt: "2026-10-01T00:00:00.000Z",
				judgeScores: judgeBlock({ judgeModel: "model-a", rubricHash: "aaaaaaaaaaaaaaaa" }),
			});
			seedRow(db, {
				stage: "pseudocode",
				totalScore: 0.9,
				createdAt: "2026-10-02T00:00:00.000Z",
				judgeScores: judgeBlock({ judgeModel: "model-b", rubricHash: "bbbbbbbbbbbbbbbb" }),
			});
		});
		const section = checkEvalQualitySection(cwd, PROJECT);
		const marker = section.items.find((i) => /judge identity changed/.test(i.message));
		assert.ok(marker, "expected a judge-identity discontinuity marker");
		assert.equal(marker?.status, "info");
		assert.match(marker?.message ?? "", /model-a → model-b/);
		assert.match(marker?.message ?? "", /aaaaaaaa → bbbbbbbb/);
		assert.ok(section.items.every((i) => i.status !== "error"));
	});

	it("stable judge identity → no discontinuity marker", () => {
		withEvalDb((db) => {
			seedRow(db, {
				stage: "pseudocode",
				totalScore: 0.6,
				createdAt: "2026-10-01T00:00:00.000Z",
				judgeScores: judgeBlock(),
			});
			seedRow(db, {
				stage: "pseudocode",
				totalScore: 0.7,
				createdAt: "2026-10-02T00:00:00.000Z",
				judgeScores: judgeBlock({ overall: 0.9 }),
			});
		});
		const section = checkEvalQualitySection(cwd, PROJECT);
		assert.ok(section.items.every((i) => !/judge identity changed/.test(i.message)));
	});
});
