/**
 * Judge-score tests (Phase B, Lane B2 — plan §B2.4).
 *
 * Covers:
 *   - blend math + the blend weight inside `detConfigHash` (decision 6)
 *   - the locked `scores:` contract: valid block normalizes; bad/unknown/
 *     missing/duplicate criterion id, out-of-range score/overall, missing
 *     identity → NULL; recompute-mismatch → a `note` (never an error)
 *   - identity fields stored verbatim
 *   - `loadJudgeScoresForPublish` fail-open: garbage report, missing report,
 *     missing rubric, non-reviewer artifact → NULL, never throws
 *   - each reviewer template's mandated example `scores` block parses
 */

import { after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync as realMkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { blendTotal, DET_SCORE_WEIGHTS, detConfigHash, JUDGE_BLEND_WEIGHT } from "../src/core/eval.js";
import { loadRubricForStage, parseRubric } from "../src/core/eval-rubrics.js";
import {
	loadJudgeScoresForPublish,
	parseJudgeScores,
	readJudgeScoresFromReport,
} from "../src/ops/judge-scores.js";

/** Repo root — the test compiles to dist/pi-extension/test/, so three levels up. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const tempDirs: string[] = [];
const mkdtempSync = (prefix: string): string => {
	const dir = realMkdtempSync(prefix);
	tempDirs.push(dir);
	return dir;
};
after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const VALID_RUBRIC = `rubric: sample-rubric
version: 1
criteria:
  - id: alpha
    weight: 3
    description: alpha dimension
  - id: beta
    weight: 1
    description: beta dimension
calibration:
  - input_summary: strong artifact
    expected_score: 0.9
    tolerance: 0.1
  - input_summary: weak artifact
    expected_score: 0.3
    tolerance: 0.15
`;

const rubric = parseRubric(VALID_RUBRIC);

/** A valid locked-contract scores block for the sample rubric. */
function validBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		rubricId: "sample-rubric",
		rubricVersion: 1,
		rubricHash: "0123456789abcdef",
		judgeModel: "test/judge-model",
		criteria: [
			{ id: "alpha", score: 1, note: "strong" },
			{ id: "beta", score: 0 },
		],
		overall: 0.75, // (3*1 + 1*0) / 4
		...overrides,
	};
}

describe("blend math + config hash (decision 6)", () => {
	it("blendTotal is the 50/50 mean", () => {
		assert.ok(Math.abs(blendTotal(0.4, 0.8) - 0.6) < 1e-12);
		assert.equal(blendTotal(0, 1), 0.5);
		assert.equal(JUDGE_BLEND_WEIGHT, 0.5);
	});

	it("blendTotal falls back to the deterministic total for a non-finite judge value", () => {
		assert.equal(blendTotal(0.42, Number.NaN), 0.42);
		assert.equal(blendTotal(0.42, Number.POSITIVE_INFINITY), 0.42);
	});

	it("detConfigHash covers the blend weight and is stable", () => {
		const a = detConfigHash(DET_SCORE_WEIGHTS, 0.5);
		const b = detConfigHash(DET_SCORE_WEIGHTS, 0.5);
		const c = detConfigHash(DET_SCORE_WEIGHTS, 0.3);
		assert.equal(a, b, "same config → same hash");
		assert.notEqual(a, c, "a blend change must change the config hash");
		assert.match(a, /^[0-9a-f]{16}$/);
		// Default arg == explicit shipped blend.
		assert.equal(detConfigHash(), detConfigHash(DET_SCORE_WEIGHTS, JUDGE_BLEND_WEIGHT));
	});
});

describe("parseJudgeScores — locked contract", () => {
	it("accepts a valid block and normalizes it", () => {
		const result = parseJudgeScores(validBlock(), rubric);
		assert.ok(result);
		assert.equal(result?.rubricId, "sample-rubric");
		assert.equal(result?.rubricVersion, 1);
		assert.equal(result?.rubricHash, "0123456789abcdef");
		assert.equal(result?.judgeModel, "test/judge-model");
		assert.equal(result?.overall, 0.75);
		assert.equal(result?.note, undefined, "matching recompute → no note");
		assert.deepEqual(result?.criteria, [
			{ id: "alpha", score: 1, note: "strong" },
			{ id: "beta", score: 0 },
		]);
	});

	it("stores identity fields verbatim", () => {
		const result = parseJudgeScores(
			validBlock({ rubricHash: "deadbeefdeadbeef", judgeModel: "vendor/model-x", rubricVersion: 7 }),
			rubric,
		);
		assert.equal(result?.rubricHash, "deadbeefdeadbeef");
		assert.equal(result?.judgeModel, "vendor/model-x");
		assert.equal(result?.rubricVersion, 7);
	});

	it("flags a reported/recomputed overall mismatch with a note (never an error)", () => {
		const result = parseJudgeScores(validBlock({ overall: 0.4 }), rubric);
		assert.ok(result, "mismatch is still stored, not rejected");
		assert.equal(result?.overall, 0.4, "the reviewer's overall is stored verbatim");
		assert.match(result?.note ?? "", /disagrees with the rubric-weighted recompute/);
		assert.match(result?.note ?? "", /0\.750/);
	});

	it("rejects an unknown criterion id", () => {
		const bad = validBlock({
			criteria: [
				{ id: "alpha", score: 1 },
				{ id: "gamma", score: 1 },
			],
		});
		assert.equal(parseJudgeScores(bad, rubric), null);
	});

	it("rejects a missing criterion id (not every rubric id present)", () => {
		const bad = validBlock({ criteria: [{ id: "alpha", score: 1 }] });
		assert.equal(parseJudgeScores(bad, rubric), null);
	});

	it("rejects a duplicate criterion id", () => {
		const bad = validBlock({
			criteria: [
				{ id: "alpha", score: 1 },
				{ id: "alpha", score: 1 },
			],
		});
		assert.equal(parseJudgeScores(bad, rubric), null);
	});

	it("rejects an out-of-range criterion score", () => {
		const bad = validBlock({
			criteria: [
				{ id: "alpha", score: 1.5 },
				{ id: "beta", score: 0 },
			],
		});
		assert.equal(parseJudgeScores(bad, rubric), null);
	});

	it("rejects a missing or out-of-range overall", () => {
		const missing = validBlock();
		delete missing.overall;
		assert.equal(parseJudgeScores(missing, rubric), null);
		assert.equal(parseJudgeScores(validBlock({ overall: -0.1 }), rubric), null);
		assert.equal(parseJudgeScores(validBlock({ overall: 1.2 }), rubric), null);
	});

	it("rejects missing identity fields and a non-object block", () => {
		for (const key of ["rubricId", "rubricVersion", "rubricHash", "judgeModel"]) {
			const bad = validBlock();
			delete bad[key];
			assert.equal(parseJudgeScores(bad, rubric), null, `missing ${key} → null`);
		}
		assert.equal(parseJudgeScores(null, rubric), null);
		assert.equal(parseJudgeScores("nope", rubric), null);
		assert.equal(parseJudgeScores([], rubric), null);
	});

	it("rejects a rubricId that does not match the loaded rubric", () => {
		assert.equal(parseJudgeScores(validBlock({ rubricId: "other-rubric" }), rubric), null);
	});
});

describe("readJudgeScoresFromReport", () => {
	it("returns the scores field, or null when absent/invalid", () => {
		const dir = mkdtempSync(join(tmpdir(), "velpari-judge-read-"));
		const good = join(dir, "good.json");
		writeFileSync(good, JSON.stringify({ verdict: "approve", scores: { overall: 1 } }), "utf8");
		assert.deepEqual(readJudgeScoresFromReport(good), { overall: 1 });

		const noScores = join(dir, "no-scores.json");
		writeFileSync(noScores, JSON.stringify({ verdict: "approve" }), "utf8");
		assert.equal(readJudgeScoresFromReport(noScores), null);

		const garbage = join(dir, "garbage.json");
		writeFileSync(garbage, "{not json", "utf8");
		assert.equal(readJudgeScoresFromReport(garbage), null);

		assert.equal(readJudgeScoresFromReport(join(dir, "missing.json")), null);
	});
});

describe("loadJudgeScoresForPublish — fail-open", () => {
	/** Write a reviewer report for pseudocode with the given scores payload. */
	function writeReport(runDir: string, scores: unknown): void {
		const dir = join(runDir, "pseudocode", "scouts");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "pseudocode-reviewer-report.json"), JSON.stringify({ verdict: "approve", scores }), "utf8");
	}

	it("loads + validates a real reviewer report against the shipped rubric", () => {
		const runDir = mkdtempSync(join(tmpdir(), "velpari-judge-load-"));
		const loaded = loadRubricForStage(REPO_ROOT, "pseudocode");
		assert.ok(loaded);
		writeReport(runDir, {
			rubricId: "pseudocode",
			rubricVersion: loaded!.version,
			rubricHash: "0123456789abcdef",
			judgeModel: "test/judge",
			criteria: loaded!.criteria.map((c) => ({ id: c.id, score: 1 })),
			overall: 1,
		});
		const result = loadJudgeScoresForPublish({ runDir, artifactKind: "pseudocode", packageRoot: REPO_ROOT });
		assert.ok(result);
		assert.equal(result?.rubricId, "pseudocode");
		assert.equal(result?.overall, 1);
		assert.equal(result?.criteria.length, loaded!.criteria.length);
	});

	it("returns null for a non-reviewer artifact", () => {
		const runDir = mkdtempSync(join(tmpdir(), "velpari-judge-load-"));
		assert.equal(loadJudgeScoresForPublish({ runDir, artifactKind: "RTM", packageRoot: REPO_ROOT }), null);
	});

	it("returns null for a missing report, garbage report, or missing rubric — never throws", () => {
		const runDir = mkdtempSync(join(tmpdir(), "velpari-judge-load-"));
		assert.doesNotThrow(() => {
			assert.equal(loadJudgeScoresForPublish({ runDir, artifactKind: "pseudocode", packageRoot: REPO_ROOT }), null);
		});

		// Garbage report bytes.
		const dir = join(runDir, "pseudocode", "scouts");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "pseudocode-reviewer-report.json"), "not json at all", "utf8");
		assert.doesNotThrow(() => {
			assert.equal(loadJudgeScoresForPublish({ runDir, artifactKind: "pseudocode", packageRoot: REPO_ROOT }), null);
		});

		// Missing rubric: package root without skills/eval-rubrics.
		const emptyRoot = mkdtempSync(join(tmpdir(), "velpari-judge-emptyroot-"));
		writeReport(runDir, validBlock({ rubricId: "pseudocode" }));
		assert.doesNotThrow(() => {
			assert.equal(loadJudgeScoresForPublish({ runDir, artifactKind: "pseudocode", packageRoot: emptyRoot }), null);
		});
	});
});

describe("reviewer templates mandate a parseable scores block (B2.1)", () => {
	const templates: Array<{ file: string; rubricId: string }> = [
		{ file: "reviewer.md", rubricId: "atomic-function" },
		{ file: "pseudocode-reviewer.md", rubricId: "pseudocode" },
		{ file: "testplan-reviewer.md", rubricId: "testplan" },
		{ file: "design-reviewer.md", rubricId: "design" },
	];

	/** Pull the first ```json fence that contains a top-level "scores" key. */
	function scoresExample(md: string): string {
		for (const match of md.matchAll(/```json\n([\s\S]*?)```/g)) {
			if (match[1]?.includes('"scores"')) return match[1];
		}
		throw new Error("no scores example block found");
	}

	for (const t of templates) {
		it(`${t.file}: example scores block parses with the locked keys`, () => {
			const md = readFileSync(join(REPO_ROOT, "skills", "agents", t.file), "utf8");
			const parsed = JSON.parse(scoresExample(md)) as {
				scores?: { rubricId?: string; criteria?: unknown[] };
			};
			assert.ok(parsed.scores, "example has a top-level scores object");
			assert.equal(parsed.scores?.rubricId, t.rubricId);
			assert.ok(Array.isArray(parsed.scores?.criteria) && parsed.scores!.criteria!.length > 0);
			assert.match(md, /skills\/eval-rubrics\/[a-z-]+\.yaml/);
		});
	}
});
