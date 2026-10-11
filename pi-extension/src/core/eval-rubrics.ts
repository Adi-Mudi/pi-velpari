/**
 * Eval rubrics — reviewer quality rubrics as code (Phase B, Lane B1).
 *
 * Rubrics are versioned YAML files in the repo at
 * `skills/eval-rubrics/<stage>.yaml`, one per reviewer stage
 * (`atomic-function`, `pseudocode`, `testplan`, `design`). They are
 * PR-reviewable prose-as-data: each criterion is grounded in the
 * reviewer agent template's mandate (the `# source:` comment in the
 * YAML names the reviewer rule it comes from).
 *
 * This module is the loader/validator and the score math. It does NOT
 * score anything itself — the reviewer sub-agent produces a `scores:`
 * block in its report, and the publish chain (Lane B2) re-computes the
 * weighted overall to flag a mismatch.
 *
 * Layer 0 — imports only the `yaml` package + node builtins
 * (`node:crypto`, `node:fs`; `node:path` for portable joins). No `src/`
 * imports, so the loader is usable from every layer without creating a
 * dependency edge.
 *
 * Schema (locked, Phase B plan §"Rubric file schema"):
 *
 *   rubric: <kebab-case id, e.g. atomic-function>
 *   version: <positive int>
 *   criteria:
 *     - id: <kebab-case>
 *       weight: <positive number, relative; normalized at load>
 *       description: <one line: what a 1.0 looks like>
 *   calibration:                    # G3 — small sample pinning expectations
 *     - input_summary: <one line>
 *       expected_score: <0..1>
 *       tolerance: <0..1>           # band, never exact equality
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/** Thrown for any rubric that violates the locked schema. */
export class RubricValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RubricValidationError";
	}
}

/** One scored dimension of a reviewer stage. */
export interface RubricCriterion {
	id: string;
	/** Relative weight; normalized by {@link computeOverall}. */
	weight: number;
	/** One line describing what a 1.0 looks like. */
	description: string;
}

/** A calibration sample pinning the judge's expected score band (G3). */
export interface RubricCalibrationSample {
	inputSummary: string;
	expectedScore: number;
	tolerance: number;
}

/** A fully validated reviewer rubric. */
export interface Rubric {
	/** Rubric id — equals the stage key. */
	rubric: string;
	/** Positive integer; bump on any criterion change. */
	version: number;
	criteria: RubricCriterion[];
	calibration: RubricCalibrationSample[];
}

/** One criterion score as produced by the reviewer's `scores.criteria[]`. */
export interface RubricScore {
	id: string;
	score: number;
}

/** Detail behind {@link computeOverall}: the number plus the flags. */
export interface OverallDetail {
	/** Weight-normalized mean; missing criteria count as score 0. */
	overall: number;
	/** Rubric criteria the caller did not supply a score for. */
	missingCriteria: string[];
	/** Provided ids that are not in the rubric (ignored by the math). */
	unknownCriteria: string[];
	/** Sum of rubric weights used in the denominator. */
	usedWeight: number;
}

/** The 4 reviewer stages that ship a rubric (Phase B decision 2). */
export const RUBRIC_STAGES = ["atomic-function", "pseudocode", "testplan", "design"] as const;
export type RubricStage = (typeof RUBRIC_STAGES)[number];

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Conservative path component allowlist — blocks traversal in `loadRubricForStage`. */
const SAFE_STAGE = /^[a-z0-9-]+$/;

/**
 * True for a non-null, non-array object — the only shape accepted for a
 * YAML mapping in the rubric schema.
 * @param {unknown} x - Candidate value.
 * @returns {boolean} Whether `x` is a plain mapping object.
 */
function isPlainObject(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Parse and validate a rubric YAML document.
 *
 * Throws {@link RubricValidationError} on malformed YAML or a schema
 * violation: missing/blank `rubric`, non-positive or non-integer
 * `version`, empty `criteria`, duplicate criterion ids, non-positive
 * weights, or calibration scores outside `[0, 1]`.
 *
 * @param {string} yamlText - The rubric file contents.
 * @returns {Rubric} The validated rubric (camelCased calibration fields).
 */
export function parseRubric(yamlText: string): Rubric {
	let raw: unknown;
	try {
		raw = parse(yamlText);
	} catch (err) {
		throw new RubricValidationError(
			`rubric YAML is not parseable: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (!isPlainObject(raw)) {
		throw new RubricValidationError("rubric root must be a mapping");
	}

	const rubric = raw.rubric;
	if (typeof rubric !== "string" || rubric.trim() === "") {
		throw new RubricValidationError("rubric: non-empty string required");
	}
	if (!KEBAB.test(rubric)) {
		throw new RubricValidationError(`rubric: must be kebab-case, got ${JSON.stringify(rubric)}`);
	}

	const version = raw.version;
	if (typeof version !== "number" || !Number.isInteger(version) || version <= 0) {
		throw new RubricValidationError(`version: positive integer required, got ${String(version)}`);
	}

	const rawCriteria = raw.criteria;
	if (!Array.isArray(rawCriteria)) {
		throw new RubricValidationError("criteria: non-empty array required");
	}
	if (rawCriteria.length === 0) {
		throw new RubricValidationError("criteria: at least one criterion required");
	}
	const criteria: RubricCriterion[] = [];
	const seenIds = new Set<string>();
	rawCriteria.forEach((entry, i) => {
		const where = `criteria[${i}]`;
		if (!isPlainObject(entry)) {
			throw new RubricValidationError(`${where}: must be a mapping`);
		}
		const id = entry.id;
		if (typeof id !== "string" || !KEBAB.test(id)) {
			throw new RubricValidationError(`${where}.id: kebab-case string required, got ${JSON.stringify(id)}`);
		}
		if (seenIds.has(id)) {
			throw new RubricValidationError(`${where}.id: duplicate criterion id ${JSON.stringify(id)}`);
		}
		seenIds.add(id);
		const weight = entry.weight;
		if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
			throw new RubricValidationError(`${where}.weight: positive number required, got ${String(weight)}`);
		}
		const description = entry.description;
		if (typeof description !== "string" || description.trim() === "") {
			throw new RubricValidationError(`${where}.description: non-empty string required`);
		}
		criteria.push({ id, weight, description });
	});

	const rawCalibration = raw.calibration;
	if (!Array.isArray(rawCalibration)) {
		throw new RubricValidationError("calibration: array required");
	}
	const calibration: RubricCalibrationSample[] = rawCalibration.map((entry, i) => {
		const where = `calibration[${i}]`;
		if (!isPlainObject(entry)) {
			throw new RubricValidationError(`${where}: must be a mapping`);
		}
		const inputSummary = entry.input_summary;
		if (typeof inputSummary !== "string" || inputSummary.trim() === "") {
			throw new RubricValidationError(`${where}.input_summary: non-empty string required`);
		}
		const expectedScore = entry.expected_score;
		if (
			typeof expectedScore !== "number" ||
			!Number.isFinite(expectedScore) ||
			expectedScore < 0 ||
			expectedScore > 1
		) {
			throw new RubricValidationError(
				`${where}.expected_score: number in [0,1] required, got ${String(expectedScore)}`,
			);
		}
		const tolerance = entry.tolerance;
		if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
			throw new RubricValidationError(`${where}.tolerance: number in [0,1] required, got ${String(tolerance)}`);
		}
		return { inputSummary, expectedScore, tolerance };
	});

	return { rubric, version, criteria, calibration };
}

/**
 * Load and validate the rubric for `stage` from
 * `<cwd>/skills/eval-rubrics/<stage>.yaml`.
 *
 * Fail-open on a missing file (returns null) so a stage without a rubric
 * degrades to deterministic-only eval rows. A file that exists but is
 * malformed is NOT swallowed — {@link parseRubric} throws so content rot
 * is loud.
 *
 * @param {string} cwd - Repository root containing the `skills/` tree.
 * @param {string} stage - Reviewer stage key.
 * @returns {Rubric | null} The rubric, or null when absent / unsafe stage.
 */
export function loadRubricForStage(cwd: string, stage: string): Rubric | null {
	if (typeof stage !== "string" || !SAFE_STAGE.test(stage)) return null;
	const filePath = join(cwd, "skills", "eval-rubrics", `${stage}.yaml`);
	if (!existsSync(filePath)) return null;
	return parseRubric(readFileSync(filePath, "utf8"));
}

/**
 * SHA-256 fingerprint of the rubric file bytes, truncated to the first
 * 16 hex chars (the `rubricHash` identity field in the `scores:`
 * contract). Hashes raw bytes exactly as committed.
 *
 * @param {Uint8Array | string} rubricFileBytes - File bytes or file text.
 * @returns {string} 16-char lowercase hex digest.
 */
export function rubricHash(rubricFileBytes: Uint8Array | string): string {
	return createHash("sha256").update(rubricFileBytes).digest("hex").slice(0, 16);
}

/**
 * Weight-normalized mean of the supplied criterion scores, with detail.
 *
 * Normalization: `Σ(weight_i × score_i) / Σ(weight_i)` over every rubric
 * criterion. A criterion present in the rubric but absent from
 * `criteriaScores` is treated as score 0 and reported in
 * `missingCriteria` (conservative — a skipped dimension lowers the
 * overall). Provided ids not in the rubric are ignored by the math and
 * reported in `unknownCriteria`. Non-finite scores count as 0.
 *
 * @param {Rubric} rubric - Validated rubric.
 * @param {ReadonlyArray<RubricScore>} criteriaScores - Reviewer criterion scores.
 * @returns {OverallDetail} The overall plus missing/unknown flags.
 */
export function computeOverallDetail(rubric: Rubric, criteriaScores: ReadonlyArray<RubricScore>): OverallDetail {
	const provided = new Map<string, number>();
	for (const score of criteriaScores) {
		if (typeof score?.id === "string") provided.set(score.id, score.score);
	}

	let weightedSum = 0;
	let usedWeight = 0;
	const missingCriteria: string[] = [];
	for (const criterion of rubric.criteria) {
		usedWeight += criterion.weight;
		if (provided.has(criterion.id)) {
			const raw = provided.get(criterion.id);
			const score = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
			weightedSum += criterion.weight * score;
		} else {
			missingCriteria.push(criterion.id);
		}
	}

	const knownIds = new Set(rubric.criteria.map((c) => c.id));
	const unknownCriteria: string[] = [];
	const counted = new Set<string>();
	for (const score of criteriaScores) {
		if (typeof score?.id === "string" && !knownIds.has(score.id) && !counted.has(score.id)) {
			counted.add(score.id);
			unknownCriteria.push(score.id);
		}
	}

	return {
		overall: usedWeight > 0 ? weightedSum / usedWeight : 0,
		missingCriteria,
		unknownCriteria,
		usedWeight,
	};
}

/**
 * Weight-normalized mean of the supplied criterion scores.
 * Thin wrapper over {@link computeOverallDetail}.
 *
 * @param {Rubric} rubric - Validated rubric.
 * @param {ReadonlyArray<RubricScore>} criteriaScores - Reviewer criterion scores.
 * @returns {number} Overall score in `[0, 1]` for well-formed inputs.
 */
export function computeOverall(rubric: Rubric, criteriaScores: ReadonlyArray<RubricScore>): number {
	return computeOverallDetail(rubric, criteriaScores).overall;
}
