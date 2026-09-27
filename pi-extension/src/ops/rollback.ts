// ============================================================================
// ops/rollback.ts — rollback-as-new-revision (Layer 1, Phase 2, F21)
// ============================================================================
// Decision record: .IDE_Plans/velpari-versioning-locking-recovery_discussion_*_v1.0.md
//   F21 — rollback = rollback-as-new-revision: correct forward, never erase
//         backward (the git-revert pattern). History is NEVER rewritten.
//   F6  — immutable full snapshots: the new revision carries the target
//         revision's exact `yaml_bytes`.
//   F9  — no UPDATE path on published content; only status transitions.
//   N4/D5 — a frozen artifact refuses everything until an explicit unfreeze.
//   F24 — the store change is committed locally, explicit paths only.
//
// Why not `io/store.ts:importArtifactYaml`: it ends with `publishArtifact`
// (a plain draft→published flip that writes NO revision row), so it would
// bypass the revision model. This module re-imports the stored bytes with
// `writeArtifact` + `verifyExportChecksum` and then publishes through
// `publishArtifactCas`, which writes the snapshot/supersede/audit/tx rows.
//
// Ordering note (deviation from the plan's "one BEGIN IMMEDIATE" wording):
// `publishArtifactCas` owns its own transaction and cannot be nested, so the
// atomic unit is the CAS publish (draft write + checksum verify happen before
// it, the rollback audit row right after it). A failure between the steps
// leaves at most a DRAFT envelope, which the next write for that (run, kind)
// overwrites or `/velpari-db-reset` removes — never a published row without a
// revision snapshot.
// ============================================================================

import { closeStoreDb, openStoreDb } from "../io/db.js";
import { parseYaml } from "../core/yaml-data.js";
import {
	FrozenArtifactError,
	HeadMovedError,
	appendAuditEntry,
	appendTxEntry,
	getHeadRevision,
	publishArtifactCas,
	verifyExportChecksum,
	writeArtifact,
	type ArtifactKind,
	type ArtifactPayload,
} from "../io/store.js";
import { commitProtectionChange, readRevisionSnapshot } from "./protection.js";

/** Input for one rollback action (paths pre-resolved by the command). */
export interface RollbackInput {
	cwd: string;
	dbPath: string;
	projectName: string;
	kind: ArtifactKind;
	/** The OLD revision whose content is re-published as the new head. */
	targetRevisionId: number;
	/** MANDATORY (F17 "why") — recorded in the audit ledger. */
	reason: string;
	/** Audit actor; defaults to "velpari-rollback". */
	actor?: string;
}

/** Outcome of a rollback action (business refusals are returned, not thrown). */
export interface RollbackOutcome {
	ok: boolean;
	message: string;
	warnings?: string[];
	newRevisionNumber?: number;
	targetRevisionNumber?: number;
}

/**
 * Roll one kind back to an older revision: re-import that revision's exact
 * `yaml_bytes` as a DRAFT, verify the round-trip bytes, then publish it as a
 * NEW revision through the CAS head (supersedes the current head). History is
 * never rewritten: the old revisions keep their bytes and statuses.
 *
 * Refusals are returned, never thrown: empty reason, unknown revision, kind
 * mismatch, tombstoned target, target == current head, frozen artifact (N4/D5)
 * and a moved head (CAS). A checksum failure leaves a draft envelope only.
 *
 * @param {RollbackInput} input - Action input (dbPath/kind/targetRevisionId/reason).
 * @returns {RollbackOutcome} `{ok:false, message}` for refusals/errors.
 */
export function applyRollback(input: RollbackInput): RollbackOutcome {
	const reason = input.reason.trim();
	if (reason === "") {
		return { ok: false, message: "Rollback requires a typed reason (F17 why)." };
	}
	const actor = input.actor ?? "velpari-rollback";
	const db = openStoreDb(input.dbPath);
	try {
		const target = readRevisionSnapshot(db, input.targetRevisionId);
		if (!target) return { ok: false, message: `no revision with id ${input.targetRevisionId}` };
		if (target.kind !== input.kind) {
			return {
				ok: false,
				message: `revision ${input.targetRevisionId} belongs to '${target.kind}', not '${input.kind}'`,
			};
		}
		if (target.status === "withdrawn") {
			return { ok: false, message: `revision v${target.revisionNumber} is tombstoned — pick another revision` };
		}
		// Rule 11: the run comes from the revision row, never from state.json.
		const runId = target.runId;
		const head = getHeadRevision(db, runId, input.kind);
		if (head !== null && head.revisionId === input.targetRevisionId) {
			return { ok: false, message: `v${target.revisionNumber} is already the head — nothing to roll back` };
		}

		const parsed = parseRevisionBytes(input.kind, target.yamlBytes);
		if (!parsed.ok) return { ok: false, message: parsed.problem };

		writeArtifact(
			db,
			input.kind,
			runId,
			{
				version: parsed.data.version,
				stage: parsed.data.stage,
				generatedAt: parsed.data.generatedAt,
				inputs: parsed.data.inputs,
				reviewerVerdict: parsed.data.reviewerVerdict,
				changeLog: parsed.data.changeLog,
			},
			parsed.data.payload,
		);
		const verify = verifyExportChecksum(db, runId, input.kind);
		if (!verify.ok) {
			return {
				ok: false,
				message:
					`rollback re-import checksum mismatch (expected ${verify.expected}, got ${verify.actual}) — ` +
					"the draft envelope was left in place for inspection (the next write overwrites it).",
			};
		}

		let published: { revisionId: number; revisionNumber: number } | null = null;
		try {
			published = publishArtifactCas(db, runId, input.kind, head?.revisionId ?? null);
		} catch (err) {
			if (err instanceof FrozenArtifactError) {
				return {
					ok: false,
					message:
						`'${input.kind}' is frozen${err.reason ? ` — ${err.reason}` : ""} — ` +
						"unfreeze with /velpari-freeze (typed reason) before rolling back (N4).",
				};
			}
			if (err instanceof HeadMovedError) {
				return { ok: false, message: "head moved while rolling back — re-run /velpari-rollback to re-read the head." };
			}
			throw err;
		}

		appendAuditEntry(db, {
			actor,
			action: "rollback",
			artifactKind: input.kind,
			revisionNumber: published.revisionNumber,
			reason,
			detail: {
				runId,
				targetRevisionId: input.targetRevisionId,
				targetRevisionNumber: target.revisionNumber,
				expectedHeadRevisionId: head?.revisionId ?? null,
				newRevisionId: published.revisionId,
			},
		});
		appendTxEntry(db, {
			actor,
			operation: "rollback",
			beforeDigest: target.sha256Fingerprint,
			afterDigest: target.sha256Fingerprint, // the content is byte-identical by construction
			outcome: "commit",
		});

		const warnings = commitProtectionChange({
			cwd: input.cwd,
			projectName: input.projectName,
			paths: [input.dbPath],
			message:
				`velpari(rollback): ${input.projectName} ${input.kind} v${target.revisionNumber} → ` +
				`v${published.revisionNumber} (run ${runId})`,
		});
		return {
			ok: true,
			message:
				`Rolled back ${input.kind}: v${target.revisionNumber} → v${published.revisionNumber} (run ${runId}). ` +
				`${parsed.data.rowCount} row(s) re-published from the stored snapshot; history is unchanged.`,
			warnings: warnings.length > 0 ? warnings : undefined,
			newRevisionNumber: published.revisionNumber,
			targetRevisionNumber: target.revisionNumber,
		};
	} catch (err) {
		return { ok: false, message: `store: ${err instanceof Error ? err.message : String(err)}` };
	} finally {
		closeStoreDb(db);
	}
}

/** The envelope + payload rebuilt from one revision's stored `yaml_bytes`. */
interface ParsedRevision {
	version: number;
	stage: string;
	generatedAt: string;
	inputs: string;
	reviewerVerdict: string | null;
	changeLog: string;
	payload: ArtifactPayload;
	rowCount: number;
}

/** Parse stored `yaml_bytes` into the writeArtifact envelope + payload shapes. */
function parseRevisionBytes(
	kind: ArtifactKind,
	yamlBytes: string,
): { ok: true; data: ParsedRevision } | { ok: false; problem: string } {
	const parsed = parseYaml(yamlBytes);
	if (!parsed.ok) return { ok: false, problem: `stored revision bytes do not parse: ${parsed.error}` };
	const data = parsed.data as Record<string, unknown> | null;
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return { ok: false, problem: "stored revision bytes are not a mapping — refusing the rollback" };
	}
	const version = Number(data.version);
	const stage = typeof data.stage === "string" ? data.stage : "";
	const generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : "";
	if (!Number.isFinite(version) || version < 1 || stage === "" || generatedAt === "") {
		return { ok: false, problem: "stored revision bytes are missing version/stage/generatedAt" };
	}
	const rows = data.rows;
	if (rows === null || typeof rows !== "object" || Array.isArray(rows)) {
		return { ok: false, problem: "stored revision bytes carry no 'rows' mapping — refusing the rollback" };
	}
	let rowCount = 0;
	for (const value of Object.values(rows as Record<string, unknown>)) {
		if (value === null || typeof value !== "object") continue;
		rowCount += Array.isArray(value) ? value.length : 1;
	}
	if (rowCount === 0) return { ok: false, problem: "stored revision bytes carry zero rows — refusing the rollback" };
	const asString = (value: unknown, fallback: string): string =>
		typeof value === "string" ? value : value === undefined || value === null ? fallback : JSON.stringify(value);
	return {
		ok: true,
		data: {
			version,
			stage,
			generatedAt,
			inputs: asString(data.inputs, "{}"),
			reviewerVerdict: typeof data.reviewerVerdict === "string" ? data.reviewerVerdict : null,
			changeLog: asString(data.changeLog, "[]"),
			payload: rows as ArtifactPayload,
			rowCount,
		},
	};
}
