/**
 * Baselined-vs-superseded report (Phase 6 — F7, Master Outline row 6).
 *
 * F7 made `baselines` first-class: a consumer stage records the exact
 * revision it adopted. This check joins those rows against
 * `artifact_revisions` and reports any baseline whose revision is no
 * longer `published` — "the consumer adopted stale content".
 *
 * Severity (plan §3 R1, decision D2):
 *   - `superseded` → info (the acceptance clause says "report"; a
 *     warning here would block every publish during the normal
 *     re-confirm window — v1.2.1 blocks on warnings too).
 *   - `withdrawn`  → error (the adopted content was pulled; downstream
 *     rests on material someone deliberately retracted).
 *
 * Reads store rows directly, writes nothing, never throws (R2/R3).
 * L1 (doctor) → L0 — legal direction.
 */

import { existsSync } from "node:fs";
import { buildStoreDbPath } from "../../core/paths.js";
import { loadFilesConfig, validateFilesConfig } from "../../core/config.js";
import { getEffectiveProjectNames } from "../../core/projectnames.js";
import { openStoreDb, closeStoreDb } from "../../io/db.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Baselines vs revisions (F7)";

/** One baseline row whose revision is not `published`. */
interface DriftedBaseline {
	kind: string;
	consumer_stage: string;
	revision_id: number;
	baselined_at: string;
	status: string;
	revision_number: number;
	run_id: string;
}

/** Max revision_number per kind (for "head is rN" context). */
function heads(db: ReturnType<typeof openStoreDb>): Map<string, number> {
	const rows = db
		.prepare("SELECT kind, MAX(revision_number) AS n FROM artifact_revisions GROUP BY kind")
		.all() as unknown as Array<{ kind: string; n: number }>;
	return new Map(rows.map((r) => [r.kind, r.n]));
}

/** Effective projectNames for the cwd, or [] when config is missing/invalid. */
function effectiveProjectNamesSafe(cwd: string): string[] {
	try {
		const cfg = loadFilesConfig(cwd);
		if (!validateFilesConfig(cfg)) return [];
		return getEffectiveProjectNames(cfg);
	} catch {
		return [];
	}
}

/**
 * Build the "Baselines vs revisions (F7)" section. Multi-design aware:
 * one audit per effective projectName's store DB.
 */
export function checkBaselinesSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		const projectNames = effectiveProjectNamesSafe(cwd);

		if (projectNames.length === 0) {
			items.push({
				status: "info",
				message: "Baseline check skipped — project name missing.",
				suggestion: suggestionFor("project-name-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		const dbPaths = projectNames.map((projectName) => ({
			projectName,
			dbPath: buildStoreDbPath(projectName, cwd),
		}));

		if (dbPaths.every(({ dbPath }) => !existsSync(dbPath))) {
			items.push({
				status: "info",
				message: "No store DB yet — baselines appear after the first stage start on a store-backed run.",
				details: dbPaths.map(({ dbPath }) => `expected: ${dbPath}`),
				suggestion: suggestionFor("store-db-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		for (const { projectName, dbPath } of dbPaths) {
			if (!existsSync(dbPath)) {
				items.push({
					status: "info",
					message: `${projectName}: no store DB (pre-store project).`,
					details: [`expected: ${dbPath}`],
					suggestion: suggestionFor("store-db-missing"),
				});
				continue;
			}
			const db = openStoreDb(dbPath);
			try {
				const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'baselines'").get() as
					| { name: string }
					| undefined;
				if (!table) {
					items.push({
						status: "info",
						message: `${projectName}: baselines table not present in this store schema.`,
						details: [`db=${dbPath}`],
					});
					continue;
				}

				const total = (db.prepare("SELECT COUNT(*) AS n FROM baselines").get() as { n: number }).n;
				const drifted = db
					.prepare(
						`SELECT b.kind, b.consumer_stage, b.revision_id, b.baselined_at,
						        r.status, r.revision_number, r.run_id
						 FROM baselines b
						 JOIN artifact_revisions r ON r.revision_id = b.revision_id
						 WHERE r.status <> 'published'
						 ORDER BY b.kind, b.consumer_stage`,
					)
					.all() as unknown as DriftedBaseline[];

				if (drifted.length === 0) {
					items.push({
						status: "ok",
						message:
							total === 0
								? `${projectName}: no baselines recorded yet (no stage has consumed an artifact revision).`
								: `${projectName}: ${total} baseline(s), all pointing at published revisions.`,
					});
					continue;
				}

				const head = heads(db);
				for (const d of drifted) {
					const headNote = head.has(d.kind) ? ` — head is r${head.get(d.kind)}` : "";
					if (d.status === "withdrawn") {
						items.push({
							status: "error",
							message:
								`${projectName}: ${d.kind} baseline adopted by ${d.consumer_stage} points at ` +
								`revision r${d.revision_number} (rev_id ${d.revision_id}, WITHDRAWN) — ` +
								"the consumer adopted content that was pulled.",
							details: [`baselined_at=${d.baselined_at}`, `run=${d.run_id}`, `db=${dbPath}`],
							suggestion: suggestionFor("baseline-withdrawn"),
						});
					} else {
						items.push({
							status: "info",
							message:
								`${projectName}: ${d.kind} baseline adopted by ${d.consumer_stage} points at ` +
								`revision r${d.revision_number} (rev_id ${d.revision_id}, superseded${headNote}) — ` +
								"the consumer adopted a non-head revision.",
							details: [`baselined_at=${d.baselined_at}`, `run=${d.run_id}`, `db=${dbPath}`],
							suggestion: suggestionFor("baseline-superseded"),
						});
					}
				}
			} finally {
				closeStoreDb(db);
			}
		}
	} catch (err) {
		items.push({
			status: "info",
			message: `Baseline check skipped: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
	return { title: SECTION_TITLE, items };
}
