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

/** Info note surfaced once per report — the judge path is a Phase B item. */
export const JUDGE_PENDING_NOTE = "Judge scores: pending (Phase B) — deterministic scores only.";

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
	}

	items.push({ status: "info", message: JUDGE_PENDING_NOTE });
	return { title: EVAL_QUALITY_TITLE, items };
}
