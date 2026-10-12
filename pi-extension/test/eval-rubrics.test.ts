/**
 * Eval rubric loader tests (Phase B, Lane B1 — plan §B1.3).
 *
 * Covers:
 *   - the 4 shipped rubric files parse + validate (content-rot guard)
 *   - parseRubric rejects: duplicate id, score out of range, missing
 *     version, non-positive weight, empty criteria, bad rubric id
 *   - computeOverall weight math + missing/unknown-criterion flags
 *   - loadRubricForStage: shipped files load, missing → null, unsafe
 *     stage → null
 *   - rubricHash stability (same bytes → same hash) + length
 *   - every shipped criterion carries a `# source:` grounding comment
 */

import { after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync as realMkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	computeOverall,
	computeOverallDetail,
	loadRubricForStage,
	parseRubric,
	RUBRIC_STAGES,
	RubricValidationError,
	rubricHash,
} from "../src/core/eval-rubrics.js";

/** Repo root — the test compiles to dist/pi-extension/test/, so three levels up. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Temp dirs created in this file; removed at module teardown. */
const tempDirs: string[] = [];

/**
 * Tracked mkdtempSync: creates a temp dir and registers it for teardown.
 * @param {string} prefix - Directory prefix passed to fs.mkdtempSync.
 * @returns {string} The created directory path.
 */
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

describe("parseRubric", () => {
	it("accepts a valid rubric and camelCases calibration fields", () => {
		const rubric = parseRubric(VALID_RUBRIC);
		assert.equal(rubric.rubric, "sample-rubric");
		assert.equal(rubric.version, 1);
		assert.equal(rubric.criteria.length, 2);
		assert.equal(rubric.criteria[0]?.id, "alpha");
		assert.equal(rubric.criteria[0]?.weight, 3);
		assert.equal(rubric.calibration.length, 2);
		assert.equal(rubric.calibration[0]?.inputSummary, "strong artifact");
		assert.equal(rubric.calibration[0]?.expectedScore, 0.9);
		assert.equal(rubric.calibration[0]?.tolerance, 0.1);
	});

	it("rejects a duplicate criterion id", () => {
		const bad = VALID_RUBRIC.replace("id: beta", "id: alpha");
		assert.throws(() => parseRubric(bad), (err: unknown) => {
			assert.ok(err instanceof RubricValidationError);
			assert.match(err.message, /duplicate criterion id/);
			return true;
		});
	});

	it("rejects an out-of-range calibration score", () => {
		const bad = VALID_RUBRIC.replace("expected_score: 0.9", "expected_score: 1.5");
		assert.throws(() => parseRubric(bad), /expected_score: number in \[0,1\]/);
	});

	it("rejects an out-of-range tolerance", () => {
		const bad = VALID_RUBRIC.replace("tolerance: 0.15", "tolerance: -0.2");
		assert.throws(() => parseRubric(bad), /tolerance: number in \[0,1\]/);
	});

	it("rejects a missing version", () => {
		const bad = VALID_RUBRIC.replace("version: 1\n", "");
		assert.throws(() => parseRubric(bad), /version: positive integer required/);
	});

	it("rejects a non-positive weight", () => {
		const bad = VALID_RUBRIC.replace("weight: 1", "weight: 0");
		assert.throws(() => parseRubric(bad), /weight: positive number required/);
	});

	it("rejects empty criteria", () => {
		const bad = [
			"rubric: sample-rubric",
			"version: 1",
			"criteria: []",
			"calibration: []",
			"",
		].join("\n");
		assert.throws(() => parseRubric(bad), /at least one criterion required/);
	});

	it("rejects a non-kebab rubric id", () => {
		const bad = VALID_RUBRIC.replace("rubric: sample-rubric", "rubric: Sample Rubric");
		assert.throws(() => parseRubric(bad), /must be kebab-case/);
	});

	it("rejects malformed YAML", () => {
		assert.throws(() => parseRubric("criteria: [unclosed\n"), RubricValidationError);
	});
});

describe("computeOverall", () => {
	const rubric = parseRubric(VALID_RUBRIC);

	it("computes the weight-normalized mean", () => {
		// (3*1 + 1*0) / 4 = 0.75
		assert.equal(computeOverall(rubric, [{ id: "alpha", score: 1 }, { id: "beta", score: 0 }]), 0.75);
		// (3*0.5 + 1*1) / 4 = 0.625
		assert.equal(computeOverall(rubric, [{ id: "alpha", score: 0.5 }, { id: "beta", score: 1 }]), 0.625);
		assert.equal(computeOverall(rubric, [{ id: "alpha", score: 1 }, { id: "beta", score: 1 }]), 1);
	});

	it("flags missing criteria and counts them as score 0", () => {
		const detail = computeOverallDetail(rubric, [{ id: "alpha", score: 1 }]);
		assert.equal(detail.overall, 0.75);
		assert.deepEqual(detail.missingCriteria, ["beta"]);
		assert.deepEqual(detail.unknownCriteria, []);
		assert.equal(detail.usedWeight, 4);
	});

	it("ignores unknown ids from the math and flags them", () => {
		const detail = computeOverallDetail(rubric, [
			{ id: "alpha", score: 1 },
			{ id: "beta", score: 1 },
			{ id: "gamma", score: 0 },
		]);
		assert.equal(detail.overall, 1);
		assert.deepEqual(detail.missingCriteria, []);
		assert.deepEqual(detail.unknownCriteria, ["gamma"]);
	});
});

describe("rubricHash", () => {
	it("is stable for identical bytes and 16 hex chars", () => {
		const bytes = Buffer.from("rubric: x\nversion: 1\n", "utf8");
		const first = rubricHash(bytes);
		const second = rubricHash(Buffer.from("rubric: x\nversion: 1\n", "utf8"));
		assert.equal(first, second);
		assert.match(first, /^[0-9a-f]{16}$/);
	});

	it("changes when the bytes change", () => {
		assert.notEqual(rubricHash("a"), rubricHash("b"));
	});
});

describe("loadRubricForStage", () => {
	it("loads a rubric from <cwd>/skills/eval-rubrics/<stage>.yaml", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-rubric-"));
		const dir = join(cwd, "skills", "eval-rubrics");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "sample-rubric.yaml"), VALID_RUBRIC);
		const rubric = loadRubricForStage(cwd, "sample-rubric");
		assert.ok(rubric);
		assert.equal(rubric?.rubric, "sample-rubric");
	});

	it("returns null for a missing file", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-rubric-"));
		assert.equal(loadRubricForStage(cwd, "atomic-function"), null);
	});

	it("returns null for an unsafe stage path", () => {
		assert.equal(loadRubricForStage(REPO_ROOT, "../etc/passwd"), null);
		assert.equal(loadRubricForStage(REPO_ROOT, "a/b"), null);
	});

	it("loads all 4 shipped rubric files from the repo root", () => {
		for (const stage of RUBRIC_STAGES) {
			const rubric = loadRubricForStage(REPO_ROOT, stage);
			assert.ok(rubric, `expected skills/eval-rubrics/${stage}.yaml to load`);
			assert.equal(rubric?.rubric, stage, `${stage}.yaml rubric id must equal the stage key`);
			assert.ok((rubric?.version ?? 0) >= 1, `${stage}.yaml version must be positive`);
		}
	});
});

describe("shipped rubric content", () => {
	it("has 4-7 criteria and 2 calibration samples per stage", () => {
		for (const stage of RUBRIC_STAGES) {
			const rubric = parseRubric(readFileSync(join(REPO_ROOT, "skills", "eval-rubrics", `${stage}.yaml`), "utf8"));
			assert.ok(
				rubric.criteria.length >= 4 && rubric.criteria.length <= 7,
				`${stage}: expected 4-7 criteria, got ${rubric.criteria.length}`,
			);
			assert.equal(rubric.calibration.length, 2, `${stage}: expected 2 calibration samples`);
			for (const sample of rubric.calibration) {
				assert.ok(sample.expectedScore >= 0 && sample.expectedScore <= 1);
				assert.ok(sample.tolerance >= 0 && sample.tolerance <= 1);
			}
		}
	});

	it("grounds every criterion in a reviewer-mandate source comment", () => {
		for (const stage of RUBRIC_STAGES) {
			const text = readFileSync(join(REPO_ROOT, "skills", "eval-rubrics", `${stage}.yaml`), "utf8");
			const sources = text.match(/^\s*#\s*source:\s*\S+/gm) ?? [];
			const rubric = parseRubric(text);
			assert.ok(
				sources.length >= rubric.criteria.length,
				`${stage}: ${rubric.criteria.length} criteria but only ${sources.length} '# source:' comments`,
			);
			assert.match(text, /skills\/agents\//, `${stage}: source comments must name a reviewer template`);
		}
	});
});
