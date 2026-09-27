// Unit tests — ops/protection.ts (Phase 2, 2026-09-27).
// Covers: revision/run/draft reads, the audited protection transaction
// (F17/F18/N15 chain integrity + rollback entry), F16 tombstone semantics
// (status-only withdraw, head re-point, reason recorded, bytes never removed)
// and the N4/D5 frozen refusal.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import {
	auditCanonicalPayload,
	txCanonicalPayload,
	writeArtifact,
	publishArtifactCas,
	getHeadRevision,
	setFrozen,
	type ArtifactPayload,
} from "../../src/io/store.js";
import { verifyChain } from "../../src/core/hashchain.js";
import {
	countRunDrafts,
	listArtifactRuns,
	listDraftRuns,
	listRevisions,
	readFrozenState,
	withdrawRevision,
	withProtectionTxn,
} from "../../src/ops/protection.js";
import type { DatabaseSync } from "node:sqlite";

interface AuditRow extends Record<string, unknown> {
	at: string;
	actor: string;
	action: string;
	artifact_kind: string | null;
	revision_number: number | null;
	reason: string | null;
	detail_json: string;
	prev_hash: string;
	entry_hash: string;
}

/** Write one minimal draft PRD artifact for `runId`. */
function writeDraftPrd(db: DatabaseSync, runId: string, textHash: string, generatedAt = "2026-09-27T00:00:00Z"): void {
	writeArtifact(db, "prd", runId, { version: 1, stage: "drafting-prd", generatedAt }, {
		fr: [{ id: "FR-1", phase: 1, textHash, text: `Prose for ${textHash}.` }],
	} as ArtifactPayload);
}

/** Audit rows as chain-verifier inputs (N15). */
function chainAuditRows(
	db: DatabaseSync,
): Array<{ prev_hash: string; entry_hash: string; canonicalPayload(): string }> {
	const rows = db
		.prepare(
			`SELECT at, actor, action, artifact_kind, revision_number, reason, detail_json, prev_hash, entry_hash
			 FROM audit_ledger ORDER BY entry_id ASC`,
		)
		.all() as AuditRow[];
	return rows.map((row) => ({
		prev_hash: String(row.prev_hash),
		entry_hash: String(row.entry_hash),
		canonicalPayload: () =>
			auditCanonicalPayload({
				at: String(row.at),
				actor: String(row.actor),
				action: String(row.action),
				artifact_kind: row.artifact_kind === null ? null : String(row.artifact_kind),
				revision_number: row.revision_number === null ? null : Number(row.revision_number),
				reason: row.reason === null ? null : String(row.reason),
				detail_json: String(row.detail_json),
			}),
	}));
}

/** Tx-log rows as chain-verifier inputs (N15). */
function chainTxRows(db: DatabaseSync): Array<{ prev_hash: string; entry_hash: string; canonicalPayload(): string }> {
	const rows = db
		.prepare(
			"SELECT at, actor, operation, before_digest, after_digest, outcome, prev_hash, entry_hash FROM tx_log ORDER BY tx_id ASC",
		)
		.all() as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		prev_hash: String(row.prev_hash),
		entry_hash: String(row.entry_hash),
		canonicalPayload: () =>
			txCanonicalPayload({
				at: String(row.at),
				actor: String(row.actor),
				operation: String(row.operation),
				before_digest: row.before_digest === null ? null : String(row.before_digest),
				after_digest: row.after_digest === null ? null : String(row.after_digest),
				outcome: String(row.outcome),
			}),
	}));
}

function countRows(db: DatabaseSync, table: string): number {
	const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
	return Number(row.n);
}

describe("ops/protection — reads", () => {
	let dir: string;
	let dbPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-protection-"));
		dbPath = join(dir, "index.db");
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("listRevisions returns newest-first with narrowed statuses + tombstone reason", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			const first = publishArtifactCas(db, "r1", "prd", null);
			writeDraftPrd(db, "r1", "bbb222");
			const second = publishArtifactCas(db, "r1", "prd", first.revisionId);

			let revisions = listRevisions(db, "prd");
			assert.equal(revisions.length, 2);
			assert.equal(revisions[0]!.revisionNumber, second.revisionNumber, "newest first");
			assert.equal(revisions[0]!.status, "published");
			assert.equal(revisions[1]!.status, "superseded");
			assert.equal(revisions[0]!.runId, "r1");
			assert.equal(revisions[1]!.tombstoneReason, null, "no tombstone yet");

			const withdrawn = withdrawRevision(db, {
				kind: "prd",
				revisionId: first.revisionId,
				reason: "superseded content was wrong",
				actor: "test",
			});
			assert.equal(withdrawn.ok, true);
			revisions = listRevisions(db, "prd");
			const tombstoned = revisions.find((r) => r.revisionId === first.revisionId)!;
			assert.equal(tombstoned.status, "withdrawn");
			assert.equal(tombstoned.tombstoneReason, "superseded content was wrong");
		} finally {
			closeStoreDb(db);
		}
	});

	test("readFrozenState: null without a row, false without a freeze, true with the reason", () => {
		const db = openStoreDb(dbPath);
		try {
			assert.equal(readFrozenState(db, "r1", "prd"), null);
			writeDraftPrd(db, "r1", "aaa111");
			assert.deepEqual(readFrozenState(db, "r1", "prd"), { frozen: false, reason: null });
			setFrozen(db, "r1", "prd", true, "baselined at handoff");
			assert.deepEqual(readFrozenState(db, "r1", "prd"), { frozen: true, reason: "baselined at handoff" });
		} finally {
			closeStoreDb(db);
		}
	});

	test("countRunDrafts counts drafts only — a published artifact is not counted", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			assert.equal(countRunDrafts(db, "r1"), 1);
			publishArtifactCas(db, "r1", "prd", null);
			assert.equal(countRunDrafts(db, "r1"), 0, "published rows are not drafts");
			writeDraftPrd(db, "r2", "ccc333");
			assert.equal(countRunDrafts(db, "r2"), 1);
			assert.equal(countRunDrafts(db, "r1"), 0, "run-scoped");
		} finally {
			closeStoreDb(db);
		}
	});

	test("listArtifactRuns / listDraftRuns are pure reads, newest-first and draft-scoped", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "rOld", "aaa111", "2026-01-01T00:00:00Z");
			publishArtifactCas(db, "rOld", "prd", null);
			writeDraftPrd(db, "rNew", "bbb222", "2026-02-02T00:00:00Z");
			writeDraftPrd(db, "rFree", "ccc333", "2026-03-03T00:00:00Z");

			const txBefore = countRows(db, "tx_log");
			const auditBefore = countRows(db, "audit_ledger");

			assert.deepEqual(listArtifactRuns(db, "prd"), ["rFree", "rNew", "rOld"], "newest generated_at first");
			assert.deepEqual(listArtifactRuns(db, "rtm"), [], "no rows for an unused kind — never invents a run");

			const drafts = listDraftRuns(db);
			assert.deepEqual(
				drafts.map((d) => d.runId),
				["rFree", "rNew"],
				"published-only run is absent",
			);
			assert.equal(drafts.find((d) => d.runId === "rFree")!.drafts, 1);

			assert.equal(countRows(db, "tx_log"), txBefore, "reads never write a tx entry");
			assert.equal(countRows(db, "audit_ledger"), auditBefore, "reads never write an audit entry");
		} finally {
			closeStoreDb(db);
		}
	});
});

describe("ops/protection — audited transaction", () => {
	let dir: string;
	let dbPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-protection-txn-"));
		dbPath = join(dir, "index.db");
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("withProtectionTxn writes chain-clean audit + tx entries and returns fn's value", () => {
		const db = openStoreDb(dbPath);
		try {
			const value = withProtectionTxn(
				db,
				{
					actor: "test-actor",
					action: "freeze",
					artifactKind: "prd",
					reason: "baselined at handoff",
					beforeDigest: "aaa",
					afterDigest: "bbb",
					detail: { runId: "r1" },
				},
				() => 42,
			);
			assert.equal(value, 42, "fn's return value passes through");

			const audit = db.prepare("SELECT actor, action, artifact_kind, reason, detail_json FROM audit_ledger").get() as {
				actor: string;
				action: string;
				artifact_kind: string;
				reason: string;
				detail_json: string;
			};
			assert.equal(audit.actor, "test-actor");
			assert.equal(audit.action, "freeze");
			assert.equal(audit.artifact_kind, "prd");
			assert.equal(audit.reason, "baselined at handoff");
			assert.equal(audit.detail_json, JSON.stringify({ runId: "r1" }));

			const tx = db.prepare("SELECT operation, before_digest, after_digest, outcome FROM tx_log").get() as Record<
				string,
				string
			>;
			assert.equal(tx.operation, "freeze");
			assert.equal(tx.before_digest, "aaa");
			assert.equal(tx.after_digest, "bbb");
			assert.equal(tx.outcome, "commit");

			assert.equal(verifyChain(chainAuditRows(db)), null, "audit chain verifies");
			assert.equal(verifyChain(chainTxRows(db)), null, "tx chain verifies");
		} finally {
			closeStoreDb(db);
		}
	});

	test("withProtectionTxn rethrows a failing fn, rolls back, and records a rollback tx entry", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			const before = countRows(db, "artifact_revisions");

			assert.throws(
				() =>
					withProtectionTxn(db, { actor: "test", action: "tombstone", artifactKind: "prd" }, () => {
						db.prepare("UPDATE artifacts SET frozen = 1 WHERE run_id = 'r1' AND kind = 'prd'").run();
						throw new Error("boom");
					}),
				/boom/,
			);

			const env = db.prepare("SELECT frozen FROM artifacts WHERE run_id = 'r1' AND kind = 'prd'").get() as {
				frozen: number;
			};
			assert.equal(env.frozen, 0, "the mutation was rolled back");
			assert.equal(countRows(db, "artifact_revisions"), before);
			assert.equal(countRows(db, "audit_ledger"), 0, "no audit entry for a rolled-back action");

			const tx = db.prepare("SELECT outcome FROM tx_log ORDER BY tx_id ASC").all() as Array<{ outcome: string }>;
			assert.deepEqual(
				tx.map((t) => t.outcome),
				["rollback"],
			);
			assert.equal(verifyChain(chainTxRows(db)), null, "rollback entry keeps the chain clean");
		} finally {
			closeStoreDb(db);
		}
	});
});

describe("ops/protection — F16 tombstone + N4/D5 frozen refusal", () => {
	let dir: string;
	let dbPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-protection-tomb-"));
		dbPath = join(dir, "index.db");
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	/** Publish two PRD revisions for r1 and return both revision ids. */
	function seedTwoRevisions(db: DatabaseSync): { first: number; second: number } {
		writeDraftPrd(db, "r1", "aaa111");
		const first = publishArtifactCas(db, "r1", "prd", null);
		writeDraftPrd(db, "r1", "bbb222");
		const second = publishArtifactCas(db, "r1", "prd", first.revisionId);
		return { first: first.revisionId, second: second.revisionId };
	}

	test("withdrawRevision: status-only withdraw, bytes + row count intact, reason audited", () => {
		const db = openStoreDb(dbPath);
		try {
			const { first, second } = seedTwoRevisions(db);
			const bytesBefore = (
				db.prepare("SELECT yaml_bytes FROM artifact_revisions WHERE revision_id = ?").get(first) as {
					yaml_bytes: string;
				}
			).yaml_bytes;
			const revisionsBefore = countRows(db, "artifact_revisions");

			const outcome = withdrawRevision(db, {
				kind: "prd",
				revisionId: first,
				reason: "wrong FR text shipped",
				actor: "velpari-tombstone",
			});
			assert.equal(outcome.ok, true);
			assert.equal(outcome.ok === true && outcome.revisionNumber, 1);
			assert.equal(outcome.ok === true && outcome.wasHead, false, "v1 stopped being head when v2 published");
			assert.equal(outcome.ok === true && outcome.newHeadRevisionId, second, "head pointer untouched");

			const row = db.prepare("SELECT status, yaml_bytes FROM artifact_revisions WHERE revision_id = ?").get(first) as {
				status: string;
				yaml_bytes: string;
			};
			assert.equal(row.status, "withdrawn");
			assert.equal(row.yaml_bytes, bytesBefore, "snapshot bytes are never removed (F9/F16)");
			assert.equal(countRows(db, "artifact_revisions"), revisionsBefore, "no row was deleted");

			const audit = db
				.prepare(
					"SELECT actor, action, artifact_kind, revision_number, reason, detail_json FROM audit_ledger WHERE action = 'tombstone'",
				)
				.get() as Record<string, unknown>;
			assert.equal(audit.actor, "velpari-tombstone");
			assert.equal(audit.action, "tombstone");
			assert.equal(audit.artifact_kind, "prd");
			assert.equal(Number(audit.revision_number), 1);
			assert.equal(audit.reason, "wrong FR text shipped");
			assert.equal(audit.detail_json, JSON.stringify({ revisionId: first, wasHead: false, newHeadRevisionId: second }));

			const tx = db
				.prepare("SELECT operation, before_digest, after_digest, outcome FROM tx_log WHERE operation = 'tombstone'")
				.get() as Record<string, string>;
			assert.equal(tx.operation, "tombstone");
			assert.equal(tx.outcome, "commit");
			assert.equal(tx.before_digest, tx.after_digest, "status-only action: the fingerprint is unchanged");
			assert.equal(verifyChain(chainAuditRows(db)), null);
			assert.equal(verifyChain(chainTxRows(db)), null);
		} finally {
			closeStoreDb(db);
		}
	});

	test("head tombstone re-points the head to the previous live revision", () => {
		const db = openStoreDb(dbPath);
		try {
			const { first, second } = seedTwoRevisions(db);
			assert.equal(getHeadRevision(db, "r1", "prd")?.revisionId, second);

			const outcome = withdrawRevision(db, {
				kind: "prd",
				revisionId: second,
				reason: "withdrawn after review",
				actor: "velpari-tombstone",
			});
			assert.equal(outcome.ok, true);
			assert.equal(outcome.ok === true && outcome.wasHead, true);
			assert.equal(outcome.ok === true && outcome.newHeadRevisionId, first, "head re-pointed backwards");
			assert.equal(getHeadRevision(db, "r1", "prd")?.revisionId, first, "CAS now expects the live revision");
		} finally {
			closeStoreDb(db);
		}
	});

	test("tombstoning the only revision leaves a null head (no live revision left)", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			const only = publishArtifactCas(db, "r1", "prd", null);

			const outcome = withdrawRevision(db, {
				kind: "prd",
				revisionId: only.revisionId,
				reason: "content retracted",
				actor: "velpari-tombstone",
			});
			assert.equal(outcome.ok, true);
			assert.equal(outcome.ok === true && outcome.wasHead, true);
			assert.equal(outcome.ok === true && outcome.newHeadRevisionId, null);
			assert.equal(getHeadRevision(db, "r1", "prd"), null, "no live head remains");
		} finally {
			closeStoreDb(db);
		}
	});

	test("business refusals: already tombstoned, unknown revision, kind mismatch, empty reason", () => {
		const db = openStoreDb(dbPath);
		try {
			const { first } = seedTwoRevisions(db);
			const params = { kind: "prd" as const, revisionId: first, reason: "retracted", actor: "test" };
			assert.equal(withdrawRevision(db, params).ok, true);

			const again = withdrawRevision(db, params);
			assert.equal(again.ok, false);
			assert.match(again.ok === false ? again.problem : "", /already tombstoned/);

			const missing = withdrawRevision(db, { ...params, revisionId: 99999 });
			assert.equal(missing.ok, false);
			assert.match(missing.ok === false ? missing.problem : "", /no revision with id 99999/);

			writeArtifact(
				db,
				"rtm",
				"r1",
				{ version: 1, stage: "building-rtm", generatedAt: "2026-09-27T01:00:00Z" },
				{} as ArtifactPayload,
			);
			const rtm = publishArtifactCas(db, "r1", "rtm", null);
			const mismatch = withdrawRevision(db, {
				kind: "prd",
				revisionId: rtm.revisionId,
				reason: "wrong kind",
				actor: "test",
			});
			assert.equal(mismatch.ok, false);
			assert.match(mismatch.ok === false ? mismatch.problem : "", /belongs to 'rtm'/);

			assert.throws(
				() => withdrawRevision(db, { kind: "prd", revisionId: first, reason: "   ", actor: "test" }),
				/non-empty reason/,
			);
			assert.equal(countRows(db, "artifact_revisions"), 3, "refusals never delete rows");
		} finally {
			closeStoreDb(db);
		}
	});

	test("D5/N4 — a frozen artifact refuses the tombstone and names the unfreeze path", () => {
		const db = openStoreDb(dbPath);
		try {
			const { first } = seedTwoRevisions(db);
			setFrozen(db, "r1", "prd", true, "baselined at handoff");
			const auditBefore = countRows(db, "audit_ledger");
			const txBefore = countRows(db, "tx_log");

			const refused = withdrawRevision(db, {
				kind: "prd",
				revisionId: first,
				reason: "wanted it gone",
				actor: "test",
			});
			assert.equal(refused.ok, false);
			assert.match(refused.ok === false ? refused.problem : "", /is frozen — baselined at handoff/);
			assert.match(refused.ok === false ? refused.problem : "", /\/velpari-freeze/);

			const status = db.prepare("SELECT status FROM artifact_revisions WHERE revision_id = ?").get(first) as {
				status: string;
			};
			assert.equal(status.status, "superseded", "the refusal leaves the revision untouched");
			assert.equal(countRows(db, "audit_ledger"), auditBefore, "a refusal writes no audit entry");
			assert.equal(countRows(db, "tx_log"), txBefore, "a refusal writes no tx entry");

			setFrozen(db, "r1", "prd", false, "user retracted the handoff lock");
			const after = withdrawRevision(db, { kind: "prd", revisionId: first, reason: "now allowed", actor: "test" });
			assert.equal(after.ok, true, "an explicit unfreeze unblocks the tombstone");
		} finally {
			closeStoreDb(db);
		}
	});
});
