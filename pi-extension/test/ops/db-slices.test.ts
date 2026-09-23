// Unit tests — ops/db-slices.ts (Phase 6 read flip, Subphase 3.1).
// Covers: STAGE_SLICE_KINDS ↔ STAGE_REGISTRY.inputs consistency, determinism
// (G5 — same rows in, same block out), compact renders (row content +
// ordering), the three LOUD refusal reasons (no-store-db / kind-unpublished /
// rows-lack-prose, each naming /velpari-backfill), and the prd empty-slice
// exception (brainstorm is the sole file-based input).
// Conventions: temp dirs + real openStoreDb/closeStoreDb — no mocks.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { writeArtifact, publishArtifact, type ArtifactEnvelopeInput } from "../../src/io/store.js";
import {
	STAGE_SLICE_KINDS,
	DOC_ARTIFACT_TO_KIND,
	renderStageSlice,
	resolveStageSlice,
	findMissingProse,
} from "../../src/ops/db-slices.js";
import { STAGE_REGISTRY, type StageKey } from "../../src/stages/registry.js";
import { buildStoreDbPath } from "../../src/core/paths.js";

const PROJECT = "alpha";

function env(overrides: Partial<ArtifactEnvelopeInput> = {}): ArtifactEnvelopeInput {
	return {
		version: 1,
		stage: "drafting-prd",
		generatedAt: "2026-09-23T00:00:00Z",
		inputs: "{}",
		reviewerVerdict: null,
		changeLog: "[]",
		...overrides,
	};
}

describe("ops/db-slices", () => {
	let dirs: string[] = [];

	beforeEach(() => {
		dirs.push(mkdtempSync(join(tmpdir(), "velpari-slices-")));
	});

	after(() => {
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	});

	/** Open + seed a project store at the canonical G10 path. */
	function seedStore(dir: string, seed: (db: ReturnType<typeof openStoreDb>) => void): void {
		const dbPath = buildStoreDbPath(PROJECT, dir);
		const db = openStoreDb(dbPath);
		try {
			seed(db);
		} finally {
			closeStoreDb(db);
		}
	}

	test("1. STAGE_SLICE_KINDS covers every doc input of every registry spec", () => {
		for (const key of Object.keys(STAGE_REGISTRY) as StageKey[]) {
			const expectedKinds = new Set(
				STAGE_REGISTRY[key].inputs
					.filter((i) => i.kind === "doc" && i.artifact)
					.map((i) => DOC_ARTIFACT_TO_KIND[i.artifact!]),
			);
			const actual = new Set(STAGE_SLICE_KINDS[key]);
			assert.deepEqual([...actual].sort(), [...expectedKinds].sort(), `slice kinds drift for stage ${key}`);
		}
	});

	test("2. prd has an empty slice (brainstorm is the sole file-based input)", () => {
		const dir = dirs[dirs.length - 1]!;
		const slice = resolveStageSlice(dir, PROJECT, "prd");
		assert.equal(slice.ok, true);
		if (slice.ok) {
			assert.equal(slice.block, "");
			assert.deepEqual(slice.kinds, []);
		}
	});

	test("3. refuse: no store DB", () => {
		const dir = dirs[dirs.length - 1]!;
		const slice = resolveStageSlice(dir, PROJECT, "rtm");
		assert.equal(slice.ok, false);
		if (!slice.ok) {
			assert.equal(slice.reason, "no-store-db");
			assert.match(slice.message, /\/velpari-backfill/);
		}
	});

	test("4. refuse: store exists but kind unpublished", () => {
		const dir = dirs[dirs.length - 1]!;
		seedStore(dir, () => {
			// empty store — no writes at all
		});
		const slice = resolveStageSlice(dir, PROJECT, "rtm");
		assert.equal(slice.ok, false);
		if (!slice.ok) {
			assert.equal(slice.reason, "kind-unpublished");
			assert.equal(slice.kind, "prd");
			assert.match(slice.message, /\/velpari-backfill prd/);
		}
	});

	test("5. refuse: published rows lack v002 prose (legacy v001 store)", () => {
		const dir = dirs[dirs.length - 1]!;
		seedStore(dir, (db) => {
			writeArtifact(db, "prd", "r1", env(), {
				fr: [{ id: "FR-1", phase: 1, textHash: "h1" }], // no text
				nfr: [{ id: "NFR-1", phase: 1, textHash: "h2" }],
			});
			publishArtifact(db, "r1", "prd");
		});
		const slice = resolveStageSlice(dir, PROJECT, "rtm");
		assert.equal(slice.ok, false);
		if (!slice.ok) {
			assert.equal(slice.reason, "rows-lack-prose");
			assert.equal(slice.kind, "prd");
			assert.match(slice.message, /\/velpari-backfill prd/);
		}
	});

	test("6. ok: rtm slice renders published prd rows with prose, deterministic", () => {
		const dir = dirs[dirs.length - 1]!;
		seedStore(dir, (db) => {
			writeArtifact(db, "prd", "r1", env(), {
				fr: [
					{ id: "FR-2", phase: 1, textHash: "h2", text: "Second req" },
					{ id: "FR-1", phase: 1, textHash: "h1", text: "First req" },
				],
				nfr: [{ id: "NFR-1", phase: 1, textHash: "h3", text: "Fast" }],
				prdSection: [{ no: 1, title: "Purpose", body: "Why" }],
			});
			publishArtifact(db, "r1", "prd");
		});
		const a = resolveStageSlice(dir, PROJECT, "rtm");
		const b = resolveStageSlice(dir, PROJECT, "rtm");
		assert.equal(a.ok, true);
		assert.equal(b.ok, true);
		if (a.ok && b.ok) {
			assert.equal(a.block, b.block); // G5 determinism
			// natural-key order even though FR-2 was inserted first
			assert.ok(a.block.indexOf("FR-1") < a.block.indexOf("FR-2"));
			assert.ok(a.block.includes("First req"));
			assert.ok(a.block.includes("Fast"));
			assert.ok(a.block.includes("Why"));
		}
	});

	test("7. renderStageSlice: atomic-functions + development-order compact tables", () => {
		const af = renderStageSlice("atomic-functions", {
			atomicFunction: [
				{
					id: "AF-1",
					name: "parse",
					signature: "parse(s: string)",
					tier: "basic",
					criticality: "A",
					sil: "none",
					isLeaf: 1,
					purpose: "split input",
				},
			],
		});
		assert.ok(af.includes("AF-1"));
		assert.ok(af.includes("split input"));
		assert.ok(af.includes("yes")); // isLeaf

		const dev = renderStageSlice("development-order", {
			devStep: [{ id: "S-1", module: "core", description: "build core" }],
			stepAf: [{ stepId: "S-1", afId: "AF-1" }],
			stepDep: [],
		});
		assert.ok(dev.includes("S-1"));
		assert.ok(dev.includes("build core"));
		assert.ok(dev.includes("AF-1"));
	});

	test("8. findMissingProse: null only when prose present or row-set absent", () => {
		assert.equal(
			findMissingProse("prd", {
				fr: [{ id: "FR-1", text: "x" }],
				nfr: [{ id: "NFR-1", text: null }],
			}),
			"nfr.text empty on all 1 row(s)",
		);
		assert.equal(
			findMissingProse("prd", {
				fr: [{ id: "FR-1", text: "x" }],
				nfr: [{ id: "NFR-1", text: "y" }],
			}),
			null,
		);
		// absent row-set → not a prose failure
		assert.equal(findMissingProse("pseudocode", {}), null);
		// optional-prose kinds never refuse
		assert.equal(findMissingProse("design", { designModule: [{ id: "M-1", description: null }] }), null);
	});

	test("9. multi-kind stage (pseudocode) requires BOTH kinds published", () => {
		const dir = dirs[dirs.length - 1]!;
		seedStore(dir, (db) => {
			writeArtifact(
				db,
				"design",
				"r1",
				{ ...env(), stage: "designing" },
				{
					designModule: [{ id: "M-1", name: "core", description: "does core" }],
				},
			);
			publishArtifact(db, "r1", "design");
			// atomic-functions NOT published → refuse names it
		});
		const slice = resolveStageSlice(dir, PROJECT, "pseudocode");
		assert.equal(slice.ok, false);
		if (!slice.ok) {
			assert.equal(slice.reason, "kind-unpublished");
			assert.equal(slice.kind, "atomic-functions");
			assert.match(slice.message, /\/velpari-backfill atomic-functions/);
		}
	});

	test("10. newest published version wins (version bump)", () => {
		const dir = dirs[dirs.length - 1]!;
		seedStore(dir, (db) => {
			writeArtifact(db, "prd", "r1", env(), {
				fr: [{ id: "FR-1", phase: 1, textHash: "h1", text: "v1 text" }],
			});
			publishArtifact(db, "r1", "prd");
			writeArtifact(
				db,
				"prd",
				"r2",
				{ ...env(), version: 2, generatedAt: "2026-09-23T01:00:00Z" },
				{
					fr: [{ id: "FR-1", phase: 1, textHash: "h1", text: "v2 text" }],
				},
			);
			publishArtifact(db, "r2", "prd");
		});
		const slice = resolveStageSlice(dir, PROJECT, "rtm");
		assert.equal(slice.ok, true);
		if (slice.ok) {
			assert.ok(slice.block.includes("v2 text"));
			assert.ok(!slice.block.includes("v1 text"));
			assert.ok(slice.block.includes("r2"));
		}
	});
});
