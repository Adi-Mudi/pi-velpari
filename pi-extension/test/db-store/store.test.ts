// Unit tests — io/store.ts (Phase 3: Store API).
// Covers: write/read round-trips (simple + complex kind), envelope upsert
// bump, idempotent rewrite, forced rollback, FK-through-API, publish flip,
// G5 golden byte-equality + byte-identical re-export, checksum ok/mismatch,
// deleteRunDrafts cascade scoping, checkpointNow, two-kinds coexist,
// nullable round-trip.
// Conventions: temp dirs + real openStoreDb/closeStoreDb — no mocks
// (tests written from driver behavior per Phase 1/2 retrospective lesson).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";
import {
	writeArtifact,
	readArtifact,
	exportArtifactYaml,
	verifyExportChecksum,
	deleteRunDrafts,
	checkpointNow,
	publishArtifact,
	type ArtifactEnvelopeInput,
} from "../../src/io/store.js";

/** Deterministic G5 golden: exportArtifactYaml('prd') bytes, captured from
 * the real driver (yaml stringify, lineWidth: 0, single trailing \n). */
const GOLDEN_PRD = [
	"runId: r1",
	"kind: prd",
	"version: 1",
	"stage: drafting-prd",
	"generatedAt: 2026-09-22T00:00:00Z",
	'inputs: "{}"',
	"reviewerVerdict: null",
	'changeLog: "[]"',
	"rows:",
	"  fr:",
	"    - id: FR-1",
	"      phase: 1",
	"      textHash: a1b2c3",
	"    - id: FR-2",
	"      phase: 1",
	"      textHash: d4e5f6",
	"  prdSection:",
	"    - no: 1",
	"      title: Purpose",
	"      bodyRef: null",
].join("\n") + "\n";

/** Envelope input with deterministic defaults; overrides per test. */
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

const FR_SEED = [
	{ id: "FR-1", phase: 1, textHash: "a1b2c3" },
	{ id: "FR-2", phase: 1, textHash: "d4e5f6" },
];

describe("io/store — Store API", () => {
	let dirs: string[] = [];
	let dbPath = "";
	let db: DatabaseSync;

	beforeEach(() => {
		const dir = mkdtempSync(join(tmpdir(), "velpari-store-"));
		dirs.push(dir);
		dbPath = join(dir, "index.db");
		db = openStoreDb(dbPath);
	});

	after(() => {
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	});

	test("1. write→read round-trip: prd (simple kind), every column exact", () => {
		writeArtifact(db, "prd", "r1", env(), {
			fr: FR_SEED,
			nfr: [{ id: "NFR-1", phase: 1, textHash: "n1" }],
			prdSection: [{ no: 1, title: "Purpose", bodyRef: null }],
		});
		const read = readArtifact(db, "r1", "prd");
		assert.ok(read);
		assert.equal(read.envelope.runId, "r1");
		assert.equal(read.envelope.kind, "prd");
		assert.equal(read.envelope.version, 1);
		assert.equal(read.envelope.status, "draft");
		assert.match(read.envelope.sha256Fingerprint, /^[0-9a-f]{64}$/);
		assert.deepEqual(read.rows.fr, FR_SEED);
		assert.deepEqual(read.rows.nfr, [{ id: "NFR-1", phase: 1, textHash: "n1" }]);
		assert.deepEqual(read.rows.prdSection, [
			{ no: 1, title: "Purpose", bodyRef: null },
		]);
	});

	test("2. write→read round-trip: design (complex kind, all 5 row-sets)", () => {
		// module_source_fr.fr_id FKs fr(id) — the prd write must land first.
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		writeArtifact(db, "design", "r1", { ...env(), stage: "designing" }, {
			designModule: [{ id: "M-1", name: "core" }],
			moduleSourceFr: [{ moduleId: "M-1", frId: "FR-1" }],
			adr: [
				{
					id: "ADR-1",
					adrStatus: "accepted",
					options: "A|B",
					chosen: "A",
					rationale: "least complexity",
				},
			],
			diagram: [{ id: "D-1", diagramKind: "context", mermaidText: "graph TD;" }],
			approach: [{ moduleId: "M-1", tacticId: "T-01" }],
		});
		const read = readArtifact(db, "r1", "design");
		assert.ok(read);
		assert.equal(read.envelope.kind, "design");
		assert.equal(read.envelope.status, "draft");
		assert.deepEqual(read.rows.designModule, [{ id: "M-1", name: "core" }]);
		assert.deepEqual(read.rows.moduleSourceFr, [
			{ moduleId: "M-1", frId: "FR-1" },
		]);
		assert.deepEqual(read.rows.adr, [
			{
				id: "ADR-1",
				adrStatus: "accepted",
				options: "A|B",
				chosen: "A",
				rationale: "least complexity",
			},
		]);
		assert.deepEqual(read.rows.diagram, [
			{ id: "D-1", diagramKind: "context", mermaidText: "graph TD;" },
		]);
		assert.deepEqual(read.rows.approach, [{ moduleId: "M-1", tacticId: "T-01" }]);
	});

	test("3. envelope upsert bumps version, refreshes generated_at + fingerprint", () => {
		writeArtifact(db, "prd", "r1", env({ version: 1 }), { fr: [FR_SEED[0]!] });
		const first = readArtifact(db, "r1", "prd");
		assert.ok(first);
		const fp1 = first.envelope.sha256Fingerprint;

		writeArtifact(db, "prd", "r1", env({ version: 2, generatedAt: "2026-09-22T09:30:00Z" }), {
			fr: [
				{ id: "FR-1", phase: 1, textHash: "CHANGED" },
				...FR_SEED.slice(1),
			],
		});
		const second = readArtifact(db, "r1", "prd");
		assert.ok(second);
		assert.equal(second.envelope.version, 2);
		assert.equal(second.envelope.generatedAt, "2026-09-22T09:30:00Z");
		assert.notEqual(second.envelope.sha256Fingerprint, fp1);
		assert.equal(second.envelope.status, "draft"); // rewrite re-opens draft
	});

	test("4. idempotent rewrite replaces child rows (no duplicates, stale gone)", () => {
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		writeArtifact(db, "prd", "r1", env(), {
			fr: [{ id: "FR-1", phase: 2, textHash: "fresh" }],
		});
		const read = readArtifact(db, "r1", "prd");
		assert.ok(read);
		assert.deepEqual(read.rows.fr, [{ id: "FR-1", phase: 2, textHash: "fresh" }]);
		const count = db
			.prepare("SELECT COUNT(*) AS n FROM fr WHERE run_id = ? AND kind = ?")
			.get("r1", "prd") as { n: number };
		assert.equal(Number(count.n), 1);
	});

	test("5. constraint failure mid-payload rolls the whole txn back", () => {
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		assert.throws(() =>
			writeArtifact(db, "rtm", "r1", env({ stage: "building-rtm" }), {
				rtmRow: [
					{ id: "RTM-1", frRef: "FR-MISSING", phase: 1, targetSha256: "x" },
				],
			}),
		);
		// Envelope absent, prior prd rows intact.
		assert.equal(readArtifact(db, "r1", "rtm"), null);
		const read = readArtifact(db, "r1", "prd");
		assert.ok(read);
		assert.deepEqual(read.rows.fr, FR_SEED);
		const rtmRows = db.prepare("SELECT COUNT(*) AS n FROM rtm_row").get() as {
			n: number;
		};
		assert.equal(Number(rtmRows.n), 0);
	});

	test("6. FK enforced through the API (pseudocode af_ref → missing AF)", () => {
		assert.throws(() =>
			writeArtifact(db, "pseudocode", "r1", env({ stage: "writing-pseudocode" }), {
				pseudocodeBlock: [{ id: "PC-1", afRef: "AF-MISSING", contentHash: "h" }],
			}),
		);
		assert.equal(readArtifact(db, "r1", "pseudocode"), null);
	});

	test("7. publishArtifact flips envelope + children atomically", () => {
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		publishArtifact(db, "r1", "prd");
		const read = readArtifact(db, "r1", "prd");
		assert.ok(read);
		assert.equal(read.envelope.status, "published");
		const statuses = (db
			.prepare("SELECT DISTINCT status FROM fr WHERE run_id = ? AND kind = ?")
			.all("r1", "prd") as { status: string }[]).map((r) => ({ status: r.status }));
		assert.deepEqual(statuses, [{ status: "published" }]);
		// No draft left → republish and unknown-kind publish both throw.
		assert.throws(() => publishArtifact(db, "r1", "prd"));
		assert.throws(() => publishArtifact(db, "rX", "prd"));
	});

	test("8. G5 golden: export byte-equals golden; re-export byte-identical", () => {
		writeArtifact(db, "prd", "r1", env(), {
			fr: FR_SEED,
			prdSection: [{ no: 1, title: "Purpose" }],
		});
		const first = exportArtifactYaml(db, "r1", "prd");
		assert.equal(first, GOLDEN_PRD);
		const second = exportArtifactYaml(db, "r1", "prd");
		assert.equal(second, first);
		const checksum = verifyExportChecksum(db, "r1", "prd");
		assert.equal(checksum.ok, true);
	});

	test("9. verifyExportChecksum detects a tampered fingerprint", () => {
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		const legit = verifyExportChecksum(db, "r1", "prd");
		assert.equal(legit.ok, true);
		db.exec(
			"UPDATE artifacts SET sha256_fingerprint = '" + "ab".repeat(32) + "' " +
				"WHERE run_id = 'r1' AND kind = 'prd'",
		);
		const tampered = verifyExportChecksum(db, "r1", "prd");
		assert.equal(tampered.ok, false);
		assert.equal(tampered.expected, "ab".repeat(32));
		assert.match(tampered.actual, /^[0-9a-f]{64}$/);
		assert.notEqual(tampered.actual, tampered.expected);
	});

	test("10. deleteRunDrafts cascades its run only; published rows survive", () => {
		// Distinct fr ids per run — fr.id is a GLOBAL natural PK (Risks note 6;
		// test 14 locks the cross-run conflict behavior itself).
		writeArtifact(db, "prd", "runA", env(), {
			fr: [{ id: "FR-A1", phase: 1, textHash: "a1" }],
		});
		writeArtifact(db, "prd", "runB", env(), {
			fr: [{ id: "FR-B1", phase: 1, textHash: "b1" }],
		});
		publishArtifact(db, "runB", "prd");

		assert.equal(deleteRunDrafts(db, "runA"), 1);
		assert.equal(readArtifact(db, "runA", "prd"), null); // draft + children gone
		const remaining = (db.prepare("SELECT id FROM fr").all() as {
			id: string;
		}[]).map((r) => r.id);
		assert.deepEqual(remaining, ["FR-B1"]); // runB's children survive
		const readB = readArtifact(db, "runB", "prd");
		assert.ok(readB);
		assert.equal(readB.envelope.status, "published");
		// deleteRunDrafts on a published-only run is a no-op.
		assert.equal(deleteRunDrafts(db, "runB"), 0);
	});

	test("11. checkpointNow truncates the WAL", () => {
		const walPath = `${dbPath}-wal`;
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED }); // WAL activity
		const result = checkpointNow(db);
		assert.equal(result.busy, 0);
		if (existsSync(walPath)) {
			assert.equal(statSync(walPath).size, 0, "WAL must truncate to 0 bytes");
		}
	});

	test("12. two kinds in one run coexist (envelope PK disambiguates)", () => {
		writeArtifact(db, "prd", "r1", env(), { fr: FR_SEED });
		writeArtifact(db, "rtm", "r1", env({ stage: "building-rtm" }), {
			rtmRow: [
				{ id: "RTM-1", frRef: "FR-1", phase: 1, targetSha256: "t1" },
			],
		});
		const prd = readArtifact(db, "r1", "prd");
		const rtm = readArtifact(db, "r1", "rtm");
		assert.ok(prd);
		assert.ok(rtm);
		assert.equal(prd.envelope.kind, "prd");
		assert.equal(rtm.envelope.kind, "rtm");
		assert.deepEqual(rtm.rows.rtmRow, [
			{ id: "RTM-1", frRef: "FR-1", afRef: null, tcRef: null, phase: 1, targetSha256: "t1" },
		]);
	});

	test("13. nullable columns round-trip as null (feasibility)", () => {
		writeArtifact(db, "feasibility", "r1", env({ stage: "analyzing-feasibility" }), {
			feasibilityDecision: { verdict: "go", decidedBy: "user", at: "2026-09-22T00:00:00Z" },
			feasibilitySpike: [{ language: "typescript", passed: 1 }],
			reuseScan: [{ candidate: "lib-a", verdict: "reuse" }],
		});
		const read = readArtifact(db, "r1", "feasibility");
		assert.ok(read);
		const decision = read.rows.feasibilityDecision as Record<string, unknown>;
		assert.deepEqual(decision, {
			verdict: "go",
			language: null,
			decidedBy: "user",
			at: "2026-09-22T00:00:00Z",
			webSearchConsent: null,
		});
		const spikes = read.rows.feasibilitySpike as Record<string, unknown>[];
		assert.deepEqual(spikes, [
			{ language: "typescript", passed: 1, resultRef: null },
		]);
		const scans = read.rows.reuseScan as Record<string, unknown>[];
		assert.deepEqual(scans, [
			{ candidate: "lib-a", license: null, repoFreshness: null, verdict: "reuse" },
		]);
	});

	test("14. cross-run natural-PK conflict is loud (Risks note 6 behavior lock)", () => {
		// fr.id is a GLOBAL natural PK (approved v001 design). A second run
		// writing the same id PK-conflicts and the whole txn rolls back —
		// recorded here as executable proof of the Phase 4 planning
		// prerequisite (update-mode semantics MUST resolve this later).
		writeArtifact(db, "prd", "run1", env(), { fr: FR_SEED });
		assert.throws(() =>
			writeArtifact(db, "prd", "run2", env(), { fr: FR_SEED }),
			/UNIQUE constraint failed: fr\.id/,
		);
		// run2's envelope was rolled back with its rows.
		assert.equal(readArtifact(db, "run2", "prd"), null);
		// run1 is untouched.
		const read1 = readArtifact(db, "run1", "prd");
		assert.ok(read1);
		assert.deepEqual(read1.rows.fr, FR_SEED);
	});
});
