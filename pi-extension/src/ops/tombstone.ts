// ============================================================================
// ops/tombstone.ts — F16 delete-as-modification (Layer 1, Phase 2)
// ============================================================================
// Decision record: .IDE_Plans/velpari-versioning-locking-recovery_discussion_*_v1.0.md
//   F16 — deletion is a TRACKED MODIFICATION, never a removal. Published bytes
//         stay in `artifact_revisions` forever; a tombstone flips the status.
//   F12 — an agent delete attempt must never dead-end: the store guard returns
//         `deleteAttemptGuidance()` (the guided correction).
//   F21 — recovery is forward-only: /velpari-rollback publishes a NEW revision.
//   F24 — the store change is committed locally, explicit paths only.
//
// Scope guard: L1, UI-free (pick, reason gate and the two confirms live in
// commands/tombstone.ts). No DELETE statement anywhere — the row write is
// delegated to ops/protection.ts:withdrawRevision.
// ============================================================================

import { closeStoreDb, openStoreDb } from "../io/db.js";
import type { ArtifactKind } from "../io/store.js";
import { commitProtectionChange, readRevisionIdentity, withdrawRevision } from "./protection.js";

/** Input for one tombstone action (paths pre-resolved by the command). */
export interface TombstoneInput {
	cwd: string;
	dbPath: string;
	projectName: string;
	kind: ArtifactKind;
	revisionId: number;
	/** MANDATORY (F16) — the audit trail must say why the revision was retracted. */
	reason: string;
	/** Audit actor; defaults to "velpari-tombstone". */
	actor?: string;
}

/** Outcome of a tombstone action (business refusals are returned, not thrown). */
export interface TombstoneOutcome {
	ok: boolean;
	message: string;
	warnings?: string[];
}

/**
 * Tombstone one published/superseded revision: withdraw + audit + tx (single
 * transaction, ops/protection.ts), then a local explicit-path git commit.
 * @param {TombstoneInput} input - Action input (projectName/dbPath/kind/revisionId/reason).
 * @returns {TombstoneOutcome} `{ok:false, message}` for refusals/errors.
 */
export function applyTombstone(input: TombstoneInput): TombstoneOutcome {
	const reason = input.reason.trim();
	if (reason === "") {
		return { ok: false, message: "Tombstone requires a typed reason (F16)." };
	}
	const db = openStoreDb(input.dbPath);
	let revisionNumber = 0;
	let runId = "";
	let wasHead = false;
	let newHeadRevisionId: number | null = null;
	try {
		const identity = readRevisionIdentity(db, input.revisionId);
		if (identity) {
			revisionNumber = identity.revisionNumber;
			runId = identity.runId;
		}
		const outcome = withdrawRevision(db, {
			kind: input.kind,
			revisionId: input.revisionId,
			reason,
			actor: input.actor ?? "velpari-tombstone",
		});
		if (!outcome.ok) return { ok: false, message: outcome.problem };
		revisionNumber = outcome.revisionNumber;
		wasHead = outcome.wasHead;
		newHeadRevisionId = outcome.newHeadRevisionId;
	} catch (err) {
		return { ok: false, message: `store: ${err instanceof Error ? err.message : String(err)}` };
	} finally {
		closeStoreDb(db);
	}

	const warnings = commitProtectionChange({
		cwd: input.cwd,
		projectName: input.projectName,
		paths: [input.dbPath],
		message: `velpari(tombstone): ${input.projectName} ${input.kind} v${revisionNumber} (run ${runId})`,
	});
	const headNote = wasHead
		? ` Head re-pointed to ${newHeadRevisionId === null ? "none (no live revision left)" : `revision ${newHeadRevisionId}`}.`
		: "";
	return {
		ok: true,
		message:
			`Revision v${revisionNumber} of ${input.kind} tombstoned (status=withdrawn, bytes kept).${headNote} ` +
			"History is never rewritten — correct forward with /velpari-rollback.",
		warnings: warnings.length > 0 ? warnings : undefined,
	};
}

/**
 * The guided correction for a blocked delete/remove attempt (F12 self-healing,
 * same spirit as the transition lock): what was blocked, why, and the exact
 * legitimate paths. Used by the store-scope guard in hooks/tool-call.ts.
 * @param {string} target - The path/command that was blocked.
 * @returns {string} Multi-line guidance shown to the caller.
 */
export function deleteAttemptGuidance(target: string): string {
	return [
		`Locked: ${target} is inside Doc/store/ — the project's DB-primary source of truth.`,
		"Published revisions are immutable (F16): a delete is never a removal here.",
		"Use one of these instead:",
		"  • /velpari-tombstone — retract a published revision with a reason (tracked + audited)",
		"  • /velpari-rollback  — publish a NEW revision carrying an older revision's content",
		"  • /velpari-export    — download a published version as md / yaml / html",
		"The store is written only by Velpari code paths (publish tool, backfill, reconfirm, export); " +
			"checksums and the doctor's integrity audits are the backstop.",
	].join("\n");
}
