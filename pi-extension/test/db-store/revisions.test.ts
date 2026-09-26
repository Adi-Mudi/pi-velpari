// Unit tests — io/store.ts revision primitives (Foundation 2026-09-27, v004).
// Covers: publish snapshot rows + revision numbering, supersession chain,
// head pointer, CAS refusal (HeadMovedError, DB untouched), frozen guard
// (FrozenArtifactError), setFrozen reason rule, recordBaseline upsert,
// snapshot yaml_bytes == exportArtifactYaml bytes.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import {
	writeArtifact,
	publishArtifactCas,
	getHeadRevision,
	recordBaseline,
	setFrozen,
	exportArtifactYaml,
	HeadMovedError,
	FrozenArtifactError,
	type ArtifactPayload,
} from "../../src/io/store.js";
import type { DatabaseSync } from "node:sqlite";

/** Write one minimal draft PRD artifact for `runId`. */
function writeDraftPrd(db: DatabaseSync, runId: string, textHash: string): void {
	writeArtifact(db, "prd", runId, { version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" }, {
		fr: [{ id: "FR-1", phase: 1, textHash, text: `Prose for ${textHash}.` }],
	} as ArtifactPayload);
}

describe("store — revision primitives (v004, Foundation)", () => {
	let dir: string;
	let dbPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-revisions-"));
		dbPath = join(dir, "index.db");
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("first CAS publish writes revision 1 snapshot; head pointer follows", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			const head = publishArtifactCas(db, "r1", "prd", null);
			assert.equal(head.revisionNumber, 1);
			const row = db.prepare("SELECT * FROM artifact_revisions WHERE kind = 'prd'").get() as Record<string, unknown>;
			assert.equal(row.revision_number, 1);
			assert.equal(row.status, "published");
			assert.equal(row.run_id, "r1");
			assert.equal(row.supersedes_revision_id, null);
			assert.equal(getHeadRevision(db, "r1", "prd")?.revisionId, head.revisionId);
		} finally {
			closeStoreDb(db);
		}
	});

	test("update-mode republish writes revision 2, supersedes revision 1, head moves", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			const first = publishArtifactCas(db, "r1", "prd", null);

			writeDraftPrd(db, "r1", "bbb222"); // rewrite re-opens the draft cycle
			const second = publishArtifactCas(db, "r1", "prd", first.revisionId);
			assert.equal(second.revisionNumber, 2);

			const rev1 = db
				.prepare("SELECT status FROM artifact_revisions WHERE kind = 'prd' AND revision_number = 1")
				.get() as {
				status: string;
			};
			assert.equal(rev1.status, "superseded", "older revision flips to superseded");
			const rev2 = db
				.prepare(
					"SELECT status, supersedes_revision_id FROM artifact_revisions WHERE kind = 'prd' AND revision_number = 2",
				)
				.get() as { status: string; supersedes_revision_id: number };
			assert.equal(rev2.status, "published");
			assert.equal(rev2.supersedes_revision_id, first.revisionId);
			assert.equal(getHeadRevision(db, "r1", "prd")?.revisionId, second.revisionId);
		} finally {
			closeStoreDb(db);
		}
	});

	test("CAS refusal: stale expected head throws HeadMovedError and leaves the DB unchanged", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			const first = publishArtifactCas(db, "r1", "prd", null);
			writeDraftPrd(db, "r1", "bbb222");

			assert.throws(
				() => publishArtifactCas(db, "r1", "prd", first.revisionId + 999),
				(err: unknown) => err instanceof HeadMovedError,
			);
			// DB unchanged: still draft, still one revision, head unmoved.
			const env = db
				.prepare("SELECT status, head_revision_id FROM artifacts WHERE run_id = 'r1' AND kind = 'prd'")
				.get() as {
				status: string;
				head_revision_id: number;
			};
			assert.equal(env.status, "draft");
			assert.equal(env.head_revision_id, first.revisionId);
			const count = db.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get() as { n: number };
			assert.equal(count.n, 1);
		} finally {
			closeStoreDb(db);
		}
	});

	test("CAS refusal: expectedHeadRevisionId null is refused once a head exists", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			publishArtifactCas(db, "r1", "prd", null);
			writeDraftPrd(db, "r1", "bbb222");
			assert.throws(
				() => publishArtifactCas(db, "r1", "prd", null),
				(err: unknown) => err instanceof HeadMovedError,
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("frozen artifact refuses publish with FrozenArtifactError naming the reason", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			setFrozen(db, "r1", "prd", true, "baselined at handoff");
			assert.throws(
				() => publishArtifactCas(db, "r1", "prd", null),
				(err: unknown) => err instanceof FrozenArtifactError && /baselined at handoff/.test((err as Error).message),
			);
			const env = db.prepare("SELECT status FROM artifacts WHERE run_id = 'r1' AND kind = 'prd'").get() as {
				status: string;
			};
			assert.equal(env.status, "draft", "frozen refusal leaves the draft untouched");
		} finally {
			closeStoreDb(db);
		}
	});

	test("setFrozen: unfreeze without a reason throws; with reason clears the flag", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			setFrozen(db, "r1", "prd", true, "lock for review");
			assert.throws(() => setFrozen(db, "r1", "prd", false, ""), /requires a reason/);
			assert.throws(() => setFrozen(db, "r1", "prd", false, "   "), /requires a reason/);
			setFrozen(db, "r1", "prd", false, "handoff retracted by user");
			const env = db
				.prepare("SELECT frozen, freeze_reason FROM artifacts WHERE run_id = 'r1' AND kind = 'prd'")
				.get() as {
				frozen: number;
				freeze_reason: string;
			};
			assert.equal(env.frozen, 0);
			assert.equal(env.freeze_reason, "handoff retracted by user");
			// Unfrozen → publish works again.
			const head = publishArtifactCas(db, "r1", "prd", null);
			assert.equal(head.revisionNumber, 1);
		} finally {
			closeStoreDb(db);
		}
	});

	test("recordBaseline upserts one row per (kind, consumer_stage)", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			const first = publishArtifactCas(db, "r1", "prd", null);
			recordBaseline(db, "prd", "building-rtm", first.revisionId);

			writeDraftPrd(db, "r1", "bbb222");
			const second = publishArtifactCas(db, "r1", "prd", first.revisionId);
			recordBaseline(db, "prd", "building-rtm", second.revisionId);

			const rows = db
				.prepare("SELECT revision_id FROM baselines WHERE kind = 'prd' AND consumer_stage = 'building-rtm'")
				.all() as Array<{
				revision_id: number;
			}>;
			assert.equal(rows.length, 1, "upsert — still a single baseline row");
			assert.equal(rows[0]!.revision_id, second.revisionId, "baseline moved to the newer revision");
		} finally {
			closeStoreDb(db);
		}
	});

	test("snapshot yaml_bytes equal exportArtifactYaml output for the same envelope", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			const expectedYaml = exportArtifactYaml(db, "r1", "prd");
			publishArtifactCas(db, "r1", "prd", null);
			const row = db
				.prepare("SELECT yaml_bytes FROM artifact_revisions WHERE kind = 'prd' AND revision_number = 1")
				.get() as {
				yaml_bytes: string;
			};
			assert.equal(row.yaml_bytes, expectedYaml, "snapshot stores the exact deterministic export bytes");
		} finally {
			closeStoreDb(db);
		}
	});

	test("revision numbers are kind-scoped: a second kind starts at 1", () => {
		const db = openStoreDb(dbPath);
		try {
			writeDraftPrd(db, "r1", "aaa111");
			publishArtifactCas(db, "r1", "prd", null);
			writeArtifact(db, "rtm", "r1", { version: 1, stage: "building-rtm", generatedAt: "2026-09-27T00:00:00Z" }, {
				rtmRow: [{ id: "RTM-1", frRef: "FR-1", phase: 1, targetSha256: "abc" }],
			} as ArtifactPayload);
			const rtmHead = publishArtifactCas(db, "r1", "rtm", null);
			assert.equal(rtmHead.revisionNumber, 1, "rtm revisions are numbered independently of prd");
		} finally {
			closeStoreDb(db);
		}
	});
});
