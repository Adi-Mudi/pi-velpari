// Unit tests — ops/export-revision.ts (Phase 4 revision-aware export).
// Covers: listExportableRevisions wrapper (ascending, withdrawn filtered),
// yaml = exact stored snapshot bytes (never re-rendered), md/html re-render
// from snapshot bytes through the shared renderers, refusals (unknown id,
// withdrawn F16, overwrite contract), audit entry with revision_number,
// buildRevisionExportPath.
// Conventions: temp dirs + real openStoreDb/closeStoreDb — no mocks
// (tests written from driver behavior).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { writeArtifact, publishArtifactCas, exportArtifactYaml, type ArtifactPayload } from "../../src/io/store.js";
import type { DatabaseSync } from "node:sqlite";
import { listExportableRevisions, runRevisionExport, buildRevisionExportPath } from "../../src/ops/export-revision.js";
import { withdrawRevision } from "../../src/ops/protection.js";

/** Minimal PRD payload; textHash varies per revision (content change proof). */
function prdPayload(textHash: string): ArtifactPayload {
	return {
		fr: [{ id: "FR-1", phase: 1, textHash, text: `Prose for ${textHash}.` }],
		nfr: [{ id: "NFR-1", phase: 1, textHash: `n-${textHash}` }],
		prdSection: [{ no: 1, title: "Purpose", bodyRef: null, body: `Body ${textHash}` }],
	};
}

/** Write + CAS-publish one PRD revision for `runId`. */
function publishSeed(
	db: DatabaseSync,
	runId: string,
	textHash: string,
	version: number,
	expectedHead: number | null,
): number {
	writeArtifact(
		db,
		"prd",
		runId,
		{ version, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" },
		prdPayload(textHash),
	);
	return publishArtifactCas(db, runId, "prd", expectedHead).revisionId;
}

let dir: string;
let dbPath: string;
let db: DatabaseSync;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-export-rev-"));
	dbPath = join(dir, "index.db");
	db = openStoreDb(dbPath);
});

after(() => {
	closeStoreDb(db);
	rmSync(dir, { recursive: true, force: true });
});

/** Seed two revisions of ONE run (supersession chains are per run_id —
 * artifacts.head_revision_id lives on the run's working row; a rewrite
 * re-opens the draft cycle and CAS supersedes the prior revision). */
function seedTwoRevisions(): { rev1: number; rev2: number } {
	const rev1 = publishSeed(db, "r1", "aaa111", 1, null);
	const rev2 = publishSeed(db, "r1", "bbb222", 2, rev1);
	return { rev1, rev2 };
}

// ---------------------------------------------------------------------------
// listExportableRevisions (wrapper — Fix 1: no store.ts change)
// ---------------------------------------------------------------------------

describe("listExportableRevisions", () => {
	test("ascending by revision_number, statuses follow the supersession chain", () => {
		const { rev1, rev2 } = seedTwoRevisions();
		const list = listExportableRevisions(db, "prd");
		assert.deepEqual(
			list.map((r) => r.revisionNumber),
			[1, 2],
		);
		assert.deepEqual(
			list.map((r) => r.revisionId),
			[rev1, rev2],
		);
		assert.deepEqual(
			list.map((r) => r.status),
			["superseded", "published"],
		);
		assert.equal(list[1]!.publishedAt.length > 0, true);
	});

	test("withdrawn revisions are filtered out", () => {
		const { rev1 } = seedTwoRevisions();
		const out = withdrawRevision(db, { kind: "prd", revisionId: rev1, reason: "test tombstone", actor: "test" });
		assert.equal(out.ok, true);
		const list = listExportableRevisions(db, "prd");
		assert.deepEqual(
			list.map((r) => r.revisionNumber),
			[2],
		);
	});

	test("empty kind → empty list", () => {
		assert.deepEqual(listExportableRevisions(db, "rtm"), []);
	});
});

// ---------------------------------------------------------------------------
// runRevisionExport
// ---------------------------------------------------------------------------

describe("runRevisionExport — yaml", () => {
	test("exports the EXACT stored snapshot bytes (never re-rendered)", () => {
		const { rev1 } = seedTwoRevisions();
		const stored = db.prepare("SELECT yaml_bytes FROM artifact_revisions WHERE revision_id = ?").get(rev1) as {
			yaml_bytes: string;
		};
		const outPath = join(dir, "out.yaml");
		const result = runRevisionExport({ dbPath, revisionId: rev1, format: "yaml", outputPath: outPath });
		assert.equal(result.ok, true);
		assert.equal(result.revisionNumber, 1);
		assert.equal(readFileSync(outPath, "utf8"), stored.yaml_bytes);
	});

	test("old revision bytes differ from the new revision's (F9 immutability proof)", () => {
		const { rev1, rev2 } = seedTwoRevisions();
		const oldOut = join(dir, "old.yaml");
		const newOut = join(dir, "new.yaml");
		assert.equal(runRevisionExport({ dbPath, revisionId: rev1, format: "yaml", outputPath: oldOut }).ok, true);
		assert.equal(runRevisionExport({ dbPath, revisionId: rev2, format: "yaml", outputPath: newOut }).ok, true);
		const oldBytes = readFileSync(oldOut, "utf8");
		const newBytes = readFileSync(newOut, "utf8");
		assert.notEqual(oldBytes, newBytes);
		assert.match(oldBytes, /aaa111/);
		assert.match(newBytes, /bbb222/);
	});

	test("superseded-revision yaml equals what exportArtifactYaml produced at publish time", () => {
		// Byte-identity with the publish-time sidecar family: the snapshot
		// was stored by publishArtifactCas from exportArtifactYaml; a fresh
		// export of the SAME head content must equal the stored bytes.
		const { rev2 } = seedTwoRevisions();
		const stored = db.prepare("SELECT yaml_bytes FROM artifact_revisions WHERE revision_id = ?").get(rev2) as {
			yaml_bytes: string;
		};
		assert.equal(stored.yaml_bytes, exportArtifactYaml(db, "r1", "prd"));
	});
});

describe("runRevisionExport — md/html", () => {
	test("md renders the OLD rows from snapshot bytes (old content, new excluded)", () => {
		const { rev1 } = seedTwoRevisions();
		const outPath = join(dir, "old.md");
		const result = runRevisionExport({ dbPath, revisionId: rev1, format: "md", outputPath: outPath });
		assert.equal(result.ok, true);
		const md = readFileSync(outPath, "utf8");
		assert.match(md, /aaa111/);
		assert.doesNotMatch(md, /bbb222/);
		assert.match(md, /# PRD \(version 1\)/);
	});

	test("html wraps the md render", () => {
		const { rev2 } = seedTwoRevisions();
		const outPath = join(dir, "new.html");
		const result = runRevisionExport({ dbPath, revisionId: rev2, format: "html", outputPath: outPath });
		assert.equal(result.ok, true);
		const html = readFileSync(outPath, "utf8");
		assert.match(html, /<!DOCTYPE html>/);
		assert.match(html, /bbb222/);
	});

	test("md returns row counts", () => {
		const { rev1 } = seedTwoRevisions();
		const result = runRevisionExport({
			dbPath,
			revisionId: rev1,
			format: "md",
			outputPath: join(dir, "counted.md"),
		});
		assert.equal(result.ok, true);
		assert.equal(result.counts?.fr, 1);
		assert.equal(result.counts?.nfr, 1);
		assert.equal(result.counts?.prdSection, 1);
	});
});

describe("runRevisionExport — refusals + audit", () => {
	test("missing DB → ok:false", () => {
		const result = runRevisionExport({
			dbPath: join(dir, "missing.db"),
			revisionId: 1,
			format: "yaml",
			outputPath: join(dir, "x.yaml"),
		});
		assert.equal(result.ok, false);
		assert.match(result.problem ?? "", /not found/);
	});

	test("unknown revision id → ok:false", () => {
		const result = runRevisionExport({ dbPath, revisionId: 99999, format: "yaml", outputPath: join(dir, "x.yaml") });
		assert.equal(result.ok, false);
		assert.match(result.problem ?? "", /no revision/);
	});

	test("withdrawn revision refused (F16)", () => {
		const { rev1 } = seedTwoRevisions();
		assert.equal(withdrawRevision(db, { kind: "prd", revisionId: rev1, reason: "tombstone", actor: "test" }).ok, true);
		const result = runRevisionExport({ dbPath, revisionId: rev1, format: "yaml", outputPath: join(dir, "w.yaml") });
		assert.equal(result.ok, false);
		assert.match(result.problem ?? "", /tombstoned/);
	});

	test("overwrite contract: refuse without overwrite, succeed with it", () => {
		const { rev1 } = seedTwoRevisions();
		const outPath = join(dir, "same.yaml");
		assert.equal(runRevisionExport({ dbPath, revisionId: rev1, format: "yaml", outputPath: outPath }).ok, true);
		const refused = runRevisionExport({ dbPath, revisionId: rev1, format: "yaml", outputPath: outPath });
		assert.equal(refused.ok, false);
		assert.match(refused.problem ?? "", /already exists/);
		const overwritten = runRevisionExport({
			dbPath,
			revisionId: rev1,
			format: "yaml",
			outputPath: outPath,
			overwrite: true,
		});
		assert.equal(overwritten.ok, true);
	});

	test("audit entry with revision_number recorded after a successful export", () => {
		const { rev1 } = seedTwoRevisions();
		assert.equal(
			runRevisionExport({ dbPath, revisionId: rev1, format: "yaml", outputPath: join(dir, "audit.yaml") }).ok,
			true,
		);
		const row = db
			.prepare(
				"SELECT action, revision_number, actor FROM audit_ledger WHERE action = 'export' ORDER BY entry_id DESC LIMIT 1",
			)
			.get() as { action: string; revision_number: number; actor: string };
		assert.equal(row.action, "export");
		assert.equal(row.revision_number, 1);
		assert.equal(row.actor, "velpari-export");
	});
});

// ---------------------------------------------------------------------------
// buildRevisionExportPath
// ---------------------------------------------------------------------------

describe("buildRevisionExportPath", () => {
	test("Doc/export/<project>/<Label>_<project>_rev<N>.<ext>", () => {
		const p = buildRevisionExportPath("Todo App", "prd", 3, "yaml", dir);
		assert.equal(p, join(dir, "Doc", "export", "Todo-App", "PRD_Todo-App_rev3.yaml"));
	});

	test("kind labels match the head exporter family", () => {
		assert.match(buildRevisionExportPath("p", "development-order", 1, "md", dir), /development-order_p_rev1\.md$/);
	});
});
