/**
 * Store DB link-orphan check (Phase 7 — doctor as SQL).
 *
 * The `links` adjacency table (v001, §4.6) records trace edges between
 * row-set nodes. This check verifies that every link endpoint resolves
 * to a real row in the same run: a dangling `from_*` or `to_*` endpoint
 * means a broken trace edge (corrupt export, hand-edited DB, or a bug
 * in the payload writer). Draft endpoints count as resolved — a
 * mid-pipeline draft reference is normal, not corruption.
 *
 * Endpoint resolution per link kind (v001 schema):
 *   fr→fr.id, nfr→nfr.id, rtm→rtm_row.id, feasibility→feasibility_decision
 *   (node id IS the run_id — its PK has no id column), design_module→id,
 *   adr→id, diagram→id, af→atomic_function.id, pseudocode→pseudocode_block.id,
 *   tc→test_case.id, dev_step→dev_step.id, final_section→CAST(no AS TEXT)
 *   (final_section is keyed by integer `no`).
 *
 * Multi-design: one audit per effective projectName's DB. L1 (doctor) →
 * L0 (io/db, core/paths) — legal direction.
 */

import { existsSync } from "node:fs";
import { buildStoreDbPath } from "../../core/paths.js";
import { loadFilesConfig, validateFilesConfig } from "../../core/config.js";
import { getEffectiveProjectNames } from "../../core/projectnames.js";
import { openStoreDb, closeStoreDb } from "../../io/db.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests + action-items callout key on it). */
const SECTION_TITLE = "Store DB link orphans";

/** Cap the per-item orphan listing; a count item reports the total. */
const MAX_LISTED_ORPHANS = 50;

/** One dangling-endpoint link row. */
interface OrphanLink {
	run_id: string;
	from_kind: string;
	from_id: string;
	relation: string;
	to_kind: string;
	to_id: string;
}

/**
 * CTE resolving every link endpoint kind to its node table. The v001
 * kind CHECK constraint (`links` DDL in db-schema.ts) and this map must
 * stay in sync.
 */
const ENDPOINTS_CTE = `
WITH endpoints(run_id, kind, node_id) AS (
	SELECT run_id, 'fr', id FROM fr
	UNION ALL SELECT run_id, 'nfr', id FROM nfr
	UNION ALL SELECT run_id, 'feasibility', run_id FROM feasibility_decision
	UNION ALL SELECT run_id, 'design_module', id FROM design_module
	UNION ALL SELECT run_id, 'adr', id FROM adr
	UNION ALL SELECT run_id, 'diagram', id FROM diagram
	UNION ALL SELECT run_id, 'af', id FROM atomic_function
	UNION ALL SELECT run_id, 'pseudocode', id FROM pseudocode_block
	UNION ALL SELECT run_id, 'tc', id FROM test_case
	UNION ALL SELECT run_id, 'dev_step', id FROM dev_step
	UNION ALL SELECT run_id, 'final_section', CAST(no AS TEXT) FROM final_section
)`;

/** Count + list orphan links (dangling from/to endpoints) for one DB. */
function findOrphans(dbPath: string): { total: number; orphans: OrphanLink[] } | null {
	if (!existsSync(dbPath)) return null;
	const db = openStoreDb(dbPath);
	try {
		const countRow = db
			.prepare(
				`${ENDPOINTS_CTE}
				 SELECT COUNT(*) AS n
				 FROM links l
				 WHERE NOT EXISTS (SELECT 1 FROM endpoints e WHERE e.run_id = l.run_id AND e.kind = l.from_kind AND e.node_id = l.from_id)
				    OR NOT EXISTS (SELECT 1 FROM endpoints e WHERE e.run_id = l.run_id AND e.kind = l.to_kind AND e.node_id = l.to_id)`,
			)
			.get() as { n: number };
		const orphans = db
			.prepare(
				`${ENDPOINTS_CTE}
				 SELECT l.run_id, l.from_kind, l.from_id, l.relation, l.to_kind, l.to_id
				 FROM links l
				 WHERE NOT EXISTS (SELECT 1 FROM endpoints e WHERE e.run_id = l.run_id AND e.kind = l.from_kind AND e.node_id = l.from_id)
				    OR NOT EXISTS (SELECT 1 FROM endpoints e WHERE e.run_id = l.run_id AND e.kind = l.to_kind AND e.node_id = l.to_id)
				 ORDER BY l.run_id, l.from_kind, l.from_id, l.to_kind, l.to_id
				 LIMIT ${MAX_LISTED_ORPHANS}`,
			)
			.all() as unknown as OrphanLink[];
		return { total: countRow.n, orphans };
	} finally {
		closeStoreDb(db);
	}
}

/** Total links row count for one DB (null when the DB is absent). */
function countLinks(dbPath: string): number | null {
	if (!existsSync(dbPath)) return null;
	const db = openStoreDb(dbPath);
	try {
		const row = db.prepare("SELECT COUNT(*) AS n FROM links").get() as { n: number };
		return row.n;
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Effective projectNames for the cwd, or [] when config is missing or
 * invalid (the check degrades to an info item instead of throwing —
 * doctor must always render a usable report).
 */
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
 * Build the "Store DB link orphans" section. Multi-design aware: one
 * audit item per effective projectName's DB. No DB anywhere → single
 * info note (pre-store project).
 */
export function checkDbLinkOrphansSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const projectNames = effectiveProjectNamesSafe(cwd);

	if (projectNames.length === 0) {
		items.push({
			status: "info",
			message: "Link orphan check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: SECTION_TITLE, items };
	}

	const dbPaths = projectNames.map((p) => ({ projectName: p, dbPath: buildStoreDbPath(p, cwd) }));

	if (dbPaths.every(({ dbPath }) => !existsSync(dbPath))) {
		items.push({
			status: "info",
			message: "No store DB yet — link orphan check will run after the first publish.",
			details: dbPaths.map(({ dbPath }) => `expected: ${dbPath}`),
			suggestion: suggestionFor("store-db-missing"),
		});
		return { title: SECTION_TITLE, items };
	}

	for (const { projectName, dbPath } of dbPaths) {
		const linkCount = countLinks(dbPath);
		if (linkCount === null) {
			items.push({
				status: "info",
				message: `${projectName}: no store DB (pre-store project).`,
				details: [`expected: ${dbPath}`],
				suggestion: suggestionFor("store-db-missing"),
			});
			continue;
		}
		if (linkCount === 0) {
			items.push({
				status: "ok",
				message: `${projectName}: links adjacency empty (no trace links written yet).`,
			});
			continue;
		}
		const found = findOrphans(dbPath);
		if (!found || found.total === 0) {
			items.push({
				status: "ok",
				message: `${projectName}: ${linkCount} link(s), all endpoints resolve.`,
			});
			continue;
		}
		for (const o of found.orphans) {
			items.push({
				status: "error",
				message:
					`${projectName}: orphan link ${o.from_kind}:${o.from_id} --${o.relation}--> ` +
					`${o.to_kind}:${o.to_id} (run ${o.run_id}) — an endpoint has no row.`,
				details: [`db=${dbPath}`],
				suggestion: suggestionFor("store-db-orphan-link"),
			});
		}
		if (found.total > found.orphans.length) {
			items.push({
				status: "error",
				message: `${projectName}: ${found.total} orphan links total — showing first ${found.orphans.length}.`,
			});
		}
	}

	return { title: SECTION_TITLE, items };
}
