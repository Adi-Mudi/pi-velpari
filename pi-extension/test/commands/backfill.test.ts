// Unit tests — ops/backfill.ts (Phase 6 4.1 — /velpari-backfill import).
// Covers: legacy markdown → published store rows with v002 prose (PRD
// happy path, table + caption parsing), idempotent no-op on an already
// imported kind, refusal when no legacy source exists (naming the retry),
// refusal on unknown kind, and a second kind (development-order) proving
// the caption/header selection. Conventions: temp dirs under TMPDIR (set
// TMPDIR=/var/tmp locally — /tmp tmpfs quota breaks SQLite WAL) + real
// openStoreDb.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { backfillFromExport, backfillKind } from "../../src/ops/backfill.js";
import {
	readLatestPublishedRows,
	KIND_ORDER,
	writeArtifact,
	publishArtifact,
	exportArtifactYaml,
	type ArtifactEnvelopeInput,
} from "../../src/io/store.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { resolveStageSlice } from "../../src/ops/db-slices.js";

const PROJECT = "alpha";

const AF_ENV: ArtifactEnvelopeInput = {
	version: 1,
	stage: "analyzing-atomic-functions",
	generatedAt: "2026-09-23T00:00:00.000Z",
	inputs: "{}",
	reviewerVerdict: null,
	changeLog: "[]",
};

const PRD_MD = `# PSRS — alpha

## Functional Requirements

| ID | Phase | Requirement |
|---|---|---|
| FR-1 | 1 | The system shall parse input |
| FR-2 | 2 | The system shall export reports |

## Non-Functional Requirements

| ID | Phase | Requirement |
|---|---|---|
| NFR-1 | 1 | Response under 200ms |

## PRD Sections

| No | Title | Body |
|---|---|---|
| 1 | Purpose | Why we build this |
`;

const DEV_ORDER_MD = `# Development Order

## Development Steps

| ID | Module | Description |
|---|---|---|
| S-1 | core | build core first |

## Step Atomic Functions

| Step | AF |
|---|---|
| S-1 | AF-1 |

## Step Dependencies

| Step | Depends On |
|---|---|
| S-1 | — |
`;

describe("ops/backfill", () => {
	let dirs: string[] = [];

	beforeEach(() => {
		dirs.push(mkdtempSync(join(tmpdir(), "velpari-backfill-")));
	});

	after(() => {
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	});

	function writeDoc(dir: string, sub: string, artifact: string, markdown: string): void {
		const docDir = sub ? join(dir, "Doc", sub) : join(dir, "Doc");
		mkdirSync(docDir, { recursive: true });
		writeFileSync(join(docDir, `${artifact}_${PROJECT}.md`), markdown, "utf8");
	}

	test("1. import: legacy PRD markdown → published store rows with prose", () => {
		const dir = dirs[dirs.length - 1]!;
		writeDoc(dir, "requirements", "PRD", PRD_MD);
		const result = backfillKind(dir, PROJECT, "prd", "backfill-t1");
		assert.equal(result.ok, true, result.note);
		assert.equal(result.rowCount, 4); // 2 FR + 1 NFR + 1 section
		const read = readLatestPublishedRows(dir, PROJECT, "prd");
		assert.ok(read, "prd must be readable as newest published rows");
		assert.equal(read.envelope.status, "published");
		const fr = read.rows.fr as { id: string; text: string | null }[];
		assert.equal(fr.length, 2);
		assert.equal(fr.find((r) => r.id === "FR-1")?.text, "The system shall parse input");
	});

	test("2. idempotent: second backfill of an imported kind is a no-op", () => {
		const dir = dirs[dirs.length - 1]!;
		writeDoc(dir, "requirements", "PRD", PRD_MD);
		const first = backfillKind(dir, PROJECT, "prd", "backfill-t2a");
		assert.equal(first.ok, true);
		const second = backfillKind(dir, PROJECT, "prd", "backfill-t2b");
		assert.equal(second.ok, true);
		assert.match(second.note, /already present.*no-op/);
		assert.equal(second.rowCount, 0);
		// Still exactly one published version (the import did not bump).
		const read = readLatestPublishedRows(dir, PROJECT, "prd");
		assert.equal(read?.envelope.runId, "backfill-t2a");
	});

	test("3. refuse: no legacy source anywhere → ok:false naming the retry", () => {
		const dir = dirs[dirs.length - 1]!;
		const result = backfillKind(dir, PROJECT, "prd", "backfill-t3");
		assert.equal(result.ok, false);
		assert.match(result.note, /no parseable legacy source/);
		assert.match(result.note, /\/velpari-backfill prd/);
		assert.equal(readLatestPublishedRows(dir, PROJECT, "prd"), null);
	});

	test("4. refuse: unknown kind lists the legal kinds", () => {
		const dir = dirs[dirs.length - 1]!;
		const result = backfillKind(dir, PROJECT, "bogus" as never, "backfill-t4");
		assert.equal(result.ok, false);
		assert.match(result.note, /unknown kind/);
		for (const kind of KIND_ORDER) assert.ok(result.note.includes(kind), kind);
	});

	test("5. §14.5 loop: backfill prd unblocks the rtm stage slice", () => {
		const dir = dirs[dirs.length - 1]!;
		// Before: strict refuse names backfill.
		const before = resolveStageSlice(dir, PROJECT, "rtm");
		assert.equal(before.ok, false);
		if (!before.ok) assert.match(before.message, /\/velpari-backfill/);
		// Import, then the slice resolves.
		writeDoc(dir, "requirements", "PRD", PRD_MD);
		const backfill = backfillKind(dir, PROJECT, "prd", "backfill-t5");
		assert.equal(backfill.ok, true, backfill.note);
		const after = resolveStageSlice(dir, PROJECT, "rtm");
		assert.equal(after.ok, true);
		if (after.ok) assert.ok(after.block.includes("The system shall parse input"));
	});

	test("6. import: development-order markdown tables → steps + AF + dep edges", () => {
		const dir = dirs[dirs.length - 1]!;
		// Run-scoped FK: step_af.af_id → atomic_function(run_id, id) — the
		// upstream kind must be imported first under the SAME run id.
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			writeArtifact(db, "atomic-functions", "backfill-t6", AF_ENV, {
				atomicFunction: [
					{
						id: "AF-1",
						name: "parse",
						signature: "parse()",
						tier: "basic",
						criticality: "A",
						sil: "none",
						isLeaf: 1,
					},
				],
			});
			publishArtifact(db, "backfill-t6", "atomic-functions");
		} finally {
			closeStoreDb(db);
		}
		writeDoc(dir, "development-order", "development-order", DEV_ORDER_MD);
		const result = backfillKind(dir, PROJECT, "development-order", "backfill-t6");
		assert.equal(result.ok, true, result.note);
		const read = readLatestPublishedRows(dir, PROJECT, "development-order");
		assert.ok(read);
		const steps = read.rows.devStep as { id: string; description: string | null }[];
		assert.equal(steps.length, 1);
		assert.equal(steps[0]?.description, "build core first");
		assert.equal((read.rows.stepAf as unknown[]).length, 1);
	});

	test("7. FK refuse: development-order without upstream AF names the remedy", () => {
		const dir = dirs[dirs.length - 1]!;
		writeDoc(dir, "development-order", "development-order", DEV_ORDER_MD);
		const result = backfillKind(dir, PROJECT, "development-order", "backfill-t7");
		assert.equal(result.ok, false);
		assert.match(result.note, /atomic-functions/);
		assert.match(result.note, /\/velpari-backfill atomic-functions/);
	});
});

// ---------------------------------------------------------------------------
// Phase 9 — backfillFromExport (D9 made real): rebuild one kind from the
// store's own export YAML beside the DB.
// ---------------------------------------------------------------------------

describe("ops/backfill --from-export", () => {
	let dirs: string[] = [];

	beforeEach(() => {
		dirs.push(mkdtempSync(join(tmpdir(), "velpari-backfill-fe-")));
	});

	after(() => {
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	});

	/** Publish a PRD to the store and export its YAML beside the DB. */
	function seedStoreWithYaml(dir: string): void {
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			writeArtifact(
				db,
				"prd",
				"run-orig",
				{
					version: 1,
					stage: "drafting-prd",
					generatedAt: "2026-09-24T00:00:00.000Z",
					inputs: "{}",
					reviewerVerdict: null,
					changeLog: "[]",
				},
				{
					fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "The system shall parse input." }],
				},
			);
			publishArtifact(db, "run-orig", "prd");
			const yaml = exportArtifactYaml(db, "run-orig", "prd");
			assert.ok(yaml);
			mkdirSync(join(dir, "Doc", "store", PROJECT), { recursive: true });
			writeFileSync(join(dir, "Doc", "store", PROJECT, `PRD_${PROJECT}.yaml`), yaml, "utf8");
		} finally {
			closeStoreDb(db);
		}
	}

	test("1. rebuild: wipe rows → --from-export restores them under the YAML runId", () => {
		const dir = dirs[dirs.length - 1]!;
		seedStoreWithYaml(dir);
		// Wipe ALL rows (simulate the lost store the runbook rebuilds from).
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			db.exec("DELETE FROM artifacts; DELETE FROM fr;");
		} finally {
			closeStoreDb(db);
		}
		assert.equal(readLatestPublishedRows(dir, PROJECT, "prd"), null);
		const result = backfillFromExport(dir, PROJECT, "prd", "backfill");
		assert.equal(result.ok, true, result.note);
		assert.equal(result.rowCount, 1);
		const read = readLatestPublishedRows(dir, PROJECT, "prd");
		assert.ok(read);
		assert.equal(read.envelope.runId, "run-orig");
		assert.equal(read.envelope.status, "published");
		assert.equal((read.rows.fr as unknown[]).length, 1);
	});

	test("2. refuse: no export YAML for the kind → names the expected path", () => {
		const dir = dirs[dirs.length - 1]!;
		const result = backfillFromExport(dir, PROJECT, "prd", "backfill");
		assert.equal(result.ok, false);
		assert.match(result.note, /no export YAML found/);
		assert.ok(result.note.includes(`PRD_${PROJECT}.yaml`), result.note);
		assert.equal(readLatestPublishedRows(dir, PROJECT, "prd"), null);
	});

	test("3. refuse: schema-invalid YAML is not importable", () => {
		const dir = dirs[dirs.length - 1]!;
		mkdirSync(join(dir, "Doc", "store", PROJECT), { recursive: true });
		const badYaml = [
			"runId: r-bad",
			"kind: prd",
			"version: 1",
			"stage: s",
			"generatedAt: t",
			"rows:",
			"  bogus: []",
		].join("\n");
		writeFileSync(join(dir, "Doc", "store", PROJECT, `PRD_${PROJECT}.yaml`), badYaml, "utf8");
		const result = backfillFromExport(dir, PROJECT, "prd", "backfill");
		assert.equal(result.ok, false);
		assert.match(result.note, /unknown row-set 'bogus'/);
	});

	test("4. refuse: unknown kind lists the legal kinds", () => {
		const dir = dirs[dirs.length - 1]!;
		const result = backfillFromExport(dir, PROJECT, "bogus" as never, "backfill");
		assert.equal(result.ok, false);
		assert.match(result.note, /unknown kind/);
	});
});
