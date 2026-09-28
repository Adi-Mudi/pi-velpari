// ============================================================================
// core/soft-lock.ts — downstream-consumption locks (Phase B, N19/N20/G1)
// ============================================================================
// Decision record: .IDE_Plans/velpari-upgrade-phase-b-locking_plan_20260928_0806_v1.0.md
//   D8  — detection lives at the publish gate: FOUND declared inputs UNION
//         id-coverage rules with parseable refs (status ≠ not-checkable).
//   D9  — a lock lives ON the revision row (artifact_revisions.locked_at /
//         locked_by, v006). locked_by = the consumer's freshness manifest
//         key (e.g. "rtm:MyProj" — manifestKey lowercases the artifact).
//         Per-revision markers mean update cycles work naturally: a republish
//         creates a fresh unlocked head; superseded rows keep their marker as
//         history. No manual unlock exists (N19).
//   D10 — fail-open: a missing store, a missing column, or any error returns
//         empty results; a missing lock marker NEVER blocks a publish.
//
// Layer 0: imports io/db.ts (values) + io/store.ts (type-only — erased at
// runtime, so no store↔soft-lock↔store cycle).
// ============================================================================

import { existsSync } from "node:fs";
import { buildStoreDbPath } from "./paths.js";
import { openStoreDb, openStoreDbReadOnly, closeStoreDb, appendAuditEntry, stampStoreContentDigest } from "../io/db.js";
import type { DatabaseSync } from "node:sqlite";
import type { ArtifactKind } from "../io/store.js"; // type-only: erased at runtime (no cycle)

/** One revision newly locked by a publish. */
export interface SoftLockMark {
	kind: ArtifactKind;
	revisionId: number;
	revisionNumber: number;
}

/** One existing lock row read back for SURFACE warnings. */
export interface SoftLockRow {
	revisionId: number;
	kind: ArtifactKind;
	revisionNumber: number;
	/** Revision lifecycle status — the gate surfaces published rows only. */
	status: "published" | "superseded" | "withdrawn";
	lockedAt: string;
	lockedBy: string;
}

/**
 * Freshness/paths artifact key (lowercase part, e.g. "prd", "test-plan") →
 * store ArtifactKind. Null = the artifact has no store rows (brainstorm,
 * input-doc, …) or is simply unknown — its consumption cannot lock anything.
 * @param {string} artifactKey - Artifact key (case-insensitive; "PRD" → "prd").
 * @returns {ArtifactKind | null} The store kind, or null when unmapped.
 */
export function artifactKeyToStoreKind(artifactKey: string): ArtifactKind | null {
	switch (artifactKey.toLowerCase()) {
		case "prd":
			return "prd";
		case "rtm":
			return "rtm";
		case "feasibility-study":
			return "feasibility";
		case "design":
			return "design";
		case "atomic-functions":
			return "atomic-functions";
		case "pseudocode":
			return "pseudocode";
		case "test-plan":
		case "test-cases":
			return "testplan"; // one store kind holds BOTH artifacts (KIND_TABLES)
		case "development-order":
			return "development-order";
		case "final-design":
			return "final-design";
		default:
			return null;
	}
}

/**
 * Store ArtifactKind → the freshness artifact keys a publish of that kind
 * carries in its consumerKey (reverse map; testplan → both test artifacts).
 * Keys are artifact PARTS: clearLocksForConsumer matches a part exactly or
 * as the `part:` prefix of a full manifest key (D9).
 * @param {ArtifactKind} kind - Store artifact kind.
 * @returns {string[]} Freshness artifact keys (lowercase).
 */
export function consumerKeysForKind(kind: ArtifactKind): string[] {
	switch (kind) {
		case "testplan":
			return ["test-plan", "test-cases"];
		case "prd":
			return ["prd"];
		case "rtm":
			return ["rtm"];
		case "feasibility":
			return ["feasibility-study"];
		case "design":
			return ["design"];
		case "atomic-functions":
			return ["atomic-functions"];
		case "pseudocode":
			return ["pseudocode"];
		case "development-order":
			return ["development-order"];
		case "final-design":
			return ["final-design"];
	}
}

/** Split a freshness id / manifest key into its artifact part ("rtm:MyProj" → "rtm"). */
function artifactPartOf(key: string): string {
	const idx = key.indexOf(":");
	return (idx === -1 ? key : key.slice(0, idx)).toLowerCase();
}

/**
 * Upstream artifact keys for one publish (D8): FOUND declared-input ids ∪
 * coverage-derived keys, normalized to artifact parts, self excluded,
 * deduplicated. Unmapped parts are filtered later by markConsumedUpstreams.
 * @param opts - The artifact being published + its detection inputs.
 * @param {string} opts.artifactKey - Artifact key being published.
 * @param {readonly string[]} opts.declaredInputIds - FOUND freshness ids ("<kind>:<id>").
 * @param {readonly string[]} opts.coverageUpstreamKeys - Keys from id-coverage rules with parseable refs.
 * @returns {string[]} Normalized upstream artifact keys (sorted, deduped, no self).
 */
export function upstreamArtifactsForPublish(opts: {
	artifactKey: string;
	declaredInputIds: readonly string[];
	coverageUpstreamKeys: readonly string[];
}): string[] {
	const self = opts.artifactKey.toLowerCase();
	const seen = new Set<string>();
	for (const raw of [...opts.declaredInputIds, ...opts.coverageUpstreamKeys]) {
		const part = artifactPartOf(raw);
		if (part.length === 0 || part === self) continue;
		seen.add(part);
	}
	return [...seen].sort();
}

/**
 * Lock the published head revision of every mapped upstream kind not yet
 * locked (DETECT → MARK). One txn: marker UPDATEs + `soft-lock` audit entries
 * + content-digest re-stamp (D11). Fail-open: any error (no store, no column,
 * locked DB) returns `{ locked: [] }` — a missing marker never blocks (D10).
 * @param {string} cwd - Project root.
 * @param {string} projectName - Store project name.
 * @param {string} consumerKey - Full manifest key of the publishing artifact ("rtm:MyProj").
 * @param {readonly string[]} upstreamArtifacts - Upstream artifact keys (see upstreamArtifactsForPublish).
 * @returns {{ locked: SoftLockMark[] }} Revisions newly locked by this call.
 */
export function markConsumedUpstreams(
	cwd: string,
	projectName: string,
	consumerKey: string,
	upstreamArtifacts: readonly string[],
): { locked: SoftLockMark[] } {
	try {
		const self = artifactPartOf(consumerKey);
		const kinds = new Set<ArtifactKind>();
		for (const key of upstreamArtifacts) {
			const part = artifactPartOf(key);
			if (part === self) continue; // never lock your own kind (D8)
			const kind = artifactKeyToStoreKind(part);
			if (kind !== null) kinds.add(kind);
		}
		if (kinds.size === 0) return { locked: [] };

		const dbPath = buildStoreDbPath(projectName, cwd);
		if (!existsSync(dbPath)) return { locked: [] }; // fail-open: no store yet
		const db = openStoreDb(dbPath);
		try {
			db.exec("BEGIN IMMEDIATE;");
			try {
				const locked: SoftLockMark[] = [];
				const now = new Date().toISOString();
				for (const kind of kinds) {
					const rows = db
						.prepare(
							"SELECT revision_id, revision_number FROM artifact_revisions " +
								"WHERE kind = ? AND status = 'published' AND locked_at IS NULL",
						)
						.all(kind) as unknown as { revision_id: number; revision_number: number }[];
					for (const row of rows) {
						db.prepare("UPDATE artifact_revisions SET locked_at = ?, locked_by = ? WHERE revision_id = ?").run(
							now,
							consumerKey,
							row.revision_id,
						);
						appendAuditEntry(db, {
							actor: "velpari-soft-lock",
							action: "soft-lock",
							artifactKind: kind,
							revisionNumber: row.revision_number,
							reason: "consumed downstream",
							detail: { consumerKey },
						});
						locked.push({
							kind,
							revisionId: row.revision_id,
							revisionNumber: row.revision_number,
						});
					}
				}
				if (locked.length > 0) stampStoreContentDigest(db); // D11: marker columns are content
				db.exec("COMMIT;");
				return { locked };
			} catch (err) {
				db.exec("ROLLBACK;");
				throw err;
			}
		} finally {
			closeStoreDb(db);
		}
	} catch {
		return { locked: [] }; // D10 fail-open
	}
}

/**
 * Read existing locks (SURFACE input). Read-only open — never migrates,
 * never writes; a legacy store without the v006 columns (or any error)
 * returns [] (D10: locks only exist once the schema does).
 * @param {string} cwd - Project root.
 * @param {string} projectName - Store project name.
 * @param {ArtifactKind} [kind] - Restrict to one store kind.
 * @returns {SoftLockRow[]} The lock rows ([] when none / no store).
 */
export function listSoftLocks(cwd: string, projectName: string, kind?: ArtifactKind): SoftLockRow[] {
	try {
		const dbPath = buildStoreDbPath(projectName, cwd);
		if (!existsSync(dbPath)) return [];
		const db = openStoreDbReadOnly(dbPath);
		try {
			const sql =
				"SELECT revision_id, kind, revision_number, status, locked_at, locked_by FROM artifact_revisions " +
				(kind === undefined ? "WHERE locked_at IS NOT NULL" : "WHERE kind = ? AND locked_at IS NOT NULL");
			const stmt = db.prepare(sql);
			const rows = (kind === undefined ? stmt.all() : stmt.all(kind)) as unknown as {
				revision_id: number;
				kind: ArtifactKind;
				revision_number: number;
				status: "published" | "superseded" | "withdrawn";
				locked_at: string;
				locked_by: string;
			}[];
			return rows.map((r) => ({
				revisionId: r.revision_id,
				kind: r.kind,
				revisionNumber: r.revision_number,
				status: r.status,
				lockedAt: r.locked_at,
				lockedBy: r.locked_by,
			}));
		} finally {
			db.close();
		}
	} catch {
		return []; // D10 fail-open (incl. pre-v006 stores: no locked_at column)
	}
}

/**
 * Clear locks set by a consumer's now-reverted publish (D9): caller owns the
 * transaction (revertPublish runs this inside its own txn). `keys` are
 * artifact PARTS (consumerKeysForKind); a lock matches when locked_by equals
 * the part or starts with `part:` (the full manifest key form). Returns the
 * number of rows cleared (0 = nothing to release).
 * @param {DatabaseSync} db - Open store connection (txn open).
 * @param {readonly string[]} keys - Consumer artifact parts (e.g. ["test-plan","test-cases"]).
 * @returns {number} Rows cleared.
 */
export function clearLocksForConsumer(db: DatabaseSync, keys: readonly string[]): number {
	let total = 0;
	for (const key of keys) {
		try {
			const res = db
				.prepare(
					"UPDATE artifact_revisions SET locked_at = NULL, locked_by = NULL " +
						"WHERE locked_by = ? OR locked_by LIKE ? ESCAPE '\\'",
				)
				.run(key, `${key.replace(/[\\%_]/g, "\\$&")}%`);
			total += Number(res.changes);
		} catch {
			// Fail-open (D10): never block a revert over lock bookkeeping.
		}
	}
	return total;
}
