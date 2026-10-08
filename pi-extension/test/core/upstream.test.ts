// Tests — core/upstream.ts (Phase 5, N8 A/B split).
// Seeds real store revisions (pattern: test/db-store/revisions.test.ts) for two
// runs of the same project and asserts: own-run vs foreign-run classification,
// "my line never published it" (no delta), no-store/no-revision → null, the R5
// commit lookup in a real git fixture, the artifact→kind mapping (including the
// brainstorm/file-only null), and a drift pin against ops/db-slices.ts.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { publishArtifactCas, writeArtifact, type ArtifactPayload } from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import {
	ARTIFACT_TO_KIND,
	artifactKindForItem,
	classifyMove,
	newestPublishedHead,
	publishedHeadsForKind,
} from "../../src/core/upstream.js";
import { DOC_ARTIFACT_TO_KIND } from "../../src/ops/db-slices.js";
import type { StaleItem } from "../../src/core/freshness.js";

const PROJECT = "TestApp";
const IDENT = ["-c", "user.email=velpari@test.local", "-c", "user.name=Velpari Test"];

let dirs: string[] = [];

function freshDir(prefix = "velpari-upstream-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Write + publish one minimal PRD revision for `runId`; returns its number. */
function publishPrd(dir: string, runId: string, textHash: string): number {
	const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
	try {
		writeArtifact(db, "prd", runId, { version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" }, {
			fr: [{ id: "FR-1", phase: 1, textHash, text: `Prose for ${textHash}.` }],
		} as ArtifactPayload);
		return publishArtifactCas(db, runId, "prd", null).revisionNumber;
	} finally {
		closeStoreDb(db);
	}
}

function staleItem(artifact: string): StaleItem {
	return {
		key: `${artifact}:${PROJECT}`,
		artifact,
		path: "Doc/x.md",
		reason: "input-changed",
		changedInputs: ["prd"],
	};
}

describe("classifyMove — N8 A/B split", () => {
	let dir: string;
	beforeEach(() => {
		dir = freshDir();
	});

	test("my own line published the newest revision → own-run", () => {
		publishPrd(dir, "run-A", "aaa111");
		const move = classifyMove(dir, PROJECT, "run-A", "prd");
		assert.equal(move!.move, "own-run");
		assert.equal(move!.publishedHead.runId, "run-A");
		assert.equal(move!.publishedHead.revisionNumber, 1);
		assert.equal(move!.myRevisionNumber, 1);
		assert.deepEqual(move!.otherRuns, []);
	});

	test("another run published a newer revision → foreign-run with run + revision", () => {
		publishPrd(dir, "run-A", "aaa111");
		publishPrd(dir, "run-B", "bbb222"); // global revision 2, run-B's own head

		const move = classifyMove(dir, PROJECT, "run-A", "prd");
		assert.equal(move!.move, "foreign-run");
		assert.equal(move!.publishedHead.runId, "run-B");
		assert.equal(move!.publishedHead.revisionNumber, 2);
		assert.equal(move!.myRevisionNumber, 1, "my line is still at revision 1");
		assert.deepEqual(move!.otherRuns, ["run-B"]);
	});

	test("my line never published the kind → foreign-run, no delta claimed", () => {
		publishPrd(dir, "run-A", "aaa111");
		const move = classifyMove(dir, PROJECT, "run-C", "prd");
		assert.equal(move!.move, "foreign-run");
		assert.equal(move!.myRevisionNumber, null);
		assert.equal(move!.publishedHead.runId, "run-A");
	});

	test("no store and no published revision → null (never guessed)", () => {
		assert.equal(classifyMove(dir, PROJECT, "run-A", "prd"), null);
		assert.equal(classifyMove(dir, "", "run-A", "prd"), null);
		assert.equal(newestPublishedHead(dir, PROJECT, "prd"), null);

		publishPrd(dir, "run-A", "aaa111");
		assert.equal(classifyMove(dir, PROJECT, "run-A", "rtm"), null); // nothing published for rtm
	});

	test("publishedHeadsForKind returns every published revision, newest first", () => {
		publishPrd(dir, "run-A", "aaa111");
		publishPrd(dir, "run-B", "bbb222");
		const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
		try {
			const heads = publishedHeadsForKind(db, "prd");
			assert.deepEqual(
				heads.map((h) => h.revisionNumber),
				[2, 1],
			);
			assert.deepEqual(
				heads.map((h) => h.runId),
				["run-B", "run-A"],
			);
			assert.ok(heads[0]!.fingerprint.length > 0);
		} finally {
			closeStoreDb(db);
		}
	});

	test("storeLastCommit (R5) resolves the commit that touched the store DB", () => {
		execFileSync("git", ["init", "-b", "trunk"], { cwd: dir });
		publishPrd(dir, "run-A", "aaa111");
		execFileSync("git", ["add", "-A"], { cwd: dir });
		execFileSync("git", [...IDENT, "commit", "-m", "store"], { cwd: dir });

		const move = classifyMove(dir, PROJECT, "run-A", "prd");
		assert.match(move!.storeLastCommit!, /^[0-9a-f]{7,}$/);
	});
});

describe("artifactKindForItem + drift pin", () => {
	test("lowercase artifact names map to store kinds; brainstorm is file-only (null)", () => {
		assert.equal(artifactKindForItem(staleItem("prd")), "prd");
		assert.equal(artifactKindForItem(staleItem("test-plan")), "testplan");
		assert.equal(artifactKindForItem(staleItem("test-cases")), "testplan");
		assert.equal(artifactKindForItem(staleItem("feasibility-study")), "feasibility");
		assert.equal(artifactKindForItem(staleItem("brainstorm")), null);
		assert.equal(artifactKindForItem(staleItem("nonsense")), null);
	});

	test("the two artifact→kind tables cannot drift apart", () => {
		const fromOps: Record<string, string> = {};
		for (const [artifact, kind] of Object.entries(DOC_ARTIFACT_TO_KIND)) {
			fromOps[artifact.toLowerCase()] = kind;
		}
		assert.deepEqual(ARTIFACT_TO_KIND, fromOps);
	});
});

