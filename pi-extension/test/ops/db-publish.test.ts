/**
 * Direct tests of the Phase-1 publish chain (ops/db-publish.ts:runDbPublish).
 *
 * Covers the Phase-1 acceptance row (Master Outline §6):
 *   - publish writes revision columns (artifact_revisions snapshot);
 *   - the flip marks the predecessor superseded (CAS wiring);
 *   - the frozen artifact refuses supersession without unfreeze;
 *   - actor-real audit entries + rollback bookkeeping keep clean chains;
 *   - the backup call site is fail-open (null → publish continues);
 *   - G8 DB-only mode compares against the stored head digest.
 *
 * Real temp git repos, real store DBs (node:sqlite). Git hermeticity mirrors
 * test/integration/db-era-publish.test.ts (pinned local identity, isolated
 * ambient config).
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { precheckGitForPublish, runDbPublish } from "../../src/ops/db-publish.js";
import {
	appendAuditEntry,
	appendTxEntry,
	auditCanonicalPayload,
	getHeadRevision,
	setFrozen,
	txCanonicalPayload,
	type ArtifactEnvelopeInput,
	type ArtifactPayload,
} from "../../src/io/store.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { verifyChain, type ChainedRow } from "../../src/core/hashchain.js";

const PROJECT = "Phase1Pub";
let dir: string;
const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

const RUN_ID = "phase1-run";

/** Minimal valid prd envelope. */
function envelope(version: number, inputs: Record<string, string> = {}): ArtifactEnvelopeInput {
	return {
		version,
		stage: "drafting-prd",
		generatedAt: "2026-09-27T00:00:00.000Z",
		inputs: JSON.stringify(inputs),
		changeLog: JSON.stringify([`2026-09-27: fixture publish v${version}.`]),
	};
}

/** Minimal valid prd rows (same shape the db-era fixture inserts). */
function rows(): ArtifactPayload {
	return {
		fr: [{ id: "FR-01", phase: 1, textHash: "a".repeat(64), text: "The system shall accept text input." }],
		nfr: [{ id: "NFR-01", phase: 1, textHash: "b".repeat(64), text: "p95 latency shall stay under 200 ms." }],
		prdSection: [{ no: 1, title: "Objective", body: "Prose for the objective." }],
	} as unknown as ArtifactPayload;
}

/** Open the fixture store DB. */
function openDb() {
	return openStoreDb(join(dir, "Doc", "store", PROJECT, "index.db"));
}

/** git log -1 subject of the fixture repo. */
function headSubject(): string {
	return execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: dir, encoding: "utf-8" }).trim();
}

/** All audit_ledger rows as verifier-visible chained rows. */
function auditRows(db: ReturnType<typeof openStoreDb>): ChainedRow[] {
	const raw = db
		.prepare(
			"SELECT at, actor, action, artifact_kind, revision_number, reason, detail_json, prev_hash, entry_hash FROM audit_ledger ORDER BY entry_id",
		)
		.all() as Array<Record<string, unknown>>;
	return raw.map((r) => ({
		prev_hash: String(r.prev_hash),
		entry_hash: String(r.entry_hash),
		canonicalPayload: () =>
			auditCanonicalPayload({
				at: String(r.at),
				actor: String(r.actor),
				action: String(r.action),
				artifact_kind: r.artifact_kind === null ? null : String(r.artifact_kind),
				revision_number: r.revision_number === null ? null : Number(r.revision_number),
				reason: r.reason === null ? null : String(r.reason),
				detail_json: String(r.detail_json),
			}),
	}));
}

/** All tx_log rows as verifier-visible chained rows. */
function txRows(db: ReturnType<typeof openStoreDb>): ChainedRow[] {
	const raw = db
		.prepare("SELECT at, actor, operation, before_digest, after_digest, outcome, prev_hash, entry_hash FROM tx_log ORDER BY tx_id")
		.all() as Array<Record<string, unknown>>;
	return raw.map((r) => ({
		prev_hash: String(r.prev_hash),
		entry_hash: String(r.entry_hash),
		canonicalPayload: () =>
			txCanonicalPayload({
				at: String(r.at),
				actor: String(r.actor),
				operation: String(r.operation),
				before_digest: r.before_digest === null ? null : String(r.before_digest),
				after_digest: r.after_digest === null ? null : String(r.after_digest),
				outcome: String(r.outcome),
			}),
	}));
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-phase1-pub-"));
	dirs.push(dir);
	// Real git repo + pinned identity + isolated ambient config (Design 9).
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "Velpari Phase1"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "phase1@velpari.local"], { cwd: dir });
	const gitConfigGlobal = join(dir, "gitconfig-global");
	writeFileSync(gitConfigGlobal, "[user]\n\tname = Velpari Phase1\n\temail = phase1@velpari.local\n", "utf8");
	savedEnv.GIT_CONFIG_GLOBAL = process.env.GIT_CONFIG_GLOBAL;
	savedEnv.GIT_CONFIG_SYSTEM = process.env.GIT_CONFIG_SYSTEM;
	savedEnv.GIT_CONFIG_NOSYSTEM = process.env.GIT_CONFIG_NOSYSTEM;
	process.env.GIT_CONFIG_GLOBAL = gitConfigGlobal;
	process.env.GIT_CONFIG_SYSTEM = "/dev/null";
	process.env.GIT_CONFIG_NOSYSTEM = "1";
});

after(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	for (const key of Object.keys(savedEnv)) {
		const before = savedEnv[key];
		if (before === undefined) delete process.env[key];
		else process.env[key] = before;
	}
});

describe("Phase 1 publish chain — CAS door, revision surfacing, audit wiring", () => {
	test("first publish: revision 1, no supersession, actor-real audit, clean chains", () => {
		const out = runDbPublish({
			cwd: dir,
			projectName: PROJECT,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(1),
			payload: rows(),
			publishedPaths: [],
		});

		assert.equal(out.ok, true, `publish must succeed: ${out.problems.join("; ")}`);
		assert.deepEqual(out.problems, []);
		assert.ok(out.revision, "ok publish carries the revision identity");
		assert.equal(out.revision!.revisionNumber, 1);
		assert.equal(out.revision!.supersededRevisionId, null);
		assert.equal(out.revision!.supersededRevisionNumber, null);

		const db = openDb();
		try {
			// Actor-real call-site audit entry (F17).
			const actorRows = db
				.prepare("SELECT actor, action, revision_number FROM audit_ledger WHERE action = 'publish' AND actor LIKE 'velpari:publish:%'")
				.all() as Array<{ actor: string; action: string; revision_number: number }>;
			assert.equal(actorRows.length, 1, "exactly one actor-real publish entry");
			assert.equal(actorRows[0]!.actor, `velpari:publish:prd:${RUN_ID}`);
			assert.equal(actorRows[0]!.revision_number, 1);

			// Both chains verify clean (N15).
			assert.equal(verifyChain(auditRows(db)), null, "audit_ledger chain intact");
			assert.equal(verifyChain(txRows(db)), null, "tx_log chain intact");
		} finally {
			closeStoreDb(db);
		}
	});

	test("second publish: revision 2 supersedes revision 1; warning + commit message surface it", () => {
		runDbPublish({
			cwd: dir,
			projectName: PROJECT,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(1),
			payload: rows(),
			publishedPaths: [],
		});
		const out = runDbPublish({
			cwd: dir,
			projectName: PROJECT,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(2),
			payload: rows(),
			publishedPaths: [],
		});

		assert.equal(out.ok, true, `republish must succeed: ${out.problems.join("; ")}`);
		assert.ok(out.revision);
		assert.equal(out.revision!.revisionNumber, 2);
		assert.ok(out.revision!.supersededRevisionId, "the prior revision id is recorded");
		assert.equal(out.revision!.supersededRevisionNumber, 1);
		assert.ok(
			out.warnings.some((w) => w.includes("Superseded prd revision 1; head is now revision 2.")),
			`supersession must be surfaced in warnings: ${out.warnings.join("; ")}`,
		);
		assert.match(headSubject(), /rev 2/, "the commit message carries the revision number");

		const db = openDb();
		try {
			const rev = db
				.prepare(
					"SELECT revision_id, revision_number, supersedes_revision_id, status FROM artifact_revisions WHERE kind = 'prd' ORDER BY revision_number",
				)
				.all() as Array<{ revision_id: number; revision_number: number; supersedes_revision_id: number | null; status: string }>;
			assert.equal(rev.length, 2);
			assert.equal(rev[0]!.status, "superseded");
			assert.equal(rev[1]!.status, "published");
			// The FK points at the superseded revision's revision_id
			// (io/store.ts: supersedesId = actualHead, a revision_id).
			assert.equal(rev[1]!.supersedes_revision_id, rev[0]!.revision_id);
		} finally {
			closeStoreDb(db);
		}
	});

	test("frozen refusal: publish refused, draft + head pointer preserved, rollback audited", () => {
		runDbPublish({
			cwd: dir,
			projectName: PROJECT,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(1),
			payload: rows(),
			publishedPaths: [],
		});
		const db = openDb();
		try {
			setFrozen(db, RUN_ID, "prd", true, "hold for review");
		} finally {
			closeStoreDb(db);
		}

		const out = runDbPublish({
			cwd: dir,
			projectName: PROJECT,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(2),
			payload: rows(),
			publishedPaths: [],
		});

		assert.equal(out.ok, false, "a frozen artifact must refuse the publish");
		assert.ok(out.revision === null, "no revision identity on refusal");
		assert.ok(out.problems.some((p) => /frozen/.test(p)), `refusal names the freeze: ${out.problems.join("; ")}`);

		const db2 = openDb();
		try {
			// The revision draft is KEPT (head pointer must survive for the retry).
			const row = db2.prepare("SELECT status, head_revision_id FROM artifacts WHERE run_id = ? AND kind = 'prd'").get(RUN_ID) as
				| { status: string; head_revision_id: number | null }
				| undefined;
			assert.ok(row, "the artifact row survives a frozen refusal");
			assert.equal(row!.status, "draft");
			assert.ok(row!.head_revision_id, "the head pointer survives (chain intact for the retry)");

			// Rollback bookkeeping (F17/F18): publish-failed + tx rollback entry.
			const failed = db2.prepare("SELECT COUNT(*) AS n FROM audit_ledger WHERE action = 'publish-failed'").get() as { n: number };
			assert.equal(failed.n, 1, "exactly one publish-failed audit entry");
			const rb = db2.prepare("SELECT COUNT(*) AS n FROM tx_log WHERE outcome = 'rollback'").get() as { n: number };
			assert.ok(rb.n >= 1, "a rollback tx entry lands");
			assert.equal(verifyChain(auditRows(db2)), null, "audit chain intact after the rollback entries");
			assert.equal(verifyChain(txRows(db2)), null, "tx chain intact after the rollback entries");

			// Sanity: the audit/tx append helpers used here must hash correctly.
			const id = appendAuditEntry(db2, { actor: "test", action: "probe" });
			assert.ok(id > 0);
			const txId = appendTxEntry(db2, { actor: "test", operation: "probe", outcome: "commit" });
			assert.ok(txId > 0);
			assert.equal(verifyChain(auditRows(db2)), null);
			assert.equal(verifyChain(txRows(db2)), null);
		} finally {
			closeStoreDb(db2);
		}
	});

	test("G8 DB-only mode: payload carrying the stored head digest passes; a wrong digest refuses", () => {
		const first = runDbPublish({
			cwd: dir,
			projectName: PROJECT,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(1),
			payload: rows(),
			publishedPaths: [],
		});
		assert.equal(first.ok, true);

		const db = openDb();
		let storedDigest: string;
		try {
			storedDigest = getHeadRevision(db, RUN_ID, "prd")!.sha256Fingerprint;
		} finally {
			closeStoreDb(db);
		}

		// Wrong digest → refused with the DB-only variant of the message. Per
		// the CONFIRMED post-flip G8 position (discussion §3.12: flip → G8),
		// the flip already committed — the refusal leaves an immutable snapshot
		// as the forensic record and the NEXT honest retry supersedes it.
		const refused = runDbPublish({
			cwd: dir,
			projectName: PROJECT,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(2, { "prd-file": "f".repeat(64) }),
			payload: rows(),
			publishedPaths: [],
		});
		assert.equal(refused.ok, false);
		assert.ok(
			refused.problems.some((p) => /G8 mirror check failed \(DB-only\)/.test(p)),
			`the DB-only G8 branch must fire: ${refused.problems.join("; ")}`,
		);

		// The forensic snapshot exists and is the new head (F8: the flip = published).
		const db2 = openDb();
		let headAfterRefusal: string;
		try {
			headAfterRefusal = getHeadRevision(db2, RUN_ID, "prd")!.sha256Fingerprint;
		} finally {
			closeStoreDb(db2);
		}
		assert.notEqual(headAfterRefusal, storedDigest, "the refused attempt's snapshot became the head");

		// Honest retry mirroring the CURRENT head → publishes (revision 3,
		// superseding the forensic revision 2).
		const ok = runDbPublish({
			cwd: dir,
			projectName: PROJECT,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(3, { "prd-file": headAfterRefusal }),
			payload: rows(),
			publishedPaths: [],
		});
		assert.equal(ok.ok, true, `the honest DB-only revision must publish: ${ok.problems.join("; ")}`);
		assert.equal(ok.revision!.revisionNumber, 3);
		assert.equal(ok.revision!.supersededRevisionNumber, 2);
	});

	test("backup contract: publish proceeds unblocked with the Foundation no-op (null)", () => {
		const out = runDbPublish({
			cwd: dir,
			projectName: PROJECT,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(1),
			payload: rows(),
			publishedPaths: [],
		});
		// The contract (not the no-op's accidental value — D3 lesson): the
		// publish is never blocked by the backup call site. The record branch
		// (Phase 3) may add a warning; this suite pins only the unblocked path.
		assert.equal(out.ok, true, `publish must proceed: ${out.problems.join("; ")}`);
		assert.deepEqual(out.problems, []);
	});
});

// ---------------------------------------------------------------------------
// Phase 5 — the worktree/branch half of the publish pre-check (N5/N6).
// `run` is optional, so every Phase-1/2/3 caller keeps its exact behavior.
// ---------------------------------------------------------------------------

/** Repo with one commit + pinned local identity (mirrors the suite's hermeticity rule). */
function initRepoWithIdentity(target: string, branch = "main"): void {
	execFileSync("git", ["init", "-b", branch], { cwd: target });
	execFileSync("git", ["-c", "user.email=t@t.local", "-c", "user.name=T", "commit", "--allow-empty", "-m", "init"], {
		cwd: target,
	});
	execFileSync("git", ["config", "user.email", "t@t.local"], { cwd: target });
	execFileSync("git", ["config", "user.name", "T"], { cwd: target });
}

describe("precheckGitForPublish — Phase 5 worktree/branch checks (N5/N6)", () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), "velpari-precheck-wt-"));
		dirs.push(repo);
	});

	test("no run argument → the Phase-1 behavior (identical to an explicit undefined)", () => {
		initRepoWithIdentity(repo);
		const withoutRun = precheckGitForPublish(repo);
		const explicitUndefined = precheckGitForPublish(repo, undefined);
		assert.deepEqual(withoutRun, explicitUndefined);
		assert.equal(withoutRun.ok, true, withoutRun.problems.join("; "));
	});

	test("matching worktree + branch → still ok", () => {
		initRepoWithIdentity(repo, "velpari/line-A");
		const result = precheckGitForPublish(repo, { runBranch: "velpari/line-A", runWorktree: repo });
		assert.equal(result.ok, true, result.problems.join("; "));
	});

	test("publish from the WRONG worktree → refused with both folders + the fix", () => {
		initRepoWithIdentity(repo, "velpari/line-A");
		const parent = mkdtempSync(join(tmpdir(), "velpari-precheck-wt2-"));
		dirs.push(parent);
		const second = join(parent, "line-b");
		execFileSync("git", ["worktree", "add", second, "-b", "velpari/line-B"], { cwd: repo });

		const result = precheckGitForPublish(second, { runBranch: "velpari/line-B", runWorktree: repo });
		assert.equal(result.ok, false);
		const joined = result.problems.join("\n");
		assert.match(joined, /publish must run in the run's worktree/);
		assert.match(joined, /git worktree add \.\.\//);
		assert.match(joined, /N5\/N6/);
	});

	test("publish on the WRONG branch → refused with the checkout fix", () => {
		initRepoWithIdentity(repo, "main");
		const result = precheckGitForPublish(repo, { runBranch: "velpari/line-A", runWorktree: repo });
		assert.equal(result.ok, false);
		assert.match(result.problems.join("\n"), /bound to branch 'velpari\/line-A', this worktree is on 'main'/);
		assert.match(result.problems.join("\n"), /git checkout velpari\/line-A/);
	});

	test("non-git folder → the original 'not inside a git work tree' refusal (unchanged)", () => {
		const result = precheckGitForPublish(repo, { runBranch: "x", runWorktree: repo });
		assert.equal(result.ok, false);
		assert.match(result.problems.join("\n"), /not inside a git work tree/);
	});
});

