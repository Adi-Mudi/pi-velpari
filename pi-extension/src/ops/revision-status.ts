// ============================================================================
// ops/revision-status.ts — revision status view + restore (Layer 1, v1.2 B6)
// ============================================================================
// Phase-G finding resolution (confirmed against the shipped protection
// contract 2026-09-29): `setRevisionStatus` is the ONLY status writer and it
// hard-refuses `to: "superseded"` (system-owned — a new publish flips the old
// head automatically) and any change on a `superseded` row. The reachable
// transition is therefore withdrawn → published (restore), and that is exactly
// what this wrapper performs; withdrawal stays on /velpari-tombstone
// (ops/tombstone.ts:applyTombstone).
//
// Scope guard: L1, UI-free (pickers/reason/confirm live in
// commands/revision-status.ts). Audit: inside setRevisionStatus's
// withProtectionTxn ("status-update"; content never changes — N20 digests are
// equal on purpose); this wrapper only adds the explicit-path local git commit.
// ============================================================================

import { closeStoreDb, openStoreDb } from "../io/db.js";
import type { ArtifactKind } from "../io/store.js";
import { commitProtectionChange, readRevisionIdentity, setRevisionStatus } from "./protection.js";

/** Input for one restore action (paths pre-resolved by the command). */
export interface RevisionStatusInput {
	cwd: string;
	dbPath: string;
	projectName: string;
	kind: ArtifactKind;
	revisionId: number;
	/** Mandatory audit reason (setRevisionStatus refuses an empty one). */
	reason: string;
	/** Audit actor; defaults to "velpari-revision-status". */
	actor?: string;
}

/** Outcome of a restore action (business refusals are returned, not thrown). */
export interface RevisionStatusOutcome {
	ok: boolean;
	message: string;
	warnings?: string[];
}

/**
 * Restore one withdrawn revision to published (the reachable transition of
 * the protection contract): `setRevisionStatus` (audited + head rule), then a
 * local explicit-path git commit. No other status is written — `superseded`
 * stays system-owned (read the header).
 * @param {RevisionStatusInput} input - Action input (projectName/dbPath/kind/revisionId/reason).
 * @returns {RevisionStatusOutcome} `{ok:false, message}` for refusals/errors.
 */
export function applyRevisionStatus(input: RevisionStatusInput): RevisionStatusOutcome {
	const reason = input.reason.trim();
	if (reason === "") {
		return { ok: false, message: "A status change requires a typed reason." };
	}
	const db = openStoreDb(input.dbPath);
	let revisionNumber = 0;
	let runId = "";
	try {
		const identity = readRevisionIdentity(db, input.revisionId);
		if (identity) {
			revisionNumber = identity.revisionNumber;
			runId = identity.runId;
		}
		const outcome = setRevisionStatus(db, {
			kind: input.kind,
			revisionId: input.revisionId,
			to: "published",
			reason,
			actor: input.actor ?? "velpari-revision-status",
		});
		if (!outcome.ok) return { ok: false, message: outcome.problem };
		revisionNumber = outcome.revisionNumber;
	} catch (err) {
		return { ok: false, message: `store: ${err instanceof Error ? err.message : String(err)}` };
	} finally {
		closeStoreDb(db);
	}

	const warnings = commitProtectionChange({
		cwd: input.cwd,
		projectName: input.projectName,
		paths: [input.dbPath],
		message: `velpari(revision-status): ${input.projectName} ${input.kind} v${revisionNumber} → published (run ${runId})`,
	});
	return {
		ok: true,
		message: `Revision v${revisionNumber} of ${input.kind} restored to published (withdrawn → published).`,
		warnings: warnings.length > 0 ? warnings : undefined,
	};
}
