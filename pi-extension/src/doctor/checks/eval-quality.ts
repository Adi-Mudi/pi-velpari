/**
 * Local quality-eval score check (evals Phase A) — doctor "Quality" section.
 *
 * Renders the deterministic scores recorded at publish time into
 * `Eval/<projectName>/eval.db` (a separate, gitignored, user-deletable
 * SQLite DB — never the committed artifact store). This is informational
 * telemetry only: the section NEVER emits an error and never blocks a
 * publish or an advance (N24-15 report-only policy).
 *
 * What it reports, per stage:
 *  - the latest total score,
 *  - the delta vs the previous publish of that stage,
 *  - the mean of the last 10 publishes,
 *  - a per-model breakdown,
 *  - a "scoring config changed" marker when the row's `det_config_hash`
 *    differs from the previous row of the same stage (a weight-table
 *    change makes score deltas across that boundary non-comparable, so
 *    it is a note, not a defect).
 *
 * Missing / unreadable eval data degrades to a single info row — deleting
 * `Eval/` at any time is supported by design. The pure math lives in
 * `core/eval.ts:trend`; DB access stays behind `io/db.ts` (D9).
 */

import { existsSync } from "node:fs";
import { evalDbPath } from "../../core/paths.js";
import { trend, type EvalRow } from "../../core/eval.js";
import { openEvalDb, listEvalRows, closeStoreDb } from "../../io/db.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";

/** Info note surfaced when a stage has no judged row — judge data arrives with a reviewer-stage publish. */
export const JUDGE_PENDING_NOTE =
	"Judge scores: none recorded yet — rubric judge scores appear once a reviewer-stage publish carries a scores block.";

/** Title of the section; single source of truth for the doctor test. */
export const EVAL_QUALITY_TITLE = "Quality (local evals)";

/**
 * Format a 0..1 score, or `n/a` when there is no value.
 * @param {number | null} value - Score or null.
 * @returns {string} Human-readable score.
 */
function fmtScore(value: number | null): string {
	return value === null ? "n/a" : value.toFixed(3);
}

/**
 * Short display form of a `det_config_hash` (it is a 16-char hex digest).
 * @param {string} hash - Full hash.
 * @returns {string} First 8 chars (or the whole string when short).
 */
function shortHash(hash: string): string {
	return hash.slice(0, 8);
}

/**
 * Sort rows oldest-first by `createdAt` so `.at(-1)` is the newest. ISO
 * timestamps sort lexicographically; equal timestamps keep input order.
 * @param {EvalRow[]} rows - Rows to sort (not mutated).
 * @returns {EvalRow[]} A new sorted array.
 */
function sortByCreatedAtAsc(rows: EvalRow[]): EvalRow[] {
	return [...rows].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/**
 * Latest row per model within one stage's rows (newest `createdAt` wins).
 * @param {EvalRow[]} rows - Rows for one stage.
 * @returns {Map<string, EvalRow>} model → its newest row.
 */
function latestByModel(rows: EvalRow[]): Map<string, EvalRow> {
	const byModel = new Map<string, EvalRow>();
	for (const row of rows) {
		const model = row.model ?? "unknown";
		const current = byModel.get(model);
		if (!current || current.createdAt <= row.createdAt) byModel.set(model, row);
	}
	return byModel;
}

/**
 * Build the "Quality (local evals)" doctor section.
 *
 * @param {string} cwd - Project root.
 * @param {string} projectName - Configured `projectName` (empty → info row).
 * @returns {DiagnosticSection} Informational scores/trend section.
 */
export function checkEvalQualitySection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({ status: "info", message: "No configured project — no eval data yet." });
		return { title: EVAL_QUALITY_TITLE, items };
	}

	const dbPath = evalDbPath(cwd, projectName);
	if (!existsSync(dbPath)) {
		items.push({
			status: "info",
			message: `No eval data yet (Eval/${projectName}/eval.db absent) — scores are recorded at publish time.`,
		});
		items.push({ status: "info", message: JUDGE_PENDING_NOTE });
		return { title: EVAL_QUALITY_TITLE, items };
	}

	let rows: EvalRow[];
	try {
		const db = openEvalDb(dbPath);
		try {
			rows = listEvalRows(db, projectName);
		} finally {
			closeStoreDb(db);
		}
	} catch (err) {
		// Fail-open by design: a corrupt/deleted Eval/ DB never fails the doctor.
		items.push({
			status: "info",
			message: `Eval data unreadable (${(err as Error).message}) — skipping quality report. Delete Eval/ to reset.`,
		});
		items.push({ status: "info", message: JUDGE_PENDING_NOTE });
		return { title: EVAL_QUALITY_TITLE, items };
	}

	if (rows.length === 0) {
		items.push({ status: "info", message: "Eval DB present but no rows recorded yet." });
		items.push({ status: "info", message: JUDGE_PENDING_NOTE });
		return { title: EVAL_QUALITY_TITLE, items };
	}

	// Group rows by stage, preserving first-seen stage order.
	const byStage = new Map<string, EvalRow[]>();
	for (const row of rows) {
		const bucket = byStage.get(row.stage);
		if (bucket) bucket.push(row);
		else byStage.set(row.stage, [row]);
	}

	let judgedStages = 0;

	for (const [stage, stageRows] of byStage) {
		const sorted = sortByCreatedAtAsc(stageRows);
		const t = trend(stageRows, stage);
		const modelLines = [...latestByModel(stageRows).entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([model, row]) => `- ${model}: latest ${fmtScore(row.totalScore)}`);

		items.push({
			status: "ok",
			message:
				`Stage '${stage}': latest ${fmtScore(t.latest)} ` +
				`(Δ ${fmtScore(t.delta)}) — mean(last 10) ${fmtScore(t.meanLast10)}`,
			details: modelLines.length > 0 ? modelLines : undefined,
		});

		const latestRow = sorted.at(-1);
		const previousRow = sorted.at(-2);
		if (latestRow && previousRow && latestRow.detConfigHash !== previousRow.detConfigHash) {
			items.push({
				status: "info",
				message:
					`Stage '${stage}': scoring config changed (` +
					`${shortHash(previousRow.detConfigHash)} → ${shortHash(latestRow.detConfigHash)}) — ` +
					`scores across this boundary are not directly comparable.`,
			});
		}

		// Phase B (B2.3): judge line for the latest judged row — overall,
		// per-criterion sub-scores, judge + rubric identity. Informational only.
		const judgedRows = sorted.filter((row) => row.judgeScores !== null);
		const judge = judgedRows.length > 0 ? judgedRows[judgedRows.length - 1]!.judgeScores : null;
		if (judge) {
			judgedStages++;
			const criteriaLines = judge.criteria.map(
				(c) => `- ${c.id}: ${fmtScore(c.score)}${c.note ? ` (${c.note})` : ""}`,
			);
			items.push({
				status: "ok",
				message:
					`Stage '${stage}': judge ${fmtScore(judge.overall)} — ${judge.judgeModel}; ` +
					`rubric ${judge.rubricId}@v${judge.rubricVersion} (${shortHash(judge.rubricHash)})`,
				details: criteriaLines.length > 0 ? criteriaLines : undefined,
			});
			if (judge.note) {
				items.push({
					status: "warning",
					message: `Stage '${stage}': judge overall mismatch — ${judge.note}`,
				});
			}
			// Discontinuity: a judge model or rubric change between consecutive
			// judged rows makes their scores non-comparable. Info, never error.
			const prevJudge = judgedRows.length >= 2 ? judgedRows[judgedRows.length - 2]!.judgeScores : null;
			if (prevJudge) {
				const changes: string[] = [];
				if (prevJudge.judgeModel !== judge.judgeModel) {
					changes.push(`judgeModel ${prevJudge.judgeModel} → ${judge.judgeModel}`);
				}
				if (prevJudge.rubricHash !== judge.rubricHash) {
					changes.push(`rubricHash ${shortHash(prevJudge.rubricHash)} → ${shortHash(judge.rubricHash)}`);
				}
				if (changes.length > 0) {
					items.push({
						status: "info",
						message:
							`Stage '${stage}': judge identity changed (${changes.join("; ")}) — ` +
							`judge scores across this boundary are not directly comparable.`,
					});
				}
			}
		}
	}

	if (judgedStages === 0) {
		items.push({ status: "info", message: JUDGE_PENDING_NOTE });
	}
	return { title: EVAL_QUALITY_TITLE, items };
}
