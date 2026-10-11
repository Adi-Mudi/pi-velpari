// Tests — core/eval.ts (velpari-evals Phase A, Lane A1.4).
// Covers: the weight-table config hash (G1 — stable across calls, changes
// with the table), weighted total-score math, empty input, the gate+doctor →
// DetScore mapping, and the per-stage trend math.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
	DET_SCORE_WEIGHTS,
	computeTotalScore,
	detConfigHash,
	detScoresFromGateAndDoctor,
	trend,
	type DetScore,
	type EvalRow,
} from "../src/core/eval.js";

/** Minimal EvalRow builder for trend tests. */
function row(stage: string, totalScore: number, createdAt: string): EvalRow {
	return {
		project: "P",
		runId: "r1",
		stage,
		artifactKind: "PRD",
		version: "1.0.0",
		model: "test",
		durationMs: null,
		detScores: [],
		judgeScores: null,
		totalScore,
		detConfigHash: "0",
		attempts: 1,
		createdAt,
	};
}

describe("detConfigHash (G1)", () => {
	it("is a stable 16-hex-char hash for the same table", () => {
		const first = detConfigHash();
		const second = detConfigHash({ ...DET_SCORE_WEIGHTS });
		assert.equal(first, second);
		assert.match(first, /^[0-9a-f]{16}$/);
	});

	it("changes when a single weight changes", () => {
		const changed = { ...DET_SCORE_WEIGHTS, freshness: 2 };
		assert.notEqual(detConfigHash(), detConfigHash(changed));
	});

	it("is order-independent (canonical JSON sorts keys)", () => {
		assert.equal(detConfigHash({ a: 1, b: 2 }), detConfigHash({ b: 2, a: 1 }));
	});
});

describe("computeTotalScore", () => {
	it("empty input → 0", () => {
		assert.equal(computeTotalScore([]), 0);
	});

	it("is a plain mean when every weight is 1", () => {
		const scores: DetScore[] = [
			{ name: "a", score: 1 },
			{ name: "b", score: 0 },
		];
		assert.equal(computeTotalScore(scores, { a: 1, b: 1 }), 0.5);
	});

	it("honours weights (weighted mean)", () => {
		const scores: DetScore[] = [
			{ name: "a", score: 1 },
			{ name: "b", score: 0 },
		];
		assert.equal(computeTotalScore(scores, { a: 3, b: 1 }), 0.75);
	});

	it("unknown names get weight 1", () => {
		const scores: DetScore[] = [
			{ name: "unknown-check", score: 1 },
			{ name: "known", score: 0 },
		];
		assert.equal(computeTotalScore(scores, { known: 1 }), 0.5);
	});

	it("non-positive weight sum → 0", () => {
		assert.equal(computeTotalScore([{ name: "a", score: 1 }], { a: 0 }), 0);
	});
});

describe("detScoresFromGateAndDoctor", () => {
	it("maps doctor sections (error 0, warning 0.5, ok/info 1) and the gate", () => {
		const scores = detScoresFromGateAndDoctor(
			{ errors: [], warnings: [] },
			{
				sections: [
					{ title: "Freshness (stale set)", items: [{ status: "error" }] },
					{ title: "ID coverage", items: [{ status: "warning" }] },
					{ title: "PSRS validation", items: [{ status: "ok" }, { status: "info" }] },
					{ title: "Custom section title", items: [] },
				],
			},
		);
		assert.deepEqual(scores, [
			{ name: "freshness", score: 0 },
			{ name: "id-coverage", score: 0.5 },
			{ name: "psrs-shape", score: 1 },
			{ name: "custom-section-title", score: 1 },
			{ name: "publish-gate", score: 1 },
		]);
	});

	it("scores the publish gate itself, and tolerates a null doctor report", () => {
		assert.deepEqual(detScoresFromGateAndDoctor({ errors: ["boom"], warnings: [] }, null), [
			{ name: "publish-gate", score: 0 },
		]);
		assert.deepEqual(detScoresFromGateAndDoctor({ errors: [], warnings: ["hmm"] }, null), [
			{ name: "publish-gate", score: 0.5 },
		]);
	});
});

describe("trend", () => {
	it("no rows → all null", () => {
		assert.deepEqual(trend([], "building-rtm"), { latest: null, previous: null, delta: null, meanLast10: null });
	});

	it("single row → delta null, mean = that score", () => {
		assert.deepEqual(trend([row("building-rtm", 0.8, "2026-01-01T00:00:00Z")], "building-rtm"), {
			latest: 0.8,
			previous: null,
			delta: null,
			meanLast10: 0.8,
		});
	});

	it("latest/previous/delta over the same stage, ignoring other stages", () => {
		const rows = [
			row("building-rtm", 0.5, "2026-01-01T00:00:00Z"),
			row("designing", 0.1, "2026-01-02T00:00:00Z"),
			row("building-rtm", 0.9, "2026-01-03T00:00:00Z"),
		];
		const result = trend(rows, "building-rtm");
		assert.equal(result.latest, 0.9);
		assert.equal(result.previous, 0.5);
		assert.ok(Math.abs(result.delta! - 0.4) < 1e-9);
		assert.ok(Math.abs(result.meanLast10! - 0.7) < 1e-9);
	});

	it("is order-independent (sorts by createdAt)", () => {
		const rows = [
			row("building-rtm", 0.9, "2026-01-03T00:00:00Z"),
			row("building-rtm", 0.5, "2026-01-01T00:00:00Z"),
		];
		assert.equal(trend(rows, "building-rtm").latest, 0.9);
	});

	it("meanLast10 uses only the newest 10 rows", () => {
		const rows: EvalRow[] = [];
		for (let i = 0; i < 12; i++) {
			rows.push(row("building-rtm", i / 10, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
		}
		const result = trend(rows, "building-rtm");
		// newest 10 rows are indices 2..11 → scores 0.2..1.1, mean 0.65
		assert.ok(Math.abs(result.meanLast10! - 0.65) < 1e-9);
		assert.equal(result.latest, 1.1);
	});
});
