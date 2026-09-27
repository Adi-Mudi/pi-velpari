// ============================================================================
// ops/protection.ts — protection store layer (Layer 1, Phase 2, 2026-09-27)
// ============================================================================
// Decision record: .IDE_Plans/velpari-versioning-locking-recovery_discussion_*_v1.0.md
//   F16 — deletion is a tracked modification (tombstone), never a removal.
//   N4  — freeze is the handoff lock: a frozen artifact must not change at all
//         until an explicit unfreeze. D5 (phase-2 review) — tombstones included.
//   F17/F18/N15 — every protection action appends an audit-ledger entry + a
//         tx-log entry INSIDE the same BEGIN IMMEDIATE transaction, so the
//         per-table hash chains stay verifiable (core/hashchain.ts).
//
// Scope guard (Phase 2 plan §3):
//   * L1 only and UI-free — every picker/confirm lives in commands/ (rule 8).
//   * No state.json reads: the run is resolved from the store (rule 11).
//   * NO DELETE statement in this file — only /velpari-db-reset removes rows,
//     and only draft envelopes (io/store.ts:deleteRunDrafts).
//   * F-owned files (io/store.ts, core/db-schema.ts) stay untouched: the raw
//     SQL below covers exactly what the F primitives do not expose (revision
//     status, head re-point, frozen read, run lookups).
//
// Deviation note (recorded in the plan status): ProtectionAudit carries
// optional beforeDigest/afterDigest so F18's "before/after digests" is
// satisfied for status-only actions (the unchanged revision fingerprint),
// which the plan's draft signature did not spell out.
// ============================================================================

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { buildStoreDbPath } from "../core/paths.js";
import { closeStoreDb, openStoreDb } from "../io/db.js";
import {
	appendAuditEntry,
	appendTxEntry,
	checkpointNow,
	KIND_ORDER,
	setFrozen,
	type ArtifactKind,
} from "../io/store.js";
import { precheckGitForPublish } from "./db-publish.js";

/** Revision lifecycle status (v004 CHECK constraint, F7/F9). */
export type RevisionStatus = "published" | "superseded" | "withdrawn";

/** One revision row for the protection pickers + tests (camelCase, no UI). */
export interface RevisionRef {
	revisionId: number;
	revisionNumber: number;
	status: RevisionStatus;
	runId: string;
	version: number;
	stage: string;
	generatedAt: string;
	publishedAt: string;
	sha256Fingerprint: string;
	/** Reason recorded by the newest tombstone audit entry, when one exists (F16). */
	tombstoneReason: string | null;
}

/** Frozen state of one (run, kind) — null when no artifact row exists. */
export interface FrozenState {
	frozen: boolean;
	reason: string | null;
}

/** Identity fields of one revision row (camelCase read for the protection ops). */
export interface RevisionIdentity {
	revisionId: number;
	kind: string;
	runId: string;
	revisionNumber: number;
	status: RevisionStatus;
	sha256Fingerprint: string;
}

/** Full immutable snapshot of one revision row (F6) — the rollback source. */
export interface RevisionSnapshot {
	revisionId: number;
	kind: string;
	runId: string;
	revisionNumber: number;
	status: RevisionStatus;
	version: number;
	stage: string;
	generatedAt: string;
	inputs: string;
	reviewerVerdict: string | null;
	changeLog: string;
	yamlBytes: string;
	sha256Fingerprint: string;
}

/** Parameters of one audited protection transaction (F17 who/what/when/why). */
export interface ProtectionAudit {
	actor: string;
	action: string;
	artifactKind: ArtifactKind;
	revisionNumber?: number;
	reason?: string;
	detail?: Record<string, unknown>;
	/** Optional content digests for the tx entry (F18). */
	beforeDigest?: string;
	afterDigest?: string;
}

/** F16 tombstone outcome — never a throw for a business refusal. */
export type WithdrawOutcome =
	| { ok: true; revisionNumber: number; wasHead: boolean; newHeadRevisionId: number | null }
	| { ok: false; problem: string };

// ---------------------------------------------------------------------------
// Reads (read-only: no txn, no audit — safe for pickers and tests)
// ---------------------------------------------------------------------------

/** Narrow an `artifact_revisions.status` value to the v004 union. */
function narrowStatus(value: unknown): RevisionStatus {
	if (value === "published" || value === "superseded" || value === "withdrawn") return value;
	throw new Error(`protection: unknown revision status '${String(value)}' (schema drift?)`);
}

/** Newest tombstone reason per revision number for one kind (one query, no N+1). */
function tombstoneReasons(db: DatabaseSync, kind: ArtifactKind): Map<number, string> {
	const rows = db
		.prepare(
			`SELECT revision_number, reason FROM audit_ledger
			 WHERE action = 'tombstone' AND artifact_kind = ? AND revision_number IS NOT NULL
			 ORDER BY entry_id DESC`,
		)
		.all(kind) as { revision_number: number; reason: string | null }[];
	const map = new Map<number, string>();
	for (const row of rows) {
		const n = Number(row.revision_number);
		if (!map.has(n) && typeof row.reason === "string") map.set(n, row.reason);
	}
	return map;
}

/**
 * Revisions of one kind, newest first (F6/F10 snapshot table).
 * @param {DatabaseSync} db - Open store connection.
 * @param {ArtifactKind} kind - Artifact kind to list.
 * @returns {RevisionRef[]} Newest first (revision_number DESC).
 */
export function listRevisions(db: DatabaseSync, kind: ArtifactKind): RevisionRef[] {
	const rows = db
		.prepare(
			`SELECT revision_id, revision_number, status, run_id, version, stage,
			        generated_at, published_at, sha256_fingerprint
			 FROM artifact_revisions WHERE kind = ? ORDER BY revision_number DESC`,
		)
		.all(kind) as Record<string, unknown>[];
	const reasons = tombstoneReasons(db, kind);
	return rows.map((row) => {
		const revisionNumber = Number(row.revision_number);
		return {
			revisionId: Number(row.revision_id),
			revisionNumber,
			status: narrowStatus(row.status),
			runId: String(row.run_id),
			version: Number(row.version),
			stage: String(row.stage),
			generatedAt: String(row.generated_at),
			publishedAt: String(row.published_at),
			sha256Fingerprint: String(row.sha256_fingerprint),
			tombstoneReason: reasons.get(revisionNumber) ?? null,
		};
	});
}

/**
 * Identity of one revision row (kind/run/number/status/fingerprint) — null when
 * the revision id does not exist. Used by the tombstone op for its audit
 * detail + commit message without a second SQL dialect.
 * @returns {RevisionIdentity | null}
 */
export function readRevisionIdentity(db: DatabaseSync, revisionId: number): RevisionIdentity | null {
	const row = db
		.prepare(
			"SELECT revision_id, kind, run_id, revision_number, status, sha256_fingerprint FROM artifact_revisions WHERE revision_id = ?",
		)
		.get(revisionId) as
		| {
				revision_id: number;
				kind: string;
				run_id: string;
				revision_number: number;
				status: unknown;
				sha256_fingerprint: string;
		  }
		| undefined;
	if (!row) return null;
	return {
		revisionId: Number(row.revision_id),
		kind: String(row.kind),
		runId: String(row.run_id),
		revisionNumber: Number(row.revision_number),
		status: narrowStatus(row.status),
		sha256Fingerprint: String(row.sha256_fingerprint),
	};
}

/**
 * Frozen flag + reason for one (run, kind). F owns the columns; this is the
 * read the F API does not expose (readEnvelope is module-private).
 * @returns {FrozenState | null} null when no artifact row exists for that pair.
 */
export function readFrozenState(db: DatabaseSync, runId: string, kind: ArtifactKind): FrozenState | null {
	const row = db
		.prepare("SELECT frozen, freeze_reason FROM artifacts WHERE run_id = ? AND kind = ?")
		.get(runId, kind) as { frozen: number; freeze_reason: string | null } | undefined;
	if (!row) return null;
	return { frozen: Number(row.frozen) === 1, reason: row.freeze_reason ?? null };
}

/**
 * Draft envelope count for one run (read-only; the /velpari-db-reset confirm text).
 * @returns {number} Draft envelope count (0 when the run has none).
 */
export function countRunDrafts(db: DatabaseSync, runId: string): number {
	const row = db.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE run_id = ? AND status = 'draft'").get(runId) as
		| { n: number }
		| undefined;
	return Number(row?.n ?? 0);
}

/**
 * Runs holding an artifact row for one kind, newest first (design rule 11 —
 * freeze resolves its run from the store, never only from state.json).
 * @returns {string[]} Run ids, newest `generated_at` first.
 */
export function listArtifactRuns(db: DatabaseSync, kind: ArtifactKind): string[] {
	const rows = db
		.prepare(
			`SELECT run_id, MAX(generated_at) AS newest FROM artifacts
			 WHERE kind = ? GROUP BY run_id ORDER BY newest DESC, run_id ASC`,
		)
		.all(kind) as { run_id: string; newest: string }[];
	return rows.map((row) => String(row.run_id));
}

/**
 * Runs holding DRAFT rows + their counts (GAP 1 — the /velpari-db-reset run
 * picker, so drafts left behind by a reset stay cleanable).
 * @returns {{ runId: string; drafts: number }[]} Stable order (run_id ASC).
 */
export function listDraftRuns(db: DatabaseSync): { runId: string; drafts: number }[] {
	const rows = db
		.prepare("SELECT run_id, COUNT(*) AS n FROM artifacts WHERE status = 'draft' GROUP BY run_id ORDER BY run_id ASC")
		.all() as { run_id: string; n: number }[];
	return rows.map((row) => ({ runId: String(row.run_id), drafts: Number(row.n) }));
}

/**
 * Full snapshot of one revision row (F6 immutable bytes + envelope fields) —
 * what a rollback needs to rebuild the content as a NEW revision. Null when the
 * revision id does not exist.
 * @returns {RevisionSnapshot | null}
 */
export function readRevisionSnapshot(db: DatabaseSync, revisionId: number): RevisionSnapshot | null {
	const row = db
		.prepare(
			`SELECT revision_id, kind, run_id, revision_number, status, version, stage, generated_at,
			        inputs, reviewer_verdict, change_log, yaml_bytes, sha256_fingerprint
			 FROM artifact_revisions WHERE revision_id = ?`,
		)
		.get(revisionId) as Record<string, unknown> | undefined;
	if (!row) return null;
	return {
		revisionId: Number(row.revision_id),
		kind: String(row.kind),
		runId: String(row.run_id),
		revisionNumber: Number(row.revision_number),
		status: narrowStatus(row.status),
		version: Number(row.version),
		stage: String(row.stage),
		generatedAt: String(row.generated_at),
		inputs: String(row.inputs),
		reviewerVerdict:
			row.reviewer_verdict === null || row.reviewer_verdict === undefined ? null : String(row.reviewer_verdict),
		changeLog: String(row.change_log),
		yamlBytes: String(row.yaml_bytes),
		sha256Fingerprint: String(row.sha256_fingerprint),
	};
}

/** One kind + its revisions, newest first (the protection pickers' menu). */
export interface KindRevisions {
	kind: ArtifactKind;
	revisions: RevisionRef[];
}

/**
 * Every kind's revision list for one project store, newest-first per kind.
 * Read-only; kinds without revisions are omitted so a picker never offers a
 * dead end. Used by /velpari-tombstone and /velpari-rollback.
 * @returns {KindRevisions[]} KIND_ORDER order; [] when the store DB is absent.
 */
export function revisionsByKind(cwd: string, projectName: string): KindRevisions[] {
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) return [];
	const db = openStoreDb(dbPath);
	try {
		const out: KindRevisions[] = [];
		for (const kind of listStoreKinds(db)) {
			const revisions = listRevisions(db, kind);
			if (revisions.length > 0) out.push({ kind, revisions });
		}
		return out;
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Kinds with at least one artifact row in the store, in canonical order
 * (the freeze kind picker — run-independent, so it works before a run is
 * chosen; Phase 5's listExportableKinds filters to published instead).
 * @returns {ArtifactKind[]} Kinds in KIND_ORDER (never SQL order).
 */
export function listStoreKinds(db: DatabaseSync): ArtifactKind[] {
	const rows = db.prepare("SELECT DISTINCT kind FROM artifacts").all() as { kind: string }[];
	const present = new Set(rows.map((row) => String(row.kind)));
	return KIND_ORDER.filter((kind) => present.has(kind));
}

/**
 * Kinds with an artifact row for one run (the freeze run/kind pairing).
 * @returns {ArtifactKind[]} Kinds in KIND_ORDER.
 */
export function listRunKinds(db: DatabaseSync, runId: string): ArtifactKind[] {
	const rows = db.prepare("SELECT DISTINCT kind FROM artifacts WHERE run_id = ?").all(runId) as { kind: string }[];
	const present = new Set(rows.map((row) => String(row.kind)));
	return KIND_ORDER.filter((kind) => present.has(kind));
}

/**
 * Commit the store files a protection action changed — explicit paths only
 * (F24: local commits, never a push). NEVER throws and never turns the action
 * into a failure: the DB rows are already committed, so a git problem is
 * reported as a warning with the manual retry (design rule 7).
 * @param {{cwd: string; projectName: string; paths: string[]; message: string}} params - Git inputs.
 * @returns {string[]} Warnings (empty = nothing to report).
 */
export function commitProtectionChange(params: {
	cwd: string;
	projectName: string;
	paths: string[];
	message: string;
}): string[] {
	const warnings: string[] = [];
	const precheck = precheckGitForPublish(params.cwd);
	if (!precheck.ok) return [`git commit skipped: ${precheck.problems.join(" ")}`];
	const targets = params.paths.filter((p) => existsSync(p));
	if (targets.length === 0) return warnings;

	const add = spawnSync("git", ["add", "--", ...targets], { cwd: params.cwd, encoding: "utf-8" });
	if (add.error || add.status !== 0) {
		warnings.push(`git add failed: ${(add.stderr ?? add.error?.message ?? "unknown").trim()}`);
		return warnings;
	}
	const commit = spawnSync("git", ["commit", "-m", params.message, "--", ...targets], {
		cwd: params.cwd,
		encoding: "utf-8",
	});
	if (commit.error || commit.status !== 0) {
		const detail = (commit.stderr ?? commit.error?.message ?? "").trim() || "no changes staged";
		warnings.push(
			`git commit failed: ${detail} — the store rows are already committed; retry with ` +
				`'git add -- ${targets.join(" ")}' + 'git commit'.`,
		);
	}
	return warnings;
}

// ---------------------------------------------------------------------------
// Write helper — ONE audited transaction per protection action (F17/F18/N15)
// ---------------------------------------------------------------------------

/** WAL maintenance after a committed protection write — best-effort (G1). */
function checkpointNowBestEffort(db: DatabaseSync): void {
	try {
		checkpointNow(db);
	} catch {
		// A failed checkpoint never invalidates the committed rows.
	}
}

/**
 * Run `fn` inside ONE `BEGIN IMMEDIATE` transaction, then append the audit +
 * tx entries and commit; on error roll back, record the rollback tx entry
 * (best-effort, outside the dead transaction) and rethrow the original error.
 * The ordering mirrors io/store.ts:publishArtifactCas so both chain tables stay
 * verifiable with core/hashchain.ts:verifyChain.
 * @param {DatabaseSync} db - Open store connection.
 * @param {ProtectionAudit} params - Who / what / why (+ optional digests).
 * @param {() => T} fn - The mutation body. Must not open its own transaction.
 * @returns {T} Whatever `fn` returned.
 */
export function withProtectionTxn<T>(db: DatabaseSync, params: ProtectionAudit, fn: () => T): T {
	db.exec("BEGIN IMMEDIATE;");
	try {
		const value = fn();
		appendAuditEntry(db, {
			actor: params.actor,
			action: params.action,
			artifactKind: params.artifactKind,
			revisionNumber: params.revisionNumber,
			reason: params.reason,
			detail: params.detail,
		});
		appendTxEntry(db, {
			actor: params.actor,
			operation: params.action,
			beforeDigest: params.beforeDigest,
			afterDigest: params.afterDigest,
			outcome: "commit",
		});
		db.exec("COMMIT;");
		checkpointNowBestEffort(db);
		return value;
	} catch (err) {
		try {
			db.exec("ROLLBACK;");
		} catch {
			// Txn already closed — the original error is the one that matters.
		}
		try {
			// F18: record the failed mutation. Never mask the caller's error.
			appendTxEntry(db, { actor: params.actor, operation: params.action, outcome: "rollback" });
		} catch {
			// Logging must never hide the caller's error.
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Head helpers (F10 head pointer — raw SQL the F API does not expose)
// ---------------------------------------------------------------------------

/** Current `artifacts.head_revision_id` for one (run, kind) — null when unset/absent. */
export function readHeadRevisionId(db: DatabaseSync, runId: string, kind: ArtifactKind): number | null {
	const row = db.prepare("SELECT head_revision_id FROM artifacts WHERE run_id = ? AND kind = ?").get(runId, kind) as
		| { head_revision_id: number | null }
		| undefined;
	if (!row || row.head_revision_id === null || row.head_revision_id === undefined) return null;
	return Number(row.head_revision_id);
}

/** Newest non-withdrawn revision id for (run, kind), excluding one id (head re-point). */
function newestLiveRevisionId(db: DatabaseSync, runId: string, kind: ArtifactKind, exclude: number): number | null {
	const row = db
		.prepare(
			`SELECT revision_id FROM artifact_revisions
			 WHERE kind = ? AND run_id = ? AND status <> 'withdrawn' AND revision_id <> ?
			 ORDER BY revision_number DESC LIMIT 1`,
		)
		.get(kind, runId, exclude) as { revision_id: number } | undefined;
	return row === undefined ? null : Number(row.revision_id);
}

// ---------------------------------------------------------------------------
// F16 tombstone — delete-as-modification (status-only, bytes never removed)
// ---------------------------------------------------------------------------

/**
 * Tombstone one revision: flip its status to 'withdrawn' (the v004 snapshot
 * bytes stay in `artifact_revisions` forever), re-point the head when the
 * tombstoned revision was the head, and audit the action with its reason.
 *
 * Refusals are RETURNED, never thrown: unknown revision, kind mismatch, already
 * tombstoned, and a FROZEN artifact (D5/N4 — unfreeze first). The only throws
 * are a programming error (empty reason) and a concurrent status/head change
 * detected inside the transaction (the txn rolls back; tx_log records it).
 *
 * @param {DatabaseSync} db - Open store connection.
 * @param {{kind: ArtifactKind; revisionId: number; reason: string; actor: string}} params - Action input.
 * @returns {WithdrawOutcome} `{ok:false, problem}` for business refusals.
 */
export function withdrawRevision(
	db: DatabaseSync,
	params: { kind: ArtifactKind; revisionId: number; reason: string; actor: string },
): WithdrawOutcome {
	const reason = params.reason.trim();
	if (reason === "") {
		throw new Error("protection: tombstoning requires a non-empty reason (F16)");
	}
	const row = readRevisionIdentity(db, params.revisionId);
	if (!row) return { ok: false, problem: `no revision with id ${params.revisionId}` };
	if (row.kind !== params.kind) {
		return { ok: false, problem: `revision ${params.revisionId} belongs to '${row.kind}', not '${params.kind}'` };
	}
	const revisionNumber = row.revisionNumber;
	if (row.status === "withdrawn") {
		return { ok: false, problem: `revision v${revisionNumber} is already tombstoned` };
	}
	const frozen = readFrozenState(db, row.runId, params.kind);
	if (frozen?.frozen === true) {
		return {
			ok: false,
			problem:
				`artifact '${params.kind}' is frozen${frozen.reason ? ` — ${frozen.reason}` : ""} — ` +
				"unfreeze with /velpari-freeze (typed reason) before tombstoning (N4).",
		};
	}

	const headBefore = readHeadRevisionId(db, row.runId, params.kind);
	const wasHead = headBefore === params.revisionId;
	const newHead = wasHead ? newestLiveRevisionId(db, row.runId, params.kind, params.revisionId) : headBefore;

	return withProtectionTxn(
		db,
		{
			actor: params.actor,
			action: "tombstone",
			artifactKind: params.kind,
			revisionNumber,
			reason,
			beforeDigest: row.sha256Fingerprint,
			afterDigest: row.sha256Fingerprint, // status-only: bytes never change (F9)
			detail: { revisionId: params.revisionId, wasHead, newHeadRevisionId: newHead },
		},
		() => {
			const updated = db
				.prepare("UPDATE artifact_revisions SET status = 'withdrawn' WHERE revision_id = ? AND status <> 'withdrawn'")
				.run(params.revisionId);
			if (Number(updated.changes) === 0) {
				throw new Error(`protection: revision ${params.revisionId} changed status during the tombstone`);
			}
			if (wasHead) {
				const moved = db
					.prepare("UPDATE artifacts SET head_revision_id = ? WHERE run_id = ? AND kind = ? AND head_revision_id = ?")
					.run(newHead, row.runId, params.kind, params.revisionId);
				if (Number(moved.changes) === 0) {
					throw new Error(`protection: head moved during the tombstone of revision ${params.revisionId}`);
				}
			}
			return { ok: true as const, revisionNumber, wasHead, newHeadRevisionId: newHead };
		},
	);
}

// ---------------------------------------------------------------------------
// Freeze / unfreeze (N4) — Phase 2's single-kind command surface
// ---------------------------------------------------------------------------
// Ownership note (merge-gate step 0, review Issue 3): Phase 1's `ops/freeze.ts`
// owns the HANDOFF path (`freezeAllForHandoff`) and the N4 unfreeze executor
// (`unfreezeArtifact`). Phase 2 keeps only what Phase 1 does NOT provide:
//   * `applySingleKindFreeze` — freeze ONE (run, kind) from the command surface;
//   * `finalizeUnfreeze`      — the F18 tx entry + WAL checkpoint + local commit
//                               that wrap Phase 1's unfreeze call (Phase 1's
//                               executor writes the audit row only);
//   * the read-only wrappers the L3 pickers use (no state.json dependency).

/** Frozen state of one (run, kind) for the picker hint — null without a row/DB. */
export function freezeStateOf(cwd: string, projectName: string, runId: string, kind: ArtifactKind): FrozenState | null {
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) return null;
	const db = openStoreDb(dbPath);
	try {
		return readFrozenState(db, runId, kind);
	} finally {
		closeStoreDb(db);
	}
}

/** Kinds holding an artifact row for one run (read-only picker pre-list). */
export function freezableKinds(cwd: string, projectName: string, runId: string): ArtifactKind[] {
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) return [];
	const db = openStoreDb(dbPath);
	try {
		return listRunKinds(db, runId);
	} finally {
		closeStoreDb(db);
	}
}

/** Every kind present in the project store, canonical order (run-independent). */
export function storeKinds(cwd: string, projectName: string): ArtifactKind[] {
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) return [];
	const db = openStoreDb(dbPath);
	try {
		return listStoreKinds(db);
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Runs holding an artifact row for one kind, newest first (rule 11 — the run
 * picker for freeze/unfreeze; no state.json dependency).
 * @returns {string[]} Run ids, newest first; [] when the store DB is absent.
 */
export function runsForKind(cwd: string, projectName: string, kind: ArtifactKind): string[] {
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) return [];
	const db = openStoreDb(dbPath);
	try {
		return listArtifactRuns(db, kind);
	} finally {
		closeStoreDb(db);
	}
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
 * re-freezing re-stamps the flag (and updates the reason). Phase 1's
 * `freezeAllForHandoff` stays the handoff path; this is the manual command path.
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
 * Finish an unfreeze performed by Phase 1's `ops/freeze.ts:unfreezeArtifact`:
 * appends the F18 tx entry, WAL-checkpoints and commits the store DB locally
 * (design rules 2/7 — Phase 1's executor writes the audit row, which stays the
 * canonical N4 record). Call ONLY after `unfreezeArtifact` returned ok.
 * @returns {string[]} Commit warnings (never throws).
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
	return commitProtectionChange({
		cwd: params.cwd,
		projectName: params.projectName,
		paths: [params.dbPath],
		message: `velpari(unfreeze): ${params.projectName} ${params.kind} (run ${params.runId})`,
	});
}
