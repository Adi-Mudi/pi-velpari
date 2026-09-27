// Unit tests — ops/retention.ts (Phase 4 keep-last-N retention, N7 + Fix 2).
// Covers: scanRetention (pure read; "all" → empty plan; keep-N window;
// head + baselined protection even beyond N), pruneRetentions (audited
// per-revision prune, row deletion, head/FK safety, guarded delete,
// explicit-path git commit — Fix 2).
// Conventions: temp dirs + real openStoreDb/closeStoreDb; git commit is
// exercised against a temp git repo when git is usable, warnings-only
// otherwise (commitProtectionChange contract — never throws).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { writeArtifact, publishArtifactCas, recordBaseline, type ArtifactPayload } from "../../src/io/store.js";
import type { DatabaseSync } from "node:sqlite";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { scanRetention, pruneRetentions } from "../../src/ops/retention.js";
import { withdrawRevision } from "../../src/ops/protection.js";

/** Minimal PRD payload; textHash varies per revision. */
function prdPayload(textHash: string): ArtifactPayload {
	return { fr: [{ id: "FR-1", phase: 1, textHash }] };
}

let dir: string;
let dbPath: string;
let db: DatabaseSync;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-retention-"));
	dbPath = buildStoreDbPath("Project", dir);
	db = openStoreDb(dbPath);
});

after(() => {
	closeStoreDb(db);
	rmSync(dir, { recursive: true, force: true });
});

/**
 * Seed `count` revisions of one run (supersession chains are per run_id).
 * @returns {number[]} Revision ids, oldest first.
 */
function seedRevisions(count: number): number[] {
	const ids: number[] = [];
	let head: number | null = null;
	for (let i = 1; i <= count; i++) {
		writeArtifact(
			db,
			"prd",
			"r1",
			{ version: i, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" },
			prdPayload(`hash-${i}`),
		);
		head = publishArtifactCas(db, "r1", "prd", head).revisionId;
		ids.push(head);
	}
	return ids;
}

/** Write a files.json with the given retention block (F shape, v4). */
function writeRetentionConfig(revisions: number | "all"): void {
	const cfg = {
		version: 4,
		projectName: "Project",
		codePaths: [],
		inputDocuments: [],
		testPaths: [],
		outputPaths: {},
		excludedPaths: [],
		velpari: { retention: { revisions } },
	};
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(dir, ".pi", "velpari", "files.json"), JSON.stringify(cfg), "utf8");
}

describe("scanRetention", () => {
	test('"all" (default) → empty plan even with many revisions', () => {
		seedRevisions(4);
		const scan = scanRetention(dir, "Project");
		assert.equal(scan.config.revisions, "all");
		assert.equal(scan.prunableCount, 0);
		assert.deepEqual(scan.perKind, []);
	});

	test("missing DB → empty plan, config still resolved", () => {
		writeRetentionConfig(2);
		const scan = scanRetention(dir, "NoSuchProject");
		assert.equal(scan.config.revisions, 2);
		assert.equal(scan.prunableCount, 0);
	});

	test("keep-N window: 5 revisions, keep 2 → 3 oldest prunable, head protected", () => {
		seedRevisions(5);
		writeRetentionConfig(2);
		const scan = scanRetention(dir, "Project");
		assert.equal(scan.prunableCount, 3);
		const prd = scan.perKind.find((k) => k.kind === "prd")!;
		assert.equal(prd.total, 5);
		assert.equal(prd.protectedCount, 0);
		assert.deepEqual(
			prd.prunable.map((c) => c.revisionNumber),
			[1, 2, 3],
			"oldest beyond the window, head (5) + in-window rows excluded",
		);
	});

	test("baselined revision beyond the window is protected, not prunable", () => {
		const ids = seedRevisions(5);
		recordBaseline(db, "prd", "building-rtm", ids[1]!); // rev 2 — beyond keep-2
		writeRetentionConfig(2);
		const scan = scanRetention(dir, "Project");
		const prd = scan.perKind.find((k) => k.kind === "prd")!;
		assert.deepEqual(
			prd.prunable.map((c) => c.revisionNumber),
			[1, 3],
			"baselined rev 2 protected",
		);
		assert.equal(prd.protectedCount, 1);
	});

	test("scan is read-only — revision rows unchanged", () => {
		seedRevisions(4);
		const before = (db.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get() as { n: number }).n;
		writeRetentionConfig(1);
		scanRetention(dir, "Project");
		const after = (db.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get() as { n: number }).n;
		assert.equal(before, after);
	});
});

describe("pruneRetentions", () => {
	test('"all" → ok:false with the keep-forever problem, nothing pruned', () => {
		seedRevisions(3);
		const result = pruneRetentions(dir, "Project");
		assert.equal(result.ok, false);
		assert.equal(result.pruned, 0);
		assert.match(result.problems[0]!, /keep-forever/);
	});

	test("prune deletes the planned rows, keeps window + protected, audits each prune", () => {
		const ids = seedRevisions(5);
		recordBaseline(db, "prd", "building-rtm", ids[1]!); // baselined rev 2
		writeRetentionConfig(2);
		const result = pruneRetentions(dir, "Project");
		assert.equal(result.ok, true);
		assert.equal(result.pruned, 2, "revs 1 and 3 pruned; rev 2 baselined-protected");
		const remaining = (
			db
				.prepare("SELECT revision_number FROM artifact_revisions WHERE kind = 'prd' ORDER BY revision_number")
				.all() as {
				revision_number: number;
			}[]
		).map((r) => r.revision_number);
		assert.deepEqual(remaining, [2, 4, 5], "baselined rev 2 + keep window 4,5 survive");
		const auditCount = (
			db.prepare("SELECT COUNT(*) AS n FROM audit_ledger WHERE action = 'retention-prune'").get() as { n: number }
		).n;
		assert.equal(auditCount, 2, "one audit entry per prune (F17)");
		const txCount = (
			db
				.prepare("SELECT COUNT(*) AS n FROM tx_log WHERE operation = 'retention-prune' AND outcome = 'commit'")
				.get() as { n: number }
		).n;
		assert.equal(txCount, 2);
	});

	test("head is never pruned; already-withdrawn rows are skipped silently", () => {
		const ids = seedRevisions(4);
		assert.equal(
			withdrawRevision(db, { kind: "prd", revisionId: ids[0]!, reason: "manual tombstone", actor: "test" }).ok,
			true,
		);
		writeRetentionConfig(2);
		// Live non-withdrawn: revs 2,3,4 (head 4). keep-2 keeps 3,4 → prunable: rev 2.
		const result = pruneRetentions(dir, "Project");
		assert.equal(result.ok, true);
		assert.equal(result.pruned, 1);
		const remaining = (
			db
				.prepare("SELECT revision_number FROM artifact_revisions WHERE kind = 'prd' ORDER BY revision_number")
				.all() as {
				revision_number: number;
			}[]
		).map((r) => r.revision_number);
		assert.deepEqual(
			remaining,
			[1, 3, 4],
			"rev 2 pruned; rev 1's F16 tombstone row survives (only prune deletes rows)",
		);
	});

	test("kind below the window → nothing prunable, nothing pruned", () => {
		seedRevisions(2);
		writeRetentionConfig(5);
		const result = pruneRetentions(dir, "Project");
		assert.equal(result.ok, true);
		assert.equal(result.pruned, 0);
		assert.deepEqual(result.problems, []);
	});

	test("missing DB → ok:false with the problem", () => {
		writeRetentionConfig(2);
		const result = pruneRetentions(dir, "NoSuchProject");
		assert.equal(result.ok, false);
		assert.match(result.problems[0]!, /no store DB/);
	});

	test("FK backstop: a baselined row forced past the plan guard rolls back and survives", () => {
		const ids = seedRevisions(4);
		// Baselined rev 1 — but ALSO removed from the protected set is not
		// possible from the API; instead prove the FK backstop directly:
		// delete the baselines row from the protected computation by pointing
		// the baseline at rev 1, then run a keep-N that would prune rev 1.
		recordBaseline(db, "prd", "building-rtm", ids[0]!);
		writeRetentionConfig(3); // window keeps 2,3,4 → rev 1 prunable? No: baselined-protected.
		// Force the scenario: remove the baselines row AFTER the scan-level
		// exclusion by pruning through a direct txn that bypasses the scan —
		// the FK must make the DELETE fail and the row survive.
		const result = pruneRetentions(dir, "Project");
		assert.equal(result.pruned, 0, "baselined rev 1 protected by the scan exclusion");
		// Now prove the FK backstop itself: raw attempt to delete a baselined row.
		assert.throws(() => {
			db.exec("BEGIN IMMEDIATE;");
			try {
				db.prepare("DELETE FROM artifact_revisions WHERE revision_id = ?").run(ids[0]!);
				db.exec("COMMIT;");
			} finally {
				try {
					db.exec("ROLLBACK;");
				} catch {
					// txn already dead
				}
			}
		}, /FOREIGN KEY/);
		assert.equal(
			(db.prepare("SELECT COUNT(*) AS n FROM artifact_revisions WHERE revision_id = ?").get(ids[0]!) as { n: number })
				.n,
			1,
		);
	});

	test("Fix 2: the prune git-commits the store DB with the retention message", () => {
		seedRevisions(4);
		writeRetentionConfig(1);
		// Prepare a real local git repo around the temp project (F24: local commits).
		try {
			execSync("git init -q && git config user.email t@t.local && git config user.name t", {
				cwd: dir,
				stdio: "ignore",
			});
			execSync("git add -- .pi/files.json && git commit -qm init", { cwd: dir, stdio: "ignore" });
		} catch {
			// git unusable in this environment — the warnings-only contract
			// still holds; assert the prune result and skip the commit assert.
		}
		const result = pruneRetentions(dir, "Project");
		assert.equal(result.ok, true);
		assert.equal(result.pruned, 3);
		const gitAvailable =
			existsSync(join(dir, ".git")) &&
			(() => {
				try {
					const log = execSync("git log --format=%s -1", { cwd: dir, encoding: "utf-8" });
					return log.includes("velpari(retention): prune 3 revision(s) beyond keep-last-1 (Project)");
				} catch {
					return false;
				}
			})();
		if (existsSync(join(dir, ".git"))) {
			assert.ok(gitAvailable, "explicit retention commit present in git log");
		} else {
			assert.ok(result.warnings.length > 0, "git failure surfaces as warnings, never a failed prune");
		}
	});
});
