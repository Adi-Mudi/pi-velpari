/**
 * Judge-score reader + validator (evals Phase B, Lane B2).
 *
 * The reviewer sub-agent emits a top-level `scores:` block in its report JSON
 * (`<runDir>/<stage>/scouts/<role>-report.json`). This module reads that
 * block, validates it against the stage rubric (`core/eval-rubrics.ts`),
 * recomputes the rubric-weighted `overall`, and returns the exact shape the
 * publish chain persists into `eval_runs.judge_scores`.
 *
 * Fully fail-open (Phase A rule 3 / B2 hard rule 2): a missing report, a
 * malformed `scores` block, a criterion id that does not match the rubric, or
 * a missing rubric all return `null` — the publish becomes a
 * deterministic-only row. This helper never throws, so it can sit inside the
 * publish chain's existing fail-open try/catch without ever blocking a
 * publish.
 *
 * Identification: the stage→verifier map (`verifierSpecForArtifact`) resolves
 * the report path; {@link RUBRIC_STAGE_BY_ARTIFACT} maps the published
 * artifact kind to the rubric file (the design stage publishes artifact
 * `design` while its verifier spec key is `architecture-generator`, hence the
 * explicit map rather than reusing the spec key).
 *
 * Layer 1 (`ops/`) — imports Layer 0 (`core/`) + same-layer `doctor/`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JudgeCriterionScore, JudgeScores } from "../core/eval.js";
import { computeOverall, loadRubricForStage, type Rubric, type RubricScore } from "../core/eval-rubrics.js";
import { verifierSpecForArtifact } from "../doctor/checks/reviewer-verdict.js";

/**
 * Published artifact kind → rubric stage key (the `skills/eval-rubrics/<stage>.yaml`
 * basename). `test-plan`/`test-cases` share the testplan rubric.
 */
const RUBRIC_STAGE_BY_ARTIFACT: Readonly<Record<string, string>> = {
	"atomic-functions": "atomic-function",
	pseudocode: "pseudocode",
	"test-plan": "testplan",
	"test-cases": "testplan",
	design: "design",
};

/**
 * Tolerance for comparing the reviewer's reported `overall` against the
 * rubric-weighted recompute. Deterministic math on the same criteria should
 * agree closely; the band absorbs reviewer rounding without hiding a real
 * disagreement.
 */
export const JUDGE_OVERALL_TOLERANCE = 0.01;

/** True for a non-null, non-array object. */
function isPlainObject(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** True for a finite number in `[0, 1]`. */
function isUnitScore(x: unknown): x is number {
	return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
}

/**
 * Validate a raw reviewer `scores` block against `rubric` and normalize it.
 *
 * Contract (plan §"The `scores:` JSON contract", locked): identity fields
 * must be present; every rubric criterion id appears exactly once with a
 * 0..1 score; `overall` is 0..1. The rubric-weighted recompute is compared
 * with the reported `overall` — a disagreement adds a `note` (doctor
 * warning), it is never an error. Any structural violation returns `null`
 * (deterministic-only row).
 *
 * @param {unknown} raw - The parsed `scores` value from the report JSON.
 * @param {Rubric} rubric - The validated stage rubric.
 * @returns {JudgeScores | null} Normalized judge scores, or null when invalid.
 */
export function parseJudgeScores(raw: unknown, rubric: Rubric): JudgeScores | null {
	if (!isPlainObject(raw)) return null;

	const rubricId = raw.rubricId;
	if (typeof rubricId !== "string" || rubricId.trim() === "" || rubricId !== rubric.rubric) return null;

	const rubricVersion = raw.rubricVersion;
	if (typeof rubricVersion !== "number" || !Number.isInteger(rubricVersion) || rubricVersion <= 0) return null;

	const rubricHash = raw.rubricHash;
	if (typeof rubricHash !== "string" || rubricHash.trim() === "") return null;

	const judgeModel = raw.judgeModel;
	if (typeof judgeModel !== "string" || judgeModel.trim() === "") return null;

	const rawCriteria = raw.criteria;
	if (!Array.isArray(rawCriteria) || rawCriteria.length === 0) return null;

	const criteria: JudgeCriterionScore[] = [];
	const seen = new Set<string>();
	for (const entry of rawCriteria) {
		if (!isPlainObject(entry)) return null;
		const id = entry.id;
		if (typeof id !== "string" || id.trim() === "") return null;
		if (seen.has(id)) return null; // duplicate criterion
		seen.add(id);
		if (!isUnitScore(entry.score)) return null;
		const note = entry.note;
		if (note !== undefined && typeof note !== "string") return null;
		criteria.push(note !== undefined ? { id, score: entry.score, note } : { id, score: entry.score });
	}

	// Every rubric criterion must appear exactly once; no unknown ids.
	const rubricIds = new Set(rubric.criteria.map((c) => c.id));
	if (seen.size !== rubricIds.size) return null;
	for (const id of rubricIds) {
		if (!seen.has(id)) return null;
	}
	for (const id of seen) {
		if (!rubricIds.has(id)) return null;
	}

	if (!isUnitScore(raw.overall)) return null;

	const recomputed = computeOverall(rubric, criteria as ReadonlyArray<RubricScore>);
	const result: JudgeScores = {
		rubricId,
		rubricVersion,
		rubricHash,
		judgeModel,
		criteria,
		overall: raw.overall,
	};
	if (Math.abs(raw.overall - recomputed) > JUDGE_OVERALL_TOLERANCE) {
		result.note =
			`reported overall ${raw.overall.toFixed(3)} disagrees with the rubric-weighted recompute ` +
			`${recomputed.toFixed(3)} (Δ ${Math.abs(raw.overall - recomputed).toFixed(3)}) — the reviewer's ` +
			`overall is stored, the recompute is advisory.`;
	}
	return result;
}

/**
 * Read the `scores` field from a reviewer report JSON file. Missing file,
 * unreadable file, malformed JSON, or a non-object root all return `null`
 * (fail-open).
 * @param {string} filePath - Absolute reviewer report path.
 * @returns {unknown | null} The raw `scores` value, or null when absent/invalid.
 */
export function readJudgeScoresFromReport(filePath: string): unknown | null {
	try {
		if (!existsSync(filePath)) return null;
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		if (!isPlainObject(parsed)) return null;
		const scores = parsed.scores;
		return scores === undefined ? null : scores;
	} catch {
		return null;
	}
}

/** Options for {@link loadJudgeScoresForPublish}. */
export interface LoadJudgeScoresOpts {
	/** Absolute run directory (`<cwd>/.IDE_Plans/velpari/runs/<runId>`). */
	runDir: string;
	/** Published artifact kind (e.g. `atomic-functions`, `test-plan`, `design`). */
	artifactKind: string;
	/** Package root containing `skills/eval-rubrics/` (NOT the user project cwd). */
	packageRoot: string;
}

/**
 * Resolve + load + validate the judge scores for a publish. Never throws.
 *
 * Returns null when the artifact is not a reviewer stage, the rubric file is
 * missing, the report file is missing, or the `scores` block is absent/invalid.
 *
 * @param {LoadJudgeScoresOpts} opts - Run dir + artifact kind + package root.
 * @returns {JudgeScores | null} Validated judge scores, or null (fail-open).
 */
export function loadJudgeScoresForPublish(opts: LoadJudgeScoresOpts): JudgeScores | null {
	try {
		const spec = verifierSpecForArtifact(opts.artifactKind);
		if (!spec) return null;
		const rubricStage = RUBRIC_STAGE_BY_ARTIFACT[opts.artifactKind];
		if (!rubricStage) return null;
		const rubric = loadRubricForStage(opts.packageRoot, rubricStage);
		if (!rubric) return null;
		const raw = readJudgeScoresFromReport(join(opts.runDir, spec.verdictSubpath));
		if (raw === null) return null;
		return parseJudgeScores(raw, rubric);
	} catch {
		return null;
	}
}
