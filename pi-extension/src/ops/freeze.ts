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
//
// Phase I (plan subphase I2.1, N4 executor collapse): this file now owns ALL
// N4 executors — freezeAllForHandoff, applySingleKindFreeze, unfreezeArtifact
// and finalizeUnfreeze (+ their types). ops/protection.ts keeps only its
// tombstone/rollback layers and the read-only picker wrappers.
// ============================================================================

import {
	appendAuditEntry,
	appendTxEntry,
	checkpointNow,
	getHeadRevision,
	setFrozen,
	type ArtifactKind,
} from "../io/store.js";
import { closeStoreDb, openStoreDb } from "../io/db.js";
import { buildStoreDbPath } from "../core/paths.js";
import { loadFilesConfig } from "../core/config.js";
import { getEffectiveProjectNames } from "../core/projectnames.js";
import { commitProtectionChange, readFrozenState, withProtectionTxn } from "./protection.js";

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

/** Input for freezing ONE (run, kind) from the command surface. */
export interface SingleKindFreezeInput {
	cwd: string;
	dbPath: string;
	projectName: string;
	runId: string;
	kind: ArtifactKind;
	/** Optional for a freeze (N4 mandates it only for unfreeze). */
	reason: string;
	/** Audit actor; defaults to "velpari-freeze". */
	actor?: string;
}

/** Outcome of a single-kind freeze. */
export interface SingleKindFreezeOutcome {
	ok: boolean;
	message: string;
	warnings?: string[];
}

/**
 * Freeze ONE (run, kind): setFrozen(true) + audit + tx entry + checkpoint in one
 * transaction, then a local explicit-path commit (design rules 2/7). Idempotent —
 * re-freezing re-stamps the flag (and updates the reason). `freezeAllForHandoff`
 * stays the handoff path; this is the manual command path.
 * @returns {SingleKindFreezeOutcome} `{ok:false, message}` for refusals/errors.
 */
export function applySingleKindFreeze(input: SingleKindFreezeInput): SingleKindFreezeOutcome {
	const reason = input.reason.trim();
	const db = openStoreDb(input.dbPath);
	let wasFrozen = false;
	try {
		const before = readFrozenState(db, input.runId, input.kind);
		if (!before) {
			return { ok: false, message: `no artifact row for '${input.kind}' in run ${input.runId}` };
		}
		wasFrozen = before.frozen;
		withProtectionTxn(
			db,
			{
				actor: input.actor ?? "velpari-freeze",
				action: "freeze",
				artifactKind: input.kind,
				reason: reason === "" ? undefined : reason,
				detail: { runId: input.runId, wasFrozen },
			},
			() => {
				setFrozen(db, input.runId, input.kind, true, reason);
			},
		);
	} catch (err) {
		return { ok: false, message: `store: ${err instanceof Error ? err.message : String(err)}` };
	} finally {
		closeStoreDb(db);
	}

	const warnings = commitProtectionChange({
		cwd: input.cwd,
		projectName: input.projectName,
		paths: [input.dbPath],
		message: `velpari(freeze): ${input.projectName} ${input.kind} (run ${input.runId})`,
	});
	return {
		ok: true,
		message:
			`${wasFrozen ? "Re-frozen" : "Frozen"} ${input.kind} (run ${input.runId})${reason ? ` — ${reason}` : ""}. ` +
			"Publish, supersession and tombstones are refused until an explicit unfreeze.",
		warnings: warnings.length > 0 ? warnings : undefined,
	};
}

/**
 * Finish an unfreeze performed by `unfreezeArtifact` in this file: appends the
 * F18 tx entry, WAL-checkpoints and commits the store DB locally (design rules
 * 2/7 — the executor writes the audit row, which stays the canonical N4
 * record). Call ONLY after `unfreezeArtifact` returned ok.
 * Never throws (Phase I10.2): any audit append / checkpoint / commit failure
 * is returned as a warning — the unfreeze itself already stands.
 * @returns {string[]} Commit warnings (never throws — a failure becomes one warning).
 */
export function finalizeUnfreeze(params: {
	cwd: string;
	dbPath: string;
	projectName: string;
	runId: string;
	kind: ArtifactKind;
	reason: string;
	actor?: string;
}): string[] {
	try {
		const db = openStoreDb(params.dbPath);
		try {
			appendTxEntry(db, {
				actor: params.actor ?? "velpari-freeze",
				operation: "unfreeze",
				outcome: "commit",
			});
			checkpointNow(db);
		} finally {
			closeStoreDb(db);
		}
		// commitProtectionChange is inside the same guard: it is
		// warning-based today, but catching here makes "never throws"
		// structural rather than a property of its current body.
		return commitProtectionChange({
			cwd: params.cwd,
			projectName: params.projectName,
			paths: [params.dbPath],
			message: `velpari(unfreeze): ${params.projectName} ${params.kind} (run ${params.runId})`,
		});
	} catch (err) {
		return [
			`unfreeze audit/commit skipped: ${err instanceof Error ? err.message : String(err)} — the ` +
				"unfreeze itself stands (N4); retry the audit append + commit manually.",
		];
	}
}
