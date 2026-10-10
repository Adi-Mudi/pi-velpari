// ============================================================================
// core/eval.ts — deterministic quality-eval scoring (Layer 0, Phase A)
// ============================================================================
// velpari-evals Phase A, Lane A1. Pure scoring logic: check→weight table,
// config hash (G1), weighted total, gate+doctor → DetScore mapping, and the
// per-stage trend math consumed by the doctor "Quality" section (Lane A2).
//
// HARD CONSTRAINT (plan A1.1 + task rule 3): this module is LAYER 0 and
// imports NOTHING from `src/` — only Node builtins. The doctor/gate result
// shapes are accepted STRUCTURALLY (DoctorReportLike / GateResultLike), so
// no L1 (`doctor/`, `ops/`) type import leaks down here.
//
// Scores are deterministic only in Phase A. Judge (LLM rubric) scores are a
// Phase B concern — `EvalRow.judgeScores` is typed `null` for now.
// ============================================================================

import { createHash } from "node:crypto";

/**
 * One deterministic check score. `score` is normalized to 0..1
 * (1 = pass, 0.5 = warning, 0 = error).
 */
export interface DetScore {
	/** Stable check name (e.g. "freshness", "id-coverage", "publish-gate"). */
	name: string;
	/** Normalized score, 0..1. */
	score: number;
	/** Optional human-readable detail (never the artifact text). */
	detail?: string;
}

/**
 * One persisted eval row (Phase A shape). Judge scores are null until the
 * Phase B judge flow lands; `detConfigHash` (G1) makes a scoring-config
 * change distinguishable from a real quality change; `attempts` (G4) is the
 * best-effort publish-attempt count, or null when unavailable.
 */
export interface EvalRow {
	project: string;
	runId: string;
	stage: string;
	artifactKind: string;
	version: string | null;
	model: string;
	durationMs: number | null;
	detScores: DetScore[];
	judgeScores: null;
	totalScore: number;
	detConfigHash: string;
	attempts: number | null;
	createdAt: string;
}

/** Trend view for one stage (doctor "Quality" section). All null when no rows. */
export interface EvalTrend {
	/** Newest row's total score, or null when the stage has no rows. */
	latest: number | null;
	/** Second-newest row's total score, or null when fewer than two rows. */
	previous: number | null;
	/** latest − previous, or null when there is no previous row. */
	delta: number | null;
	/** Mean total score over the newest ≤10 rows, or null when no rows. */
	meanLast10: number | null;
}

/**
 * Weight table per check name. Weights encode severity for the weighted
 * mean: hard publish/traceability checks weigh more than advisory checks.
 * Unknown names default to weight 1. Changing any value changes
 * {@link detConfigHash} — the G1 "scoring config changed" marker.
 */
export const DET_SCORE_WEIGHTS: Readonly<Record<string, number>> = {
	"publish-gate": 2,
	"psrs-shape": 2,
	"id-coverage": 1.5,
	"reviewer-verdict": 1.5,
	freshness: 1,
	shape: 1,
	"rfc2119-ears": 1,
	"mvp-coverage": 1,
};

/** Canonical JSON: object keys sorted (deep), so equal tables always hash equal. */
function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const rec = value as Record<string, unknown>;
	const keys = Object.keys(rec).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
}

/**
 * G1 — stable hash of the deterministic scoring configuration. sha-256 over
 * the canonical JSON of the weight table, hex, first 16 chars. No
 * timestamps, so identical configs hash identically across machines/runs.
 * @param {Readonly<Record<string, number>>} weights - Weight table (defaults to the shipped table).
 * @returns {string} 16-hex-char config hash.
 */
export function detConfigHash(weights: Readonly<Record<string, number>> = DET_SCORE_WEIGHTS): string {
	return createHash("sha256").update(canonicalJson(weights)).digest("hex").slice(0, 16);
}

/**
 * Weighted mean of the check scores. Unknown names get weight 1. Empty
 * input (or a non-positive weight sum) yields 0.
 * @param {readonly DetScore[]} detScores - Per-check scores.
 * @param {Readonly<Record<string, number>>} weights - Weight table.
 * @returns {number} Weighted mean in 0..1 (0 when empty).
 */
export function computeTotalScore(
	detScores: readonly DetScore[],
	weights: Readonly<Record<string, number>> = DET_SCORE_WEIGHTS,
): number {
	if (detScores.length === 0) return 0;
	let weighted = 0;
	let totalWeight = 0;
	for (const det of detScores) {
		const weight = Object.prototype.hasOwnProperty.call(weights, det.name) ? (weights[det.name] ?? 1) : 1;
		weighted += det.score * weight;
		totalWeight += weight;
	}
	if (totalWeight <= 0) return 0;
	return weighted / totalWeight;
}

// ---------------------------------------------------------------------------
// Gate / doctor → DetScore mapping (structural inputs — no L1 imports)
// ---------------------------------------------------------------------------

/** Minimal gate-result shape (structurally compatible with PublishGateResult). */
export interface GateResultLike {
	errors: readonly string[];
	warnings: readonly string[];
}

/** Minimal doctor item shape (structurally compatible with DiagnosticItem). */
export interface DoctorItemLike {
	status: string;
}

/** Minimal doctor section shape (structurally compatible with DiagnosticSection). */
export interface DoctorSectionLike {
	title: string;
	items: readonly DoctorItemLike[];
}

/** Minimal doctor report shape (structurally compatible with DiagnosticReport). */
export interface DoctorReportLike {
	sections: readonly DoctorSectionLike[];
}

/**
 * Stable check-name aliases for the human doctor section titles. Keys are
 * the exact section titles; unmapped titles fall back to a slug of the
 * title. Keeps trend rows comparable across versions.
 */
const CHECK_NAME_ALIASES: Readonly<Record<string, string>> = {
	"Freshness (stale set)": "freshness",
	"ID coverage": "id-coverage",
	"Shape compatibility": "shape",
	"PSRS validation": "psrs-shape",
	"Verifier verdicts (Layer 3)": "reviewer-verdict",
	"MVP coverage": "mvp-coverage",
};

/**
 * Normalize a doctor section title to a stable check name (alias table
 * first, then a lowercase hyphen slug).
 * @param {string} title - Doctor section title.
 * @returns {string} Stable check name.
 */
function checkNameForTitle(title: string): string {
	const aliased = CHECK_NAME_ALIASES[title.trim()];
	if (aliased !== undefined) return aliased;
	const slug = title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "check";
}

/** Worst-status → DetScore.score: error 0, warning 0.5, else pass 1. */
function scoreForSection(section: DoctorSectionLike): number {
	let sawWarning = false;
	for (const item of section.items) {
		if (item.status === "error") return 0;
		if (item.status === "warning") sawWarning = true;
	}
	return sawWarning ? 0.5 : 1;
}

/**
 * Map the publish-gate result + post-publish doctor report to one DetScore
 * per doctor check plus one aggregate `publish-gate` score. Pure: no I/O,
 * no mutation. Info/ok items pass; warnings score 0.5; errors score 0.
 * @param {GateResultLike} gateResult - Publish gate errors/warnings.
 * @param {DoctorReportLike | null} doctorReport - Post-publish doctor report (null when skipped).
 * @returns {DetScore[]} One score per check, in doctor-section order + publish-gate last.
 */
export function detScoresFromGateAndDoctor(
	gateResult: GateResultLike,
	doctorReport: DoctorReportLike | null,
): DetScore[] {
	const scores: DetScore[] = [];
	const sections = doctorReport?.sections ?? [];
	for (const section of sections) {
		scores.push({ name: checkNameForTitle(section.title), score: scoreForSection(section) });
	}
	const gateScore = gateResult.errors.length > 0 ? 0 : gateResult.warnings.length > 0 ? 0.5 : 1;
	scores.push({ name: "publish-gate", score: gateScore });
	return scores;
}

/**
 * Per-stage trend math for the doctor section. Rows whose `stage` differs
 * are ignored. Ordering is by `createdAt` ascending (stable on ties), so
 * callers may pass rows in any order.
 * @param {readonly EvalRow[]} rows - Eval rows (any stage).
 * @param {string} stage - Stage to trend.
 * @returns {EvalTrend} latest/previous/delta/meanLast10 (nulls when absent).
 */
export function trend(rows: readonly EvalRow[], stage: string): EvalTrend {
	const forStage = rows.filter((row) => row.stage === stage);
	if (forStage.length === 0) {
		return { latest: null, previous: null, delta: null, meanLast10: null };
	}
	const ascending = forStage
		.map((row, index) => ({ row, index }))
		.sort((a, b) =>
			a.row.createdAt === b.row.createdAt ? a.index - b.index : a.row.createdAt < b.row.createdAt ? -1 : 1,
		)
		.map((entry) => entry.row);

	const latestRow = ascending[ascending.length - 1]!;
	const previousRow = ascending.length >= 2 ? ascending[ascending.length - 2]! : null;
	const latest = latestRow.totalScore;
	const previous = previousRow ? previousRow.totalScore : null;
	const window = ascending.slice(-10);
	const meanLast10 = window.reduce((sum, row) => sum + row.totalScore, 0) / window.length;
	return { latest, previous, delta: previous === null ? null : latest - previous, meanLast10 };
}
