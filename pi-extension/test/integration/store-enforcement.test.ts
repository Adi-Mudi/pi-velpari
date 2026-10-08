/**
 * Integration: Phase B store enforcement end-to-end (G1/G2/G3/G5).
 *
 * One fixture — published PRD + RTM in the store, a git repo, the state +
 * files config — walks the full enforcement story through the REAL gate:
 *
 *  1. runPublishGate("RTM") marks the PRD head locked (D8 detect+mark)
 *     with locked_by = manifestKey("RTM", project) + a `soft-lock` audit row;
 *  2. a second gate run is idempotent (no duplicate locks/audit);
 *  3. the L1 guard refuses a content write on the locked PRD revision
 *     (LockedRevisionError, self-healing message);
 *  4. the N20 status path still works on that locked revision, audited with
 *     an unchanged fingerprint;
 *  5. revertPublish (simulated failed RTM publish) clears the locks it set
 *     and writes the `soft-lock-release` audit row;
 *  6. the provisioned commit-msg hook rejects a manual Doc/store/** commit
 *     until the velpari( marker message is used (G5/D14).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runPublishGate } from "../../src/doctor/gate.js";
import { createRun } from "../../src/core/state.js";
import { openStoreDb, closeStoreDb, assertRevisionContentUnlocked, LockedRevisionError } from "../../src/io/db.js";
import { writeArtifact, publishArtifactCas, revertPublish, type ArtifactPayload } from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { setRevisionStatus } from "../../src/ops/protection.js";
import { PROTECTED_ASSETS_START } from "../../src/core/agents-md.js";

let tmpDir: string;
let prdRevisionId: number;
let dbPath: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-store-enforcement-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TestApp" }),
		"utf8",
	);
	// Git fixture: identity + hermetic in-repo hooksPath (D13a fixture rule).
	execFileSync("git", ["init", "-q"], { cwd: tmpDir });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpDir });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });
	execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: tmpDir });
	execFileSync("git", ["config", "core.hooksPath", ".git/hooks"], { cwd: tmpDir });
	// Declared input of the RTM stage: the published PRD doc must exist.
	mkdirSync(join(tmpDir, "Doc", "requirements"), { recursive: true });
	writeFileSync(join(tmpDir, "Doc", "requirements", "PRD_TestApp.md"), "# PRD TestApp\n\n## FR table\n", "utf8");
	// State file (gate reads state.mission for the input slug).
	createRun("Test", tmpDir);
	// Store: published PRD (head) + published RTM (so revert has a target).
	dbPath = buildStoreDbPath("TestApp", tmpDir);
	const db = openStoreDb(dbPath);
	try {
		writeArtifact(
			db,
			"prd",
			"r1",
			{ version: 1, stage: "drafting-prd", generatedAt: "2026-09-28T00:00:00Z", inputs: "{}", reviewerVerdict: null, changeLog: "[]" },
			{ fr: [{ id: "FR-1", phase: 1, textHash: "a1b2", text: "x" }] } as ArtifactPayload,
		);
		prdRevisionId = publishArtifactCas(db, "r1", "prd", null).revisionId;
		writeArtifact(
			db,
			"rtm",
			"r1",
			{ version: 1, stage: "building-rtm", generatedAt: "2026-09-28T00:00:00Z", inputs: "{}", reviewerVerdict: null, changeLog: "[]" },
			{ rtmRow: [{ id: "T-1", frRef: "FR-1", phase: 1, targetSha256: "x" }] } as ArtifactPayload,
		);
		publishArtifactCas(db, "r1", "rtm", null);
	} finally {
		closeStoreDb(db);
	}
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

/** Count audit rows for one action (node:sqlite rows are null-prototype). */
function auditCount(action: string): number {
	const db = openStoreDb(dbPath);
	try {
		const row = db.prepare("SELECT COUNT(*) AS n FROM audit_ledger WHERE action = ?").get(action) as { n: number };
		return Number(row.n);
	} finally {
		closeStoreDb(db);
	}
}

/** Read the PRD head's lock columns (locked_at, locked_by). */
function prdLock(): { locked_at: string | null; locked_by: string | null } {
	const db = openStoreDb(dbPath);
	try {
		return db
			.prepare("SELECT locked_at, locked_by FROM artifact_revisions WHERE revision_id = ?")
			.get(prdRevisionId) as { locked_at: string | null; locked_by: string | null };
	} finally {
		closeStoreDb(db);
	}
}

describe("integration — store enforcement through the real publish gate", () => {
	it("marks → surfaces → guards → allows status → reverts → hooks (full ladder)", () => {
		// ---- 1. Gate run 1: D8 detect + mark (errors stay empty). ----
		const first = runPublishGate({
			artifact: "RTM",
			workingContent: "# RTM working copy\n",
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.deepEqual(first.errors, [], `gate errors: ${JSON.stringify(first.errors)}`);
		assert.ok(
			first.warnings.some((w) => /soft-lock: locked prd:TestApp revision v1 — consumed by this publish\./.test(w)),
			`expected the mark warning; got ${JSON.stringify(first.warnings)}`,
		);
		const lock = prdLock();
		assert.ok(lock.locked_at !== null, "PRD head marked locked");
		assert.equal(lock.locked_by, "rtm:TestApp", "locked_by = manifestKey(RTM, project) (D9)");
		assert.equal(auditCount("soft-lock"), 1, "one soft-lock audit row");
		assert.ok(existsSync(join(tmpDir, "AGENTS.md")), "L2 provisioned by the gate");
		assert.ok(readFileSync(join(tmpDir, "AGENTS.md"), "utf8").includes(PROTECTED_ASSETS_START));
		assert.ok(existsSync(join(tmpDir, ".git", "hooks", "commit-msg")), "L3 provisioned by the gate");

		// ---- 2. Second gate run: idempotent. ----
		const second = runPublishGate({
			artifact: "RTM",
			workingContent: "# RTM working copy\n",
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.deepEqual(second.errors, []);
		assert.equal(auditCount("soft-lock"), 1, "no duplicate soft-lock audit");
		assert.equal(
			second.warnings.filter((w) => w.includes("consumed by this publish")).length,
			0,
			"already-locked upstreams stay silent (idempotent mark)",
		);
		assert.equal(prdLock().locked_by, "rtm:TestApp", "lock unchanged");

		// ---- 3. L1 guard proof: content write refused with the exact message. ----
		const db = openStoreDb(dbPath);
		try {
			assert.throws(
				() => assertRevisionContentUnlocked(db, prdRevisionId, "edit revision"),
				(err: unknown) => {
					assert.ok(err instanceof LockedRevisionError, "typed error");
					assert.match(
						err.message,
						/is soft-locked \(consumed by rtm:TestApp\) — its content is immutable\. edit revision is refused/,
						"self-healing message",
					);
					assert.match(err.message, /copy → publish/, "names the N19 path");
					return true;
				},
				"L1 refuses the locked revision",
			);

			// ---- 4. N20 status proof: withdraw succeeds on the SAME locked row. ----
			const fingerprintBefore = (
				db.prepare("SELECT sha256_fingerprint FROM artifact_revisions WHERE revision_id = ?").get(prdRevisionId) as {
					sha256_fingerprint: string;
				}
			).sha256_fingerprint;
			const outcome = setRevisionStatus(db, {
				kind: "prd",
				revisionId: prdRevisionId,
				to: "withdrawn",
				reason: "integration status proof",
				actor: "test",
			});
			assert.equal(outcome.ok, true, "status writes are allowed on locked rows (N20)");
			const tx = db
				.prepare(
					"SELECT before_digest, after_digest FROM tx_log WHERE operation = 'tombstone' ORDER BY tx_id DESC LIMIT 1",
				)
				.get() as { before_digest: string; after_digest: string };
			assert.equal(tx.before_digest, fingerprintBefore, "before digest = revision fingerprint");
			assert.equal(tx.after_digest, fingerprintBefore, "after digest = unchanged fingerprint");

			// ---- 5. Simulated failed RTM publish → revertPublish clears its locks. ----
			revertPublish(db, "r1", "rtm");
		} finally {
			closeStoreDb(db);
		}
		assert.equal(prdLock().locked_at, null, "revert released the consumption lock");
		assert.equal(prdLock().locked_by, null);
		assert.equal(auditCount("soft-lock-release"), 1, "release audited (D8 residual-risk fix)");

		// ---- 6. Hook proof: manual store commit rejected, velpari( allowed. ----
		execFileSync("git", ["add", "--", "Doc/store/TestApp/index.db"], { cwd: tmpDir });
		const rejected = spawnSync("git", ["commit", "-m", "manual edit", "--", "Doc/store/TestApp/index.db"], {
			cwd: tmpDir,
			encoding: "utf-8",
		});
		assert.equal(rejected.status, 1, "manual store commit must be rejected");
		const output = `${rejected.stdout ?? ""}${rejected.stderr ?? ""}`;
		assert.match(output, /refusing to commit Doc\/store\/\*\* outside the velpari publish flow/);
		const allowed = spawnSync(
			"git",
			["commit", "-m", "velpari(store): recovery rebuild", "--", "Doc/store/TestApp/index.db"],
			{ cwd: tmpDir, encoding: "utf-8" },
		);
		assert.equal(allowed.status, 0, `velpari( marker commit must pass: ${allowed.stdout}${allowed.stderr}`);
	});
});
