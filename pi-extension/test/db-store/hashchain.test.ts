// Unit tests — core/hashchain.ts + io/store.ts audit/tx append helpers
// (Foundation 2026-09-27, N15 tamper-evident audit trail).
// Covers: clean chain verifies null, UPDATE tamper named at the tampered row,
// DELETE tamper named at the following row, genesis violation named at row 1,
// per-table chain independence, publishArtifactCas reference wiring verifies
// clean (audit + tx).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import {
	appendAuditEntry,
	appendTxEntry,
	auditCanonicalPayload,
	txCanonicalPayload,
	writeArtifact,
	publishArtifactCas,
	type ArtifactPayload,
} from "../../src/io/store.js";
import { GENESIS_HASH, computeEntryHash, verifyChain, type ChainedRow } from "../../src/core/hashchain.js";
import type { DatabaseSync } from "node:sqlite";

/** Read audit_ledger rows in storage order as ChainedRow[]. */
function auditChain(db: DatabaseSync): ChainedRow[] {
	const rows = db
		.prepare(
			"SELECT at, actor, action, artifact_kind, revision_number, reason, detail_json, prev_hash, entry_hash FROM audit_ledger ORDER BY entry_id",
		)
		.all() as Array<Record<string, unknown>>;
	return rows.map((r) => ({
		prev_hash: String(r.prev_hash),
		entry_hash: String(r.entry_hash),
		canonicalPayload: () =>
			auditCanonicalPayload({
				at: String(r.at),
				actor: String(r.actor),
				action: String(r.action),
				artifact_kind: r.artifact_kind === null ? null : String(r.artifact_kind),
				revision_number: r.revision_number === null ? null : Number(r.revision_number),
				reason: r.reason === null ? null : String(r.reason),
				detail_json: String(r.detail_json),
			}),
	}));
}

/** Read tx_log rows in storage order as ChainedRow[]. */
function txChain(db: DatabaseSync): ChainedRow[] {
	const rows = db
		.prepare(
			"SELECT at, actor, operation, before_digest, after_digest, outcome, prev_hash, entry_hash FROM tx_log ORDER BY tx_id",
		)
		.all() as Array<Record<string, unknown>>;
	return rows.map((r) => ({
		prev_hash: String(r.prev_hash),
		entry_hash: String(r.entry_hash),
		canonicalPayload: () =>
			txCanonicalPayload({
				at: String(r.at),
				actor: String(r.actor),
				operation: String(r.operation),
				before_digest: r.before_digest === null ? null : String(r.before_digest),
				after_digest: r.after_digest === null ? null : String(r.after_digest),
				outcome: String(r.outcome),
			}),
	}));
}

describe("hashchain — audit/tx tamper evidence (N15)", () => {
	let dir: string;
	let dbPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-hashchain-"));
		dbPath = join(dir, "index.db");
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("three appended audit entries verify clean (null)", () => {
		const db = openStoreDb(dbPath);
		try {
			appendAuditEntry(db, { actor: "test", action: "publish", artifactKind: "prd", revisionNumber: 1 });
			appendAuditEntry(db, { actor: "test", action: "supersede", artifactKind: "prd", revisionNumber: 1 });
			appendAuditEntry(db, { actor: "test", action: "freeze", artifactKind: "prd", reason: "handoff" });
			assert.equal(verifyChain(auditChain(db)), null);
			const first = db.prepare("SELECT prev_hash FROM audit_ledger ORDER BY entry_id LIMIT 1").get() as {
				prev_hash: string;
			};
			assert.equal(first.prev_hash, GENESIS_HASH, "first row chains from the genesis hash");
		} finally {
			closeStoreDb(db);
		}
	});

	test("UPDATE tamper on a middle row's detail_json is named at exactly that row", () => {
		const db = openStoreDb(dbPath);
		try {
			appendAuditEntry(db, { actor: "test", action: "a" });
			appendAuditEntry(db, { actor: "test", action: "b" });
			appendAuditEntry(db, { actor: "test", action: "c" });
			db.prepare("UPDATE audit_ledger SET detail_json = '{\"tampered\":true}' WHERE action = 'b'").run();
			assert.equal(verifyChain(auditChain(db)), 2, "row 2's stored hash no longer matches its content");
		} finally {
			closeStoreDb(db);
		}
	});

	test("DELETE of a middle row names the break at the following row", () => {
		const db = openStoreDb(dbPath);
		try {
			appendAuditEntry(db, { actor: "test", action: "a" });
			appendAuditEntry(db, { actor: "test", action: "b" });
			appendAuditEntry(db, { actor: "test", action: "c" });
			db.prepare("DELETE FROM audit_ledger WHERE action = 'b'").run();
			assert.equal(verifyChain(auditChain(db)), 2, "row 'c' now chains from a missing predecessor");
		} finally {
			closeStoreDb(db);
		}
	});

	test("genesis violation (first row prev_hash ≠ GENESIS_HASH) is named at row 1", () => {
		const db = openStoreDb(dbPath);
		try {
			appendAuditEntry(db, { actor: "test", action: "a" });
			db.prepare("UPDATE audit_ledger SET prev_hash = ? WHERE action = 'a'").run("f".repeat(64));
			assert.equal(verifyChain(auditChain(db)), 1);
		} finally {
			closeStoreDb(db);
		}
	});

	test("tx_log chain is independent from the audit_ledger chain", () => {
		const db = openStoreDb(dbPath);
		try {
			appendAuditEntry(db, { actor: "test", action: "a" });
			appendTxEntry(db, { actor: "test", operation: "publish", outcome: "commit", afterDigest: "abc" });
			const firstTx = db.prepare("SELECT prev_hash FROM tx_log LIMIT 1").get() as { prev_hash: string };
			assert.equal(firstTx.prev_hash, GENESIS_HASH, "tx chain starts at its own genesis, not the audit chain");
			assert.equal(verifyChain(txChain(db)), null);
			assert.equal(verifyChain(auditChain(db)), null);
		} finally {
			closeStoreDb(db);
		}
	});

	test("publishArtifactCas writes audit + tx entries that verify clean (reference wiring)", () => {
		const db = openStoreDb(dbPath);
		try {
			writeArtifact(db, "prd", "r1", { version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" }, {
				fr: [{ id: "FR-1", phase: 1, textHash: "aaa111" }],
			} as ArtifactPayload);
			publishArtifactCas(db, "r1", "prd", null);
			// Second publish: supersede + publish entries, second commit tx entry.
			writeArtifact(db, "prd", "r1", { version: 2, stage: "drafting-prd", generatedAt: "2026-09-27T01:00:00Z" }, {
				fr: [{ id: "FR-1", phase: 1, textHash: "bbb222" }],
			} as ArtifactPayload);
			const first = db
				.prepare("SELECT revision_id FROM artifact_revisions WHERE kind = 'prd' AND revision_number = 1")
				.get() as {
				revision_id: number;
			};
			publishArtifactCas(db, "r1", "prd", first.revision_id);

			const audit = auditChain(db);
			const tx = txChain(db);
			assert.equal(verifyChain(audit), null);
			assert.equal(verifyChain(tx), null);
			const actions = db.prepare("SELECT action FROM audit_ledger ORDER BY entry_id").all() as Array<{
				action: string;
			}>;
			assert.deepEqual(
				actions.map((a) => a.action),
				["publish", "supersede", "publish"],
			);
			const outcomes = db.prepare("SELECT outcome, operation FROM tx_log ORDER BY tx_id").all() as Array<
				Record<string, string>
			>;
			assert.deepEqual(
				outcomes.map((o) => `${o.operation}:${o.outcome}`),
				["publish:commit", "publish:commit"],
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("computeEntryHash: same inputs → same hash; different prev → different hash", () => {
		const h1 = computeEntryHash(GENESIS_HASH, '{"a":1}');
		const h2 = computeEntryHash(GENESIS_HASH, '{"a":1}');
		assert.equal(h1, h2, "deterministic");
		assert.notEqual(computeEntryHash("f".repeat(64), '{"a":1}'), h1, "prev_hash is part of the hash input");
		assert.match(h1, /^[0-9a-f]{64}$/);
	});
});
