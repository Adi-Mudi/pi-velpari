// ============================================================================
// ops/retention.ts — keep-last-N revision retention (Phase 4, Layer 1)
// ============================================================================
// Decision record: .IDE_Plans/velpari-versioning-locking-recovery_discussion_20260926_2134_v1.0.md
//   N7     — retention is per-project config: `velpari.retention.revisions:
//            "all"` (default — keep forever) or keep-last-N. Cleanup is an
//            EXPLICIT confirmed command (/velpari-retention-prune), never
//            automatic. NEVER prunes the head revision or any revision
//            referenced by `baselines` (F7 — downstream pinned to it).
//   F16/F9 — prune = status → 'withdrawn' + row deletion of the SNAPSHOT
//            (instruction doc). Only ever targets superseded, non-baselined
//            revisions; one appendAuditEntry per pruned revision (F17).
//   F21    — the supersession chain stays readable across a prune: the
//            surviving successor re-attaches to the pruned row's own
//            predecessor (lineage splice inside the same txn).
//   Fix 2  — the prune git-commits the store DB immediately with an
//            explicit-path commit (Phase-2 commitProtectionChange precedent,
//            Q6 "track everything"): the audit trail is git-anchored at
//            prune time, not at some later unrelated publish.
//
// Ownership note (Master Outline §4.2): this file is Phase-4-owned; it
// IMPORTS Phase-2's ops/protection.ts helpers (listRevisions,
// readHeadRevisionId, commitProtectionChange) and F's retentionConfig() —
// no foreign file is edited. The prune txn mirrors withProtectionTxn's
// audit/tx ordering (plan 4.3.1) with one addition Phase 2's helper cannot
// express: a BENIGN skip (raced withdraw / head re-check hit) aborts the
// txn writing NO audit/tx entries — a skip is not a mutation.
//
// Scope guard: L1 scan + audited prune + explicit git commit only. No
// picker UX (L3 owns ctx.ui), no head/supersession mutations, no publish.
// ============================================================================

import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openStoreDb, closeStoreDb } from "../io/db.js";
import type { ArtifactKind } from "../io/store.js";
import { KIND_ORDER, appendAuditEntry, appendTxEntry, checkpointNow } from "../io/store.js";
import { retentionConfig, type RetentionConfig } from "../core/config.js";
import { buildStoreDbPath } from "../core/paths.js";
import { listRevisions, readHeadRevisionId, readRevisionIdentity, commitProtectionChange } from "./protection.js";

/** One revision row the prune wants to remove (for the confirm report). */
export interface RetentionCandidate {
	kind: ArtifactKind;
	revisionId: number;
	revisionNumber: number;
	runId: string;
}

/** One kind's retention picture (the confirm report's rows). */
export interface RetentionScanKind {
	kind: ArtifactKind;
	/** The configured keep-last-N for this scan. */
	keep: number | "all";
	/** Non-withdrawn revisions of the kind (head + superseded). */
	total: number;
	/** Beyond keep-N, excluding protected rows — what the prune removes. */
	prunable: RetentionCandidate[];
	/** Head + baselined rows kept even though they are older than N. */
	protectedCount: number;
}

/** scanRetention result — a pure read; the prune plan + its protections. */
export interface RetentionScan {
	config: RetentionConfig;
	perKind: RetentionScanKind[];
	prunableCount: number;
}

/** pruneRetentions result — `problems` carries refusals/race skips. */
export interface RetentionPruneResult {
	ok: boolean;
	pruned: number;
	problems: string[];
	/** Git-commit warnings (Fix 2) — never a failed prune. */
	warnings: string[];
}

/**
 * Revision ids protected from pruning: every current head pointer + every
 * baselined revision (F7 — downstream pinned to the exact revision).
 */
function protectedRevisionIds(db: DatabaseSync): Set<number> {
	const heads = db
		.prepare("SELECT DISTINCT head_revision_id AS h FROM artifacts WHERE head_revision_id IS NOT NULL")
		.all() as { h: number }[];
	const baselined = db.prepare("SELECT revision_id AS r FROM baselines").all() as { r: number }[];
	const ids = new Set<number>();
	for (const row of heads) ids.add(Number(row.h));
	for (const row of baselined) ids.add(Number(row.r));
	return ids;
}

/**
 * Compute the prune plan for a numeric keep-N: per kind (KIND_ORDER), the
 * newest N non-withdrawn revisions are kept; older rows are prunable
 * EXCEPT head/baselined rows (they count as protected instead). The caller
 * holds the open DB — used by both scanRetention and pruneRetentions so
 * the prune always recomputes against LIVE rows (a stale scan never deletes).
 */
function computePrunePlan(
	db: DatabaseSync,
	keepN: number,
): { kinds: Array<{ kind: ArtifactKind; candidates: RetentionCandidate[]; protectedCount: number; total: number }> } {
	const protectedIds = protectedRevisionIds(db);
	const kinds: Array<{ kind: ArtifactKind; candidates: RetentionCandidate[]; protectedCount: number; total: number }> =
		[];
	for (const kind of KIND_ORDER) {
		// listRevisions is newest-first by revision_number (Phase 2).
		const revisions = listRevisions(db, kind).filter((r) => r.status !== "withdrawn");
		if (revisions.length === 0) continue;
		const candidates: RetentionCandidate[] = [];
		let protectedCount = 0;
		for (let i = 0; i < revisions.length; i++) {
			const r = revisions[i]!;
			if (i < keepN) continue; // inside the keep window
			if (protectedIds.has(r.revisionId)) {
				protectedCount += 1;
				continue;
			}
			candidates.push({ kind, revisionId: r.revisionId, revisionNumber: r.revisionNumber, runId: r.runId });
		}
		// Report order: ascending by revision_number (oldest deletion first).
		candidates.sort((a, b) => a.revisionNumber - b.revisionNumber);
		kinds.push({ kind, candidates, protectedCount, total: revisions.length });
	}
	return { kinds };
}

/**
 * Pure read — compute the retention plan for a project (N7). No DB writes.
 * Throws only when the files.json retention block is malformed (F's
 * retentionConfig contract — a typo must surface, not default).
 * @param {string} cwd - Project root.
 * @param {string} projectName - Project whose store to scan.
 * @returns {RetentionScan} The plan (`prunableCount: 0` when keep-forever or nothing beyond N).
 */
export function scanRetention(cwd: string, projectName: string): RetentionScan {
	const config = retentionConfig(cwd);
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath) || config.revisions === "all") {
		return { config, perKind: [], prunableCount: 0 };
	}
	const db = openStoreDb(dbPath);
	try {
		const plan = computePrunePlan(db, config.revisions);
		const perKind: RetentionScanKind[] = plan.kinds
			.filter((k) => k.total > 0)
			.map((k) => ({
				kind: k.kind,
				keep: config.revisions as number,
				total: k.total,
				prunable: k.candidates,
				protectedCount: k.protectedCount,
			}));
		const prunableCount = perKind.reduce((sum, k) => sum + k.prunable.length, 0);
		return { config, perKind, prunableCount };
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Prune ONE revision inside its own BEGIN IMMEDIATE transaction — the
 * withProtectionTxn ordering (flip → splice → delete → audit → tx → COMMIT
 * → best-effort checkpoint), plus a benign-skip path that rolls back
 * writing NO audit/tx entries (a skip is not a mutation). Throws on real
 * failures (the caller records the problem; the rollback tx entry is
 * written here, after the txn is dead — F18).
 *
 * Steps, in order:
 *   1. Head re-check (in-txn): never prune a live head.
 *   2. Status flip to 'withdrawn' (guarded) — the DELETE is guarded by it.
 *   3. Lineage splice (F21): the surviving successor re-attaches to the
 *      pruned row's own predecessor — BEFORE the delete, while the row
 *      (and its supersedes_revision_id) is still readable. Must precede
 *      the delete: artifact_revisions.supersedes_revision_id is a
 *      self-referencing FK, so deleting a chain node with a surviving
 *      successor would fail the constraint otherwise.
 *   4. Guarded DELETE of the withdrawn row (baselined references make this
 *      a hard FK error → rollback — the backstop).
 *   5. Audit entry (F17) + tx entry (F18), then COMMIT.
 */
function pruneOneRevision(
	db: DatabaseSync,
	params: {
		kind: ArtifactKind;
		revisionId: number;
		revisionNumber: number;
		runId: string;
		fingerprint: string;
		keepLastN: number;
		actor: string;
	},
): "pruned" | "skipped" {
	db.exec("BEGIN IMMEDIATE;");
	try {
		// (1) In-txn head re-check: a concurrent publish may have moved head
		// onto this revision after the plan was computed.
		if (readHeadRevisionId(db, params.runId, params.kind) === params.revisionId) {
			db.exec("ROLLBACK;");
			return "skipped";
		}
		// (2) Flip the status FIRST: the DELETE below is guarded by it, so a
		// concurrent re-flip can never be silently removed.
		const flipped = db
			.prepare("UPDATE artifact_revisions SET status = 'withdrawn' WHERE revision_id = ? AND status <> 'withdrawn'")
			.run(params.revisionId);
		if (Number(flipped.changes) === 0) {
			// Raced into withdrawn elsewhere — benign skip, no entries.
			db.exec("ROLLBACK;");
			return "skipped";
		}
		// (3) Splice the lineage gap BEFORE the delete (self-referencing FK):
		// the surviving successor re-attaches to the pruned row's own
		// predecessor. A pruned head would leave a dangling successor; the
		// head re-check above makes that impossible.
		db.prepare(
			"UPDATE artifact_revisions SET supersedes_revision_id = (SELECT supersedes_revision_id FROM artifact_revisions WHERE revision_id = ?) WHERE supersedes_revision_id = ?",
		).run(params.revisionId, params.revisionId);
		// (4) Guarded delete of the withdrawn row.
		const deleted = db
			.prepare("DELETE FROM artifact_revisions WHERE revision_id = ? AND status = 'withdrawn'")
			.run(params.revisionId);
		if (Number(deleted.changes) !== 1) {
			throw new Error(`retention: guarded delete removed ${deleted.changes} rows for revision ${params.revisionId}`);
		}
		// (5) Audit (F17) + tx (F18) inside the txn, then COMMIT.
		appendAuditEntry(db, {
			actor: params.actor,
			action: "retention-prune",
			artifactKind: params.kind,
			revisionNumber: params.revisionNumber,
			reason: `retention keep-last-${params.keepLastN}`,
			detail: { revisionId: params.revisionId, runId: params.runId, keepLastN: params.keepLastN },
		});
		appendTxEntry(db, {
			actor: params.actor,
			operation: "retention-prune",
			beforeDigest: params.fingerprint,
			afterDigest: params.fingerprint, // content bytes unchanged by a status flip
			outcome: "commit",
		});
		db.exec("COMMIT;");
		try {
			checkpointNow(db);
		} catch {
			// A failed checkpoint never invalidates the committed prune.
		}
		return "pruned";
	} catch (err) {
		try {
			db.exec("ROLLBACK;");
		} catch {
			// Txn already dead (the error itself aborted it).
		}
		try {
			// F18: record the failed mutation. Never mask the caller's error.
			appendTxEntry(db, { actor: params.actor, operation: "retention-prune", outcome: "rollback" });
		} catch {
			// Logging must never hide the original error.
		}
		throw err;
	}
}

/**
 * CONFIRMED prune — the command supplies the confirmation gate (N7: never
 * automatic). Recomputes the plan against LIVE rows, then prunes each
 * candidate in its own audited transaction. NEVER prunes the head revision
 * (re-checked in-txn) or any revision referenced by baselines (FK backstop:
 * a baselined reference makes the DELETE a hard FK error → rollback; the
 * scan also excludes baselined ids up front). One appendAuditEntry per
 * pruned revision (F17, action "retention-prune").
 *
 * Fix 2: when anything was pruned, the store DB is git-committed
 * immediately (explicit path, commitProtectionChange) — warnings surfaced,
 * never a failed prune.
 * @param {string} cwd - Project root.
 * @param {string} projectName - Project whose store to prune.
 * @param {string} [actor] - Audit actor (defaults to "velpari-retention-prune").
 * @returns {RetentionPruneResult} pruned count + problems + git warnings.
 */
export function pruneRetentions(
	cwd: string,
	projectName: string,
	actor: string = "velpari-retention-prune",
): RetentionPruneResult {
	const problems: string[] = [];
	const warnings: string[] = [];
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) {
		return { ok: false, pruned: 0, problems: [`no store DB for project "${projectName}" at ${dbPath}`], warnings };
	}
	const config = retentionConfig(cwd);
	if (config.revisions === "all") {
		return {
			ok: false,
			pruned: 0,
			problems: ['retention is keep-forever (velpari.retention.revisions: "all") — nothing to prune'],
			warnings,
		};
	}

	let pruned = 0;
	let failed = false;
	const db = openStoreDb(dbPath);
	try {
		const plan = computePrunePlan(db, config.revisions);
		for (const entry of plan.kinds) {
			for (const candidate of entry.candidates) {
				const identity = readRevisionIdentity(db, candidate.revisionId);
				if (!identity || identity.status === "withdrawn") continue; // raced/vanished — benign
				try {
					const outcome = pruneOneRevision(db, {
						kind: entry.kind,
						revisionId: candidate.revisionId,
						revisionNumber: candidate.revisionNumber,
						runId: candidate.runId,
						fingerprint: identity.sha256Fingerprint,
						keepLastN: config.revisions,
						actor,
					});
					if (outcome === "skipped") {
						problems.push(
							`skipped ${entry.kind} rev ${candidate.revisionNumber}: raced (head move or concurrent withdraw)`,
						);
					} else {
						pruned += 1;
					}
				} catch (err) {
					failed = true;
					problems.push(
						`prune of ${entry.kind} rev ${candidate.revisionNumber} rolled back: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}
		}
	} finally {
		closeStoreDb(db);
	}

	if (pruned > 0) {
		const commitWarnings = commitProtectionChange({
			cwd,
			projectName,
			paths: [dbPath],
			message: `velpari(retention): prune ${pruned} revision(s) beyond keep-last-${config.revisions} (${projectName})`,
		});
		warnings.push(...commitWarnings);
	}

	return { ok: !failed, pruned, problems, warnings };
}
