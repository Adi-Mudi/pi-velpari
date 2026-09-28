// Unit tests — core/soft-lock.ts + io/db.ts L1 guard (Phase B, N19/N20/G1/G3).
// Covers: the lock transition ladder (mark → idempotent → CAS republish keeps
// new head unlocked), unmapped/self skipping, kind→consumer-key map, clear on
// revert, the LockedRevisionError message + content-column allow-list, and
// fail-open behavior with no store on disk.
// Conventions: temp dirs + real store at buildStoreDbPath (markConsumedUpstreams
// opens its own connection — no mocks).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	openStoreDb,
	closeStoreDb,
	readRevisionLock,
	assertRevisionContentUnlocked,
	updateRevisionContent,
	LockedRevisionError,
} from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";
import {
	writeArtifact,
	publishArtifactCas,
	type ArtifactEnvelopeInput,
} from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import {
	artifactKeyToStoreKind,
	consumerKeysForKind,
	upstreamArtifactsForPublish,
	markConsumedUpstreams,
	listSoftLocks,
	clearLocksForConsumer,
} from "../../src/core/soft-lock.js";

/** Envelope input with deterministic defaults (store.test.ts idiom). */
function env(overrides: Partial<ArtifactEnvelopeInput> = {}): ArtifactEnvelopeInput {
	return {
		version: 1,
		stage: "drafting-prd",
		generatedAt: "2026-09-28T00:00:00Z",
		inputs: "{}",
		reviewerVerdict: null,
		changeLog: "[]",
		...overrides,
	};
}

const FR_SEED = [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: null as string | null }];

describe("core/soft-lock — consumption locks + L1 guard (Phase B)", () => {
	let dir: string;
	let dbPath: string;
	let db: DatabaseSync;
	const project = "proj";

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-softlock-"));
		dbPath = buildStoreDbPath(project, dir);
		db = openStoreDb(dbPath);
	});

	after(() => {
		try {
			closeStoreDb(db);
		} catch {
			// already closed by a test
		}
		rmSync(dir, { recursive: true, force: true });
	});

	/** Count audit rows for one action (null-proto row → scalar compare). */
	function auditCount(action: string): number {
		const row = db.prepare("SELECT COUNT(*) AS n FROM audit_ledger WHERE action = ?").get(action) as {
			n: number;
		};
		return row.n;
	}

	test("1. transition ladder: mark → idempotent → CAS republish (new head unlocked, old keeps marker)", () => {
		// (a) published PRD row starts unlocked.
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		const rev1 = publishArtifactCas(db, "r1", "prd", null);
		assert.equal(readRevisionLock(db, rev1.revisionId), null, "fresh head starts unlocked");

		// MARK: rtM consuming PRD.
		const first = markConsumedUpstreams(dir, project, "rtm:proj", ["prd"]);
		assert.equal(first.locked.length, 1, "one revision newly locked");
		assert.equal(first.locked[0]?.revisionId, rev1.revisionId);
		const lock = readRevisionLock(db, rev1.revisionId);
		assert.equal(lock?.lockedBy, "rtm:proj", "locked_by = consumer manifest key (D9)");
		assert.ok((lock?.lockedAt ?? "").length > 0, "locked_at stamped");
		assert.equal(auditCount("soft-lock"), 1, "one soft-lock audit entry");

		// Idempotent second mark.
		const second = markConsumedUpstreams(dir, project, "rtm:proj", ["prd"]);
		assert.equal(second.locked.length, 0, "second mark is a no-op");
		assert.equal(auditCount("soft-lock"), 1, "no duplicate audit");

		// SURFACE input: listSoftLocks sees it.
		const locks = listSoftLocks(dir, project, "prd");
		assert.equal(locks.length, 1, "listSoftLocks reports the lock");
		assert.equal(locks[0]?.lockedBy, "rtm:proj");
		assert.equal(locks[0]?.revisionNumber, rev1.revisionNumber);

		// N19: republishing a locked artifact (copy → new version) SUCCEEDS.
		writeArtifact(db, "prd", "r1", env({ version: 2 }), { fr: FR_SEED });
		const rev2 = publishArtifactCas(db, "r1", "prd", rev1.revisionId);
		assert.notEqual(rev2.revisionId, rev1.revisionId, "new revision created");
		assert.equal(readRevisionLock(db, rev2.revisionId), null, "new head is unlocked (D9)");
		assert.ok(readRevisionLock(db, rev1.revisionId) !== null, "superseded row keeps its marker (history)");
		assert.equal(listSoftLocks(dir, project, "prd").length, 1, "still exactly one lock");
	});

	test("2. detection skips unmapped + self keys (D8)", () => {
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		publishArtifactCas(db, "r1", "prd", null);
		// RTM rows need an fr row in the same run (FK) — publish RTM too.
		writeArtifact(db, "rtm", "r1", { ...env(), stage: "building-rtm" }, {
			rtmRow: [{ id: "T-1", frRef: "FR-1", phase: 1, targetSha256: "x" }],
		});
		const rtm = publishArtifactCas(db, "r1", "rtm", null);

		// upstreamArtifactsForPublish normalizes + drops self.
		const upstreams = upstreamArtifactsForPublish({
			artifactKey: "RTM",
			declaredInputIds: ["prd:proj", "brainstorm:abc", "rtm:proj", "input-doc:x"],
			coverageUpstreamKeys: ["design:proj", "prd:proj"],
		});
		assert.deepEqual(upstreams, ["brainstorm", "design", "input-doc", "prd"], "deduped, sorted, self gone");

		// mark: only the mapped `prd` locks; self (rtm) + unmapped skipped.
		const marked = markConsumedUpstreams(dir, project, "rtm:proj", upstreams);
		assert.equal(marked.locked.length, 1, "only PRD locked");
		assert.equal(marked.locked[0]?.kind, "prd");
		assert.equal(readRevisionLock(db, rtm.revisionId), null, "self kind never locked");

		// Mapper surface.
		assert.equal(artifactKeyToStoreKind("PRD"), "prd");
		assert.equal(artifactKeyToStoreKind("feasibility-study"), "feasibility");
		assert.equal(artifactKeyToStoreKind("brainstorm"), null);
		assert.equal(artifactKeyToStoreKind("input-doc"), null);
	});

	test("3. consumerKeysForKind: testplan covers BOTH test artifacts", () => {
		assert.deepEqual(consumerKeysForKind("testplan"), ["test-plan", "test-cases"]);
		assert.deepEqual(consumerKeysForKind("prd"), ["prd"]);
		assert.deepEqual(consumerKeysForKind("feasibility"), ["feasibility-study"]);
	});

	test("4. clearLocksForConsumer clears only matching keys (D9 revert path)", () => {
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		const rev = publishArtifactCas(db, "r1", "prd", null);
		markConsumedUpstreams(dir, project, "rtm:proj", ["prd"]);
		// A foreign lock on the same revision must survive (partial-key match).
		db.prepare("UPDATE artifact_revisions SET locked_at = ?, locked_by = ? WHERE revision_id = ?").run(
			"2026-09-28T00:00:00Z",
			"other:proj",
			rev.revisionId,
		);
		db.exec("BEGIN IMMEDIATE;");
		const cleared = clearLocksForConsumer(db, consumerKeysForKind("rtm"));
		db.exec("COMMIT;");
		assert.equal(cleared, 0, "'other:proj' does not match the 'rtm' consumer key");

		// Lock it as rtm again, then clear → the matching lock goes.
		db.prepare("UPDATE artifact_revisions SET locked_at = ?, locked_by = ? WHERE revision_id = ?").run(
			"2026-09-28T00:00:00Z",
			"rtm:proj",
			rev.revisionId,
		);
		db.exec("BEGIN IMMEDIATE;");
		const clearedRtm = clearLocksForConsumer(db, consumerKeysForKind("rtm"));
		db.exec("COMMIT;");
		assert.equal(clearedRtm, 1, "exact manifest-key match cleared");
		assert.equal(readRevisionLock(db, rev.revisionId), null, "lock gone after clear");
	});

	test("5. L1 guard: LockedRevisionError message + content-column allow-list (G3/N20)", () => {
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		const rev = publishArtifactCas(db, "r1", "prd", null);
		const before = db
			.prepare("SELECT yaml_bytes, change_log FROM artifact_revisions WHERE revision_id = ?")
			.get(rev.revisionId) as { yaml_bytes: string; change_log: string };

		// Unlocked: assert passes, content write works.
		assertRevisionContentUnlocked(db, rev.revisionId, "test action");
		updateRevisionContent(db, rev.revisionId, { change_log: "[\"logged\"]" }, "test action");
		assert.equal(
			(db.prepare("SELECT change_log FROM artifact_revisions WHERE revision_id = ?").get(rev.revisionId) as {
				change_log: string;
			}).change_log,
			"[\"logged\"]",
			"content write landed on an unlocked revision",
		);

		// Lock it, then the guard refuses.
		markConsumedUpstreams(dir, project, "rtm:proj", ["prd"]);
		assert.throws(
			() => assertRevisionContentUnlocked(db, rev.revisionId, "edit revision"),
			(err: unknown) => {
				assert.ok(err instanceof LockedRevisionError, "typed error");
				assert.match(
					err.message,
					/is soft-locked \(consumed by rtm:proj\) — its content is immutable\. edit revision is refused/,
					"self-healing message names the consumer + the fix",
				);
				assert.match(err.message, /create a new version instead \(copy → publish\)/, "names the N19 path");
				assert.match(err.message, /Status updates .* still allowed \(N20\)/, "status path stays open");
				return true;
			},
			"locked revision refuses content writes",
		);
		assert.throws(
			() => updateRevisionContent(db, rev.revisionId, { change_log: "[\"nope\"]" }, "edit revision"),
			LockedRevisionError,
			"the sanctioned writer refuses too",
		);
		const after = db
			.prepare("SELECT yaml_bytes, change_log FROM artifact_revisions WHERE revision_id = ?")
			.get(rev.revisionId) as { yaml_bytes: string; change_log: string };
		assert.equal(after.yaml_bytes, before.yaml_bytes, "yaml_bytes untouched by the refused write");
		assert.equal(after.change_log, "[\"logged\"]", "change_log untouched by the refused write");

		// Allow-list: status is not a content column (routes to protection.ts).
		assert.throws(
			() => updateRevisionContent(db, rev.revisionId, { status: "withdrawn" }, "edit revision"),
			/not a content column/,
			"non-content columns are refused before the lock check",
		);
		assert.throws(
			() => updateRevisionContent(db, rev.revisionId, {}, "edit revision"),
			/at least one column/,
			"empty patch refused",
		);
	});

	test("6. fail-open: no store on disk → { locked: [] } (D10)", () => {
		const emptyDir = mkdtempSync(join(tmpdir(), "velpari-softlock-empty-"));
		try {
			const marked = markConsumedUpstreams(emptyDir, project, "rtm:proj", ["prd"]);
			assert.deepEqual(marked, { locked: [] }, "no store → no locks, no throw");
			assert.deepEqual(listSoftLocks(emptyDir, project), [], "listing empty store → []");
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});
});
