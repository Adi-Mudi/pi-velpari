// Unit tests — io/db.ts store content digest (Phase B, G6/N21 layer 4).
// Covers: digest stability, content sensitivity, audit/tx exclusion,
// stamp round-trip (store_meta), self-exclusion of the stamp, fail-open
// reads (absent + scope-mismatched), writeArtifact auto re-stamp (D11).
// Conventions: temp dirs + real openStoreDb — no mocks.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	openStoreDb,
	closeStoreDb,
	computeStoreContentDigest,
	readStoreDigestStamp,
	stampStoreContentDigest,
	storeMetaSet,
	storeMetaGet,
	STORE_DIGEST_SCOPE,
} from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";
import {
	writeArtifact,
	appendAuditEntry,
	appendTxEntry,
	type ArtifactEnvelopeInput,
} from "../../src/io/store.js";

/** Envelope input with deterministic defaults (store.test.ts idiom). */
function env(overrides: Partial<ArtifactEnvelopeInput> = {}): ArtifactEnvelopeInput {
	return {
		version: 1,
		stage: "drafting-prd",
		generatedAt: "2026-09-22T00:00:00Z",
		inputs: "{}",
		reviewerVerdict: null,
		changeLog: "[]",
		...overrides,
	};
}

const FR_SEED = [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: null as string | null }];

describe("io/db — store content digest (Phase B G6)", () => {
	let dirs: string[] = [];
	let dbPath = "";
	let db: DatabaseSync;

	beforeEach(() => {
		const dir = mkdtempSync(join(tmpdir(), "velpari-digest-"));
		dirs.push(dir);
		dbPath = join(dir, "index.db");
		db = openStoreDb(dbPath);
	});

	after(() => {
		for (const db2 of [db]) {
			try {
				closeStoreDb(db2);
			} catch {
				// already closed by a test
			}
		}
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	});

	test("1. digest is stable across two computes on an unchanged DB", () => {
		const a = computeStoreContentDigest(db);
		const b = computeStoreContentDigest(db);
		assert.equal(a, b, "same content must hash the same");
		assert.match(a, /^[0-9a-f]{64}$/, "sha256 hex");
	});

	test("2. an fr row insert changes the digest (content sensitivity)", () => {
		const before = computeStoreContentDigest(db);
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		const after = computeStoreContentDigest(db);
		assert.notEqual(before, after, "new fr content must change the digest");
	});

	test("3. audit_ledger + tx_log appends do NOT change the digest (excluded, D11)", () => {
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		const before = computeStoreContentDigest(db);
		appendAuditEntry(db, { actor: "test", action: "publish", artifactKind: "prd", revisionNumber: 1 });
		appendTxEntry(db, { actor: "test", operation: "publish", outcome: "commit" });
		const after = computeStoreContentDigest(db);
		assert.equal(before, after, "append-only chain rows are out of digest scope");
	});

	test("4. stamp writes store_meta keys and readStoreDigestStamp round-trips", () => {
		const stamp = stampStoreContentDigest(db);
		assert.equal(stamp.scope, STORE_DIGEST_SCOPE);
		assert.match(stamp.digest, /^[0-9a-f]{64}$/);
		assert.ok(stamp.stampedAt.length > 0);
		assert.equal(storeMetaGet(db, "store_digest_scope"), STORE_DIGEST_SCOPE);
		assert.equal(storeMetaGet(db, "store_digest"), stamp.digest);
		assert.equal(storeMetaGet(db, "store_digest_at"), stamp.stampedAt);
		const read = readStoreDigestStamp(db);
		assert.deepEqual(read, stamp);
	});

	test("5. the stamp itself never changes the digest (self-exclusion)", () => {
		const before = computeStoreContentDigest(db);
		const stamp = stampStoreContentDigest(db);
		const after = computeStoreContentDigest(db);
		assert.equal(before, after, "store_meta is excluded from the digest");
		assert.equal(stamp.digest, before, "stamp captured pre-stamp content");
	});

	test("6. fail-open reads: absent stamp → null; scope mismatch → null", () => {
		// Fresh opens now stamp a baseline (decision 2026-09-28 / D11), so
		// carve out an unstamped store by deleting the stamp keys.
		db.prepare("DELETE FROM store_meta WHERE key LIKE 'store_digest%'").run();
		assert.equal(readStoreDigestStamp(db), null, "no stamp → null");
		storeMetaSet(db, "store_digest_scope", "wrong-scope");
		storeMetaSet(db, "store_digest", "deadbeef");
		storeMetaSet(db, "store_digest_at", "2026-09-28T00:00:00Z");
		assert.equal(readStoreDigestStamp(db), null, "scope mismatch → null");
	});

	test("7. writeArtifact re-stamps: stamp tracks content through a write without a manual stamp call (D11)", () => {
		const baseline = readStoreDigestStamp(db);
		assert.ok(baseline !== null, "fresh create carries a baseline stamp (decision 2026-09-28)");
		assert.equal(baseline.digest, computeStoreContentDigest(db), "baseline equals fresh-create content");
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		const after = readStoreDigestStamp(db);
		assert.ok(after !== null, "writeArtifact keeps the stamp present");
		assert.notEqual(after.digest, baseline.digest, "stamp moved with the content");
		assert.equal(after.digest, computeStoreContentDigest(db), "stamp equals post-write content");
	});
});
