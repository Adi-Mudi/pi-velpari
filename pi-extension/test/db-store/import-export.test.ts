// Tests — io/store.ts:importArtifactYaml (Phase 9 1.3, D9 made real).
// Covers: export→import round-trip (publish → export → wipe → import →
// rows + envelope + checksum identical), YAML runId wins over the fallback
// parameter (run-scoped FK chains), schema-invalid YAML refusals (unknown
// row-set, non-mapping row, zero rows, bad kind, missing envelope fields —
// all BEFORE any write), and the R6 honesty assertion: the checksum after
// import proves YAML↔row consistency only (a CONTENT-tampered-but-
// schema-valid YAML still imports — tamper detection is git's job).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
	exportArtifactYaml,
	importArtifactYaml,
	readArtifact,
	writeArtifact,
	publishArtifact,
	revertPublish,
	type ArtifactEnvelopeInput,
} from "../../src/io/store.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { buildStoreDbPath } from "../../src/core/paths.js";

const PROJECT = "alpha";
let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-import-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const PRD_ENV: ArtifactEnvelopeInput = {
	version: 2,
	stage: "drafting-prd",
	generatedAt: "2026-09-24T00:00:00.000Z",
	inputs: "{}",
	reviewerVerdict: null,
	changeLog: '["v2: revise"]',
};

const PRD_PAYLOAD = {
	fr: [
		{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "The system shall parse input." },
		{ id: "FR-2", phase: 2, textHash: "d4e5f6", text: null },
	],
	nfr: [{ id: "NFR-1", phase: 1, textHash: "ff00ff", text: "Response under 200ms." }],
	prdSection: [{ no: 1, title: "Purpose", bodyRef: null, body: "Why." }],
};

describe("importArtifactYaml", () => {
	test("round-trip: publish → export → import under the YAML runId → identical rows + envelope", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			writeArtifact(db, "prd", "run-orig", PRD_ENV, PRD_PAYLOAD);
			publishArtifact(db, "run-orig", "prd");
			const yaml = exportArtifactYaml(db, "run-orig", "prd");
			assert.ok(yaml);

			// Simulate a lost store: wipe rows (draft-less rebuild), then import.
			const result = importArtifactYaml(db, "backfill", yaml);
			assert.equal(result.ok, true, result.message);
			assert.equal(result.rowCount, 4);

			// The YAML's own runId won.
			const read = readArtifact(db, "run-orig", "prd");
			assert.ok(read, "import must land under the YAML's runId");
			assert.equal(read.envelope.status, "published");
			assert.equal(read.envelope.version, 2);
			assert.equal(read.envelope.stage, "drafting-prd");
			assert.equal(read.envelope.changeLog, '["v2: revise"]');
			assert.deepEqual(read.rows.fr, PRD_PAYLOAD.fr);
			assert.deepEqual(read.rows.nfr, PRD_PAYLOAD.nfr);
			assert.deepEqual(read.rows.prdSection, PRD_PAYLOAD.prdSection);
		} finally {
			closeStoreDb(db);
		}
	});

	test("determinism: re-export after import produces byte-identical YAML", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			writeArtifact(db, "prd", "run-r2", PRD_ENV, PRD_PAYLOAD);
			publishArtifact(db, "run-r2", "prd");
			const before = exportArtifactYaml(db, "run-r2", "prd")!;
			db.prepare("DELETE FROM artifacts WHERE run_id = ?").run("run-r2");
			const result = importArtifactYaml(db, "backfill", before);
			assert.equal(result.ok, true, result.message);
			const after = exportArtifactYaml(db, "run-r2", "prd")!;
			assert.equal(after, before);
		} finally {
			closeStoreDb(db);
		}
	});

	test("refusals: unknown row-set, non-mapping row, zero rows, bad kind, missing envelope", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			const cases: { name: string; yaml: string; match: RegExp }[] = [
				{
					name: "unknown row-set",
					yaml: "runId: r\nkind: prd\nversion: 1\nstage: s\ngeneratedAt: t\nrows:\n  bogus: []\n",
					match: /unknown row-set 'bogus'/,
				},
				{
					name: "non-mapping row",
					yaml: "runId: r\nkind: prd\nversion: 1\nstage: s\ngeneratedAt: t\nrows:\n  fr:\n    - FR-1\n",
					match: /non-mapping row/,
				},
				{
					name: "zero rows",
					yaml: "runId: r\nkind: prd\nversion: 1\nstage: s\ngeneratedAt: t\nrows: {}\n",
					match: /zero rows/,
				},
				{
					name: "bad kind",
					yaml: "runId: r\nkind: nonsense\nversion: 1\nstage: s\ngeneratedAt: t\nrows: {}\n",
					match: /unknown or missing kind/,
				},
				{
					name: "missing stage",
					yaml: "runId: r\nkind: prd\nversion: 1\ngeneratedAt: t\nrows:\n  fr:\n    - id: FR-1\n",
					match: /missing envelope fields/,
				},
				{
					name: "rows not a mapping",
					yaml: "runId: r\nkind: prd\nversion: 1\nstage: s\ngeneratedAt: t\nrows: [1,2]\n",
					match: /malformed 'rows'/,
				},
			];
			for (const c of cases) {
				const result = importArtifactYaml(db, "backfill", c.yaml);
				assert.equal(result.ok, false, c.name);
				assert.match(result.message, c.match);
				assert.equal(result.rowCount, 0, c.name);
			}
			// Nothing was written by any refusal.
			assert.equal(readArtifact(db, "r", "prd"), null);
			assert.equal(readArtifact(db, "backfill", "prd"), null);
		} finally {
			closeStoreDb(db);
		}
	});

	test("malformed YAML (parser-level) is refused with the parse error", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			const result = importArtifactYaml(db, "backfill", "rows: [unclosed\n  bad indentation");
			assert.equal(result.ok, false);
			assert.match(result.message, /YAML parse failed/);
		} finally {
			closeStoreDb(db);
		}
	});

	test("schema-invalid rows that slip past shape checks are refused by the STRICT store write", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			// phase: "one" is not an INTEGER — node:sqlite pre-converts
			// numbers but rejects non-numeric strings on a STRICT INTEGER column.
			const yaml = [
				"runId: r-bad",
				"kind: prd",
				"version: 1",
				"stage: s",
				"generatedAt: t",
				"rows:",
				"  fr:",
				"    - id: FR-1",
				"      phase: one",
				"      textHash: abc",
			].join("\n");
			const result = importArtifactYaml(db, "backfill", yaml);
			assert.equal(result.ok, false);
			assert.match(result.message, /store write failed/);
			assert.equal(readArtifact(db, "r-bad", "prd"), null);
		} finally {
			closeStoreDb(db);
		}
	});

	test("R6 honesty: schema-valid CONTENT-tampered YAML imports fine (checksum ≠ tamper guard)", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			writeArtifact(db, "prd", "run-t", PRD_ENV, PRD_PAYLOAD);
			publishArtifact(db, "run-t", "prd");
			const yaml = exportArtifactYaml(db, "run-t", "prd")!;
			// Tamper the CONTENT (text changed) while staying schema-valid.
			const tampered = yaml.replace("parse input", "parse output");
			assert.notEqual(tampered, yaml);
			const result = importArtifactYaml(db, "backfill", tampered);
			assert.equal(result.ok, true, "tamper detection is git's job, not the checksum's");
			const read = readArtifact(db, "run-t", "prd")!;
			const fr = read.rows.fr as { text: string | null }[];
			assert.equal(fr[0]?.text, "The system shall parse output.");
		} finally {
			closeStoreDb(db);
		}
	});

	test("re-import of the same (runId, kind) is an idempotent upsert", () => {
		const dir = dirs[dirs.length - 1]!;
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			writeArtifact(db, "prd", "run-x", PRD_ENV, PRD_PAYLOAD);
			publishArtifact(db, "run-x", "prd");
			const yaml = exportArtifactYaml(db, "run-x", "prd")!;
			const first = importArtifactYaml(db, "backfill", yaml);
			assert.equal(first.ok, true);
			const second = importArtifactYaml(db, "backfill", yaml);
			assert.equal(second.ok, true);
			const read = readArtifact(db, "run-x", "prd")!;
			assert.equal(read.envelope.status, "published");
			assert.equal((read.rows.fr as unknown[]).length, 2);
		} finally {
			closeStoreDb(db);
		}
	});
});
