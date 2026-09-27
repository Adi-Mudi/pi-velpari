// ============================================================================
// ops/freeze.ts — freeze-at-handoff + unfreeze executor (N4, Phase 1) — L1
// ============================================================================
// N4: handoff freezes the chain — every kind of this run with a published
// head becomes frozen, which blocks even supersession (FrozenArtifactError
// at the CAS door). Unfreezing requires a typed reason + audit event.
//
// Phase 1 ships the EXECUTORS only: there is deliberately NO command
// registration in this file (commands/index.ts is Phase-I-owned). The
// unfreeze command surface is integration request #1 to Phase I.
// ============================================================================

import { appendAuditEntry, getHeadRevision, setFrozen, type ArtifactKind } from "../io/store.js";
import { openStoreDb } from "../io/db.js";
import { buildStoreDbPath } from "../core/paths.js";
import { loadFilesConfig } from "../core/config.js";
import { getEffectiveProjectNames } from "../core/projectnames.js";

/** The reason stamped on every handoff freeze (visible in the audit trail). */
export const HANDOFF_FREEZE_REASON = "handoff (N4)";

/**
 * The 9 store kinds (mirror of ops/stage-payloads.ts KIND_BY_WORKING_DIR
 * values). One home for the freeze helpers; handoff and Phase I reuse it.
 */
export const VELPARI_STORE_KINDS: readonly ArtifactKind[] = [
	"prd",
	"rtm",
	"feasibility",
	"design",
	"atomic-functions",
	"pseudocode",
	"testplan",
	"development-order",
	"final-design",
];

export interface FreezeOutcome {
	ok: boolean;
	problems: string[];
	/** Number of artifact kinds actually frozen (summed across projects). */
	frozen: number;
}

/**
 * Freeze the chain at handoff (N4). MULTI-DESIGN (review GAP 1): resolves
 * the project list via getEffectiveProjectNames and freezes EVERY project's
 * store — one DB per project, freezing only the primary name would leave a
 * second design's chain unfrozen. For every project x kind with a published
 * head: setFrozen(true) + one audit entry. Idempotent — freezing an already
 * frozen kind re-stamps nothing harmful (setFrozen is a status-only UPDATE).
 *
 * Nothing thrown: failures are collected in problems and ok=false (the
 * handoff flow refuses to advance on a failed freeze).
 *
 * @param {string} cwd - Project root.
 * @param {string} projectName - Fallback/primary name (used when files.json
 *   is missing or unconfigured — the caller's resolved name).
 * @param {string} runId - Owning run (heads live on the run's rows).
 * @returns {FreezeOutcome} ok + problems + frozen count.
 */
export function freezeAllForHandoff(cwd: string, projectName: string, runId: string): FreezeOutcome {
	const problems: string[] = [];
	let frozen = 0;
	let projects: string[] = [projectName];
	try {
		const cfg = loadFilesConfig(cwd);
		projects = getEffectiveProjectNames(cfg);
	} catch {
		// Unconfigured / malformed files.json → fall back to the caller's name.
	}
	for (const pn of projects) {
		let db: ReturnType<typeof openStoreDb> | null = null;
		try {
			db = openStoreDb(buildStoreDbPath(pn, cwd));
			for (const kind of VELPARI_STORE_KINDS) {
				const head = getHeadRevision(db, runId, kind);
				if (!head) continue; // nothing published for this kind — nothing to freeze
				setFrozen(db, runId, kind, true, HANDOFF_FREEZE_REASON);
				appendAuditEntry(db, {
					actor: `velpari:handoff:${runId}`,
					action: "freeze",
					artifactKind: kind,
					reason: HANDOFF_FREEZE_REASON,
					detail: { runId, projectName: pn, revisionId: head.revisionId },
				});
				frozen++;
			}
		} catch (err) {
			problems.push(`freeze failed for project "${pn}": ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			if (db) {
				try {
					db.close();
				} catch {
					// best-effort close
				}
			}
		}
	}
	return { ok: problems.length === 0, problems, frozen };
}

/**
 * Unfreeze one artifact kind (N4) — the typed-reason escape hatch. Reason is
 * REQUIRED and non-empty (mirrors io/store.ts setFrozen's guard); the action
 * is audited with the reason verbatim. Exported for Phase I to wire into the
 * unfreeze command surface (integration request #1) — no command here.
 *
 * @param {string} cwd - Project root.
 * @param {string} projectName - Store DB selector (single project).
 * @param {string} runId - Owning run.
 * @param {ArtifactKind} kind - Kind to unfreeze.
 * @param {string} reason - Why the freeze is lifted (audited).
 * @returns {object} ok + problems (empty reason → refused with a problem).
 */
export function unfreezeArtifact(
	cwd: string,
	projectName: string,
	runId: string,
	kind: ArtifactKind,
	reason: string,
): { ok: boolean; problems: string[] } {
	const problems: string[] = [];
	if (reason.trim() === "") {
		problems.push("unfreeze requires a non-empty reason (N4) — the audit trail must say why the lock was lifted.");
		return { ok: false, problems };
	}
	let db: ReturnType<typeof openStoreDb> | null = null;
	try {
		db = openStoreDb(buildStoreDbPath(projectName, cwd));
		setFrozen(db, runId, kind, false, reason);
		appendAuditEntry(db, {
			actor: `velpari:unfreeze:${kind}:${runId}`,
			action: "unfreeze",
			artifactKind: kind,
			reason,
			detail: { runId },
		});
	} catch (err) {
		problems.push(`unfreeze failed for ${kind}: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		if (db) {
			try {
				db.close();
			} catch {
				// best-effort close
			}
		}
	}
	return { ok: problems.length === 0, problems };
}
