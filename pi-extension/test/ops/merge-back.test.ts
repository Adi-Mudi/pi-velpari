/**
 * Unit tests — ops/merge-back.ts (Phase 6 subphase 6.7.2 — guided merge-back).
 *
 * Covers the plan's 10 cases: non-repo / dirty / unknown-branch blocks,
 * the read-only clean plan (zero doctor errors, zero writes), the conflict
 * preview, the never-automatic refusal, the confirmed clean execution
 * (merge + 5 audit rows + N15 chain intact + D4 explicit-path audit commit),
 * the conflict execution (steps 2–5 skipped, no audit rows, no auto-abort),
 * the idempotent already-merged re-run, and store checksum damage (step 2
 * names the kind; the attempt is still recorded + committed).
 *
 * Fixture recipe (contingency C1): a bare error-clean project — skills/ +
 * package.json + files.json (projectName) + empty store DB + git init —
 * probes to doctorErrors === 0, unlike setupFullCwd whose stale PSRS /
 * frontmatter fixtures report 40 pre-existing errors. TMPDIR points at
 * /var/tmp locally — /tmp tmpfs quota breaks SQLite WAL.
 */
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { executeMergeBack, planMergeBack } from "../../src/ops/merge-back.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import {
	auditCanonicalPayload,
	publishArtifact,
	writeArtifact,
	type ArtifactEnvelopeInput,
} from "../../src/io/store.js";
import { buildStoreDbPath, findPackageRoot } from "../../src/core/paths.js";
import { verifyChain, type ChainedRow } from "../../src/core/hashchain.js";

const PROJECT = "MergeApp";
const REPO_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
const AUDIT_MESSAGE = "velpari(merge-back): feat — audit trail";

const dirs: string[] = [];
after(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Run git; throws on non-zero exit. */
function git(cwd: string, args: string[]): string {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.error) throw r.error;
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr?.trim() ?? ""}`);
	return (r.stdout ?? "").trim();
}

function commitAll(cwd: string, message: string): void {
	git(cwd, ["add", "-A"]);
	git(cwd, ["commit", "-q", "-m", message]);
}

/** Bare error-clean git fixture (probe: runDoctor reports 0 errors). */
function mkFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), "velpari-mergeback-"));
	dirs.push(dir);
	cpSync(join(REPO_ROOT, "skills"), join(dir, "skills"), { recursive: true });
	copyFileSync(join(REPO_ROOT, "package.json"), join(dir, "package.json"));
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(dir, ".pi", "velpari", "files.json"), JSON.stringify({ projectName: PROJECT }, null, 2));
	writeFileSync(join(dir, ".gitignore"), "Doc/store/**/index.db-wal\nDoc/store/**/index.db-shm\n");
	writeFileSync(join(dir, "f.txt"), "base line\n");
	const dbPath = buildStoreDbPath(PROJECT, dir);
	mkdirSync(dirname(dbPath), { recursive: true });
	const db = openStoreDb(dbPath);
	closeStoreDb(db);
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.email", "t@example.com"]);
	git(dir, ["config", "user.name", "merge-back test"]);
	commitAll(dir, "init");
	return dir;
}

/** Divergent history: feat edits feat.txt, main edits main.txt (no conflict). */
function divergent(dir: string): void {
	const base = git(dir, ["rev-parse", "HEAD"]);
	git(dir, ["checkout", "-q", "-b", "feat", base]);
	writeFileSync(join(dir, "feat.txt"), "feat side\n");
	commitAll(dir, "feat work");
	git(dir, ["checkout", "-q", "main"]);
	writeFileSync(join(dir, "main.txt"), "main side\n");
	commitAll(dir, "main work");
}

/** Divergent history that conflicts on f.txt (same line, both sides). */
function divergentConflict(dir: string): void {
	const base = git(dir, ["rev-parse", "HEAD"]);
	git(dir, ["checkout", "-q", "-b", "feat", base]);
	writeFileSync(join(dir, "f.txt"), "feat version\n");
	commitAll(dir, "feat edits f");
	git(dir, ["checkout", "-q", "main"]);
	writeFileSync(join(dir, "f.txt"), "main version\n");
	commitAll(dir, "main edits f");
}

/** One audit_ledger row, selected for the chain verifier. */
interface AuditRow {
	entry_id: number;
	at: string;
	actor: string;
	action: string;
	artifact_kind: string | null;
	revision_number: number | null;
	reason: string | null;
	detail_json: string;
	prev_hash: string;
	entry_hash: string;
}

/** Read audit rows in storage order (mirrors doctor/checks/hash-chain.ts). */
function readAuditRows(dir: string): AuditRow[] {
	const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
	try {
		return db
			.prepare(
				"SELECT entry_id, at, actor, action, artifact_kind, revision_number, reason, detail_json, prev_hash, entry_hash " +
					"FROM audit_ledger ORDER BY entry_id ASC",
			)
			.all() as unknown as AuditRow[];
	} finally {
		closeStoreDb(db);
	}
}

describe("ops/merge-back (Phase 6 6.7 — N12 guided merge-back)", () => {
	// Shared by cases 7 → 9 (idempotent re-run happens on the same repo).
	let case7Dir: string | null = null;

	test("1. plan: non-repo is blocked, nothing is created", () => {
		const dir = mkdtempSync(join(tmpdir(), "velpari-mergeback-nr-"));
		dirs.push(dir);
		const plan = planMergeBack(dir, "feat");
		assert.ok(
			plan.blocked.some((b) => b.includes("not a git repository")),
			`blocked should name the non-repo: ${JSON.stringify(plan.blocked)}`,
		);
		for (const s of plan.steps) assert.equal(s.status, "skipped");
		assert.ok(!existsSync(join(dir, ".git")), "planning must never init a repo");
	});

	test("2. plan: dirty tree blocked and the tree stays untouched", () => {
		const dir = mkFixture();
		divergent(dir);
		writeFileSync(join(dir, "dirty.txt"), "uncommitted\n");
		const statusBefore = git(dir, ["status", "--porcelain"]);
		const headBefore = git(dir, ["rev-parse", "HEAD"]);
		const plan = planMergeBack(dir, "feat");
		assert.ok(
			plan.blocked.some((b) => b.includes("working tree not clean")),
			`blocked should name the dirty tree: ${JSON.stringify(plan.blocked)}`,
		);
		assert.equal(git(dir, ["status", "--porcelain"]), statusBefore);
		assert.equal(git(dir, ["rev-parse", "HEAD"]), headBefore);
	});

	test("3. plan: unknown branch blocked", () => {
		const dir = mkFixture();
		divergent(dir);
		const plan = planMergeBack(dir, "no-such-branch");
		assert.ok(
			plan.blocked.some((b) => b.includes("branch not found: no-such-branch")),
			`blocked should name the branch: ${JSON.stringify(plan.blocked)}`,
		);
	});

	test("4. plan: clean divergent merge converges with zero doctor errors and zero writes", () => {
		const dir = mkFixture();
		divergent(dir);
		const headBefore = git(dir, ["rev-parse", "HEAD"]);
		const plan = planMergeBack(dir, "feat");
		assert.deepEqual(plan.blocked, []);
		assert.deepEqual(plan.conflicts, []);
		assert.equal(plan.doctorErrors, 0, "acceptance row 6 — zero doctor errors");
		assert.equal(plan.alreadyMerged, false);
		for (const s of plan.steps) {
			// Reconciliation (plan v1.2): warnings-only ⇒ step 3 is "warn" by
			// §6.7.1 — "converges" = no error/skipped step + doctorErrors 0.
			assert.ok(s.status === "ok" || s.status === "warn", `step ${s.step} planned "${s.status}" — expected ok/warn`);
		}
		assert.ok(plan.staleCount >= 0);
		// Read-only proof (R6): HEAD and tree byte-identical after planning.
		assert.equal(git(dir, ["rev-parse", "HEAD"]), headBefore);
		assert.equal(git(dir, ["status", "--porcelain"]), "");
	});

	test("5. plan: conflict preview names f.txt, step 1 error, steps 3–5 still counted", () => {
		const dir = mkFixture();
		divergentConflict(dir);
		const plan = planMergeBack(dir, "feat");
		assert.deepEqual(plan.blocked, []);
		assert.ok(plan.conflicts.includes("f.txt"), `conflicts: ${JSON.stringify(plan.conflicts)}`);
		const s1 = plan.steps.find((s) => s.step === 1);
		assert.equal(s1?.status, "error");
		for (const n of [3, 4, 5] as const) {
			assert.ok(
				plan.steps.some((s) => s.step === n),
				`planned step ${n} missing`,
			);
		}
	});

	test("6. execute without confirmed refuses — nothing touched (never automatic)", () => {
		const dir = mkFixture();
		divergent(dir);
		const headBefore = git(dir, ["rev-parse", "HEAD"]);
		const res = executeMergeBack(dir, "feat", { confirmed: false });
		assert.equal(res.ok, false);
		assert.equal(res.steps.length, 1);
		assert.equal(res.steps[0]?.status, "error");
		assert.match(res.steps[0]?.message ?? "", /confirmation required/);
		assert.equal(res.auditEntries, 0);
		assert.equal(res.mergeCommit, null);
		assert.equal(res.auditCommit, null);
		assert.equal(git(dir, ["rev-parse", "HEAD"]), headBefore);
		assert.equal(git(dir, ["status", "--porcelain"]), "");
	});

	test("7. execute confirmed (clean): merge + 5 audit rows + chain intact + D4 audit commit", () => {
		const dir = mkFixture();
		divergent(dir);
		const headBefore = git(dir, ["rev-parse", "HEAD"]);
		const res = executeMergeBack(dir, "feat", { confirmed: true });
		case7Dir = dir;
		assert.equal(res.ok, true, `unexpected result: ${JSON.stringify(res.steps)}`);
		assert.equal(res.steps.find((s) => s.step === 1)?.status, "ok");
		assert.equal(res.auditEntries, 5, "one chained row per step (1–5) for the one store");
		assert.ok(res.mergeCommit, "merge commit sha");
		assert.deepEqual(res.commitWarnings, []);

		// The merge commit itself has 2 parents (HEAD moved past headBefore).
		const parents = git(dir, ["rev-list", "--parents", "-n", "1", res.mergeCommit as string]).split(" ");
		assert.equal(parents.length, 3, "merge commit = commit + 2 parents");
		assert.notEqual(git(dir, ["rev-parse", "HEAD"]), headBefore);

		// Audit rows: actor + detail_json.step + N15 chain intact.
		const rows = readAuditRows(dir);
		assert.equal(rows.length, 5);
		assert.deepEqual([...new Set(rows.map((r) => r.actor))], ["velpari-merge-back"]);
		assert.deepEqual(
			rows.map((r) => (JSON.parse(r.detail_json) as { step: number }).step),
			[1, 2, 3, 4, 5],
		);
		const chain: ChainedRow[] = rows.map((r) => ({
			prev_hash: r.prev_hash,
			entry_hash: r.entry_hash,
			canonicalPayload: () =>
				auditCanonicalPayload({
					at: r.at,
					actor: r.actor,
					action: r.action,
					artifact_kind: r.artifact_kind,
					revision_number: r.revision_number,
					reason: r.reason,
					detail_json: r.detail_json,
				}),
		}));
		assert.equal(verifyChain(chain), null, "our own writes must keep N15 intact");

		// D4 (v1.1): explicit-path audit commit — store DB clean, store-only paths.
		assert.ok(res.auditCommit, "audit commit sha");
		assert.equal(git(dir, ["log", "-1", "--format=%s"]), AUDIT_MESSAGE);
		assert.equal(git(dir, ["status", "--porcelain", "--", "Doc/store"]), "");
		const files = git(dir, ["show", "--name-only", "--format=", res.auditCommit as string])
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0);
		assert.ok(files.length >= 1, "audit commit records the store DB");
		for (const f of files) assert.ok(f.startsWith("Doc/store/"), `unexpected file in audit commit: ${f}`);
	});

	test("8. execute confirmed (conflict): step 1 error, steps 2–5 skipped, no audit, no auto-abort", () => {
		const dir = mkFixture();
		divergentConflict(dir);
		const headBefore = git(dir, ["rev-parse", "HEAD"]);
		const res = executeMergeBack(dir, "feat", { confirmed: true });
		assert.equal(res.ok, false);
		const s1 = res.steps.find((s) => s.step === 1);
		assert.equal(s1?.status, "error");
		assert.ok(
			(s1?.details ?? []).some((d) => d.includes("skills/db-store-merge-runbook.md")),
			`runbook guidance missing: ${JSON.stringify(s1?.details)}`,
		);
		assert.ok(
			(s1?.details ?? []).some((d) => d.includes("git merge --abort")),
			"abort guidance missing",
		);
		for (const n of [2, 3, 4, 5] as const) {
			assert.equal(res.steps.find((s) => s.step === n)?.status, "skipped");
		}
		// D4: no rows, no commit — the tree is left exactly as git produced it.
		assert.equal(res.auditEntries, 0);
		assert.equal(res.auditCommit, null);
		assert.equal(git(dir, ["rev-parse", "HEAD"]), headBefore);
		assert.ok(git(dir, ["status", "--porcelain"]).includes("UU f.txt"), "conflict left for the human");
	});

	test("9. idempotent re-run: alreadyMerged plan + execute completes steps 2–5 with its own audit commit", () => {
		assert.ok(case7Dir, "case 7 must run first");
		const dir = case7Dir;
		const plan = planMergeBack(dir, "feat");
		assert.deepEqual(plan.blocked, []);
		assert.equal(plan.alreadyMerged, true);
		assert.deepEqual(plan.conflicts, []);
		const res = executeMergeBack(dir, "feat", { confirmed: true });
		assert.equal(res.ok, true, `unexpected result: ${JSON.stringify(res.steps)}`);
		assert.match(res.steps.find((s) => s.step === 1)?.message ?? "", /already merged/);
		assert.equal(res.auditEntries, 5, "the already-merged completion records every step too");
		assert.ok(res.auditCommit, "second execution lands its own audit commit");
		assert.equal(git(dir, ["log", "-1", "--format=%s"]), AUDIT_MESSAGE);
		assert.equal(git(dir, ["status", "--porcelain", "--", "Doc/store"]), "");
	});

	test("10. store checksum damage → step 2 error naming the kind; the attempt is still recorded + committed", () => {
		const dir = mkFixture();
		// Seed a published PRD (recipe: test/commands/backfill.test.ts).
		const dbPath = buildStoreDbPath(PROJECT, dir);
		const seeded = openStoreDb(dbPath);
		try {
			const envelope: ArtifactEnvelopeInput = {
				version: 1,
				stage: "drafting-prd",
				generatedAt: "2026-09-26T00:00:00.000Z",
				inputs: "{}",
				reviewerVerdict: null,
				changeLog: "[]",
			};
			writeArtifact(seeded, "prd", "run-orig", envelope, {
				fr: [{ id: "FR-1", phase: 1, textHash: "a1b2c3", text: "The system shall parse input." }],
			});
			publishArtifact(seeded, "run-orig", "prd");
		} finally {
			closeStoreDb(seeded);
		}
		commitAll(dir, "seed published prd");
		divergent(dir);
		// Simulate committed hand-merge damage: the stored fingerprint no
		// longer matches the rows (verifyExportChecksum is row→fingerprint).
		const damaged = openStoreDb(dbPath);
		try {
			damaged
				.prepare("UPDATE artifacts SET sha256_fingerprint = ? WHERE run_id = 'run-orig' AND kind = 'prd'")
				.run("0".repeat(64));
		} finally {
			closeStoreDb(damaged);
		}
		commitAll(dir, "simulate store damage");
		const res = executeMergeBack(dir, "feat", { confirmed: true });
		const s2 = res.steps.find((s) => s.step === 2);
		assert.equal(s2?.status, "error", `step 2 should fail: ${JSON.stringify(res.steps)}`);
		assert.ok(
			`${s2?.message ?? ""} ${JSON.stringify(s2?.details ?? [])}`.includes("prd"),
			`step 2 must name the divergent kind: ${JSON.stringify(s2)}`,
		);
		// The attempt is recorded (rows) and committed (D4) — tamper-evident.
		assert.equal(res.auditEntries, 5);
		assert.ok(res.auditCommit, "failed attempts still land the audit commit");
		assert.equal(git(dir, ["log", "-1", "--format=%s"]), AUDIT_MESSAGE);
		assert.equal(git(dir, ["status", "--porcelain", "--", "Doc/store"]), "");
	});
});
