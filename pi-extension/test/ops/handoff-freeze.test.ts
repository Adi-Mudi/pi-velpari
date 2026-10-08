/**
 * Tests of the N4 freeze helpers (ops/freeze.ts): freezeAllForHandoff
 * freezes every kind with a published head across EVERY project store
 * (multi-design), is idempotent, and audits each freeze; unfreezeArtifact
 * requires a typed reason and audits it; a frozen artifact refuses the
 * CAS publish door (ties to db-publish.test.ts case 4).
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { freezeAllForHandoff, unfreezeArtifact, VELPARI_STORE_KINDS } from "../../src/ops/freeze.js";
import { writeFileSync as fsWrite } from "node:fs";
import { runDbPublish } from "../../src/ops/db-publish.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { setFrozen, getHeadRevision, type ArtifactEnvelopeInput, type ArtifactPayload } from "../../src/io/store.js";

const P1 = "Phase1FrzA";
const P2 = "Phase1FrzB";
const RUN_ID = "phase1-frz-run";
let dir: string;
const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function envelope(version: number): ArtifactEnvelopeInput {
	return {
		version,
		stage: "drafting-prd",
		generatedAt: "2026-09-27T00:00:00.000Z",
		changeLog: JSON.stringify([`2026-09-27: freeze fixture v${version}.`]),
	};
}

function rows(): ArtifactPayload {
	return {
		fr: [{ id: "FR-01", phase: 1, textHash: "a".repeat(64), text: "The system shall accept text input." }],
		nfr: [{ id: "NFR-01", phase: 1, textHash: "b".repeat(64), text: "p95 latency shall stay under 200 ms." }],
		prdSection: [{ no: 1, title: "Objective", body: "Prose for the objective." }],
	} as unknown as ArtifactPayload;
}

function dbPath(project: string): string {
	return join(dir, "Doc", "store", project, "index.db");
}

/**
 * Publish prd into every project DB listed. No git repos needed — the
 * freeze helpers and runDbPublish's DB path don't require one (the commit
 * step is skipped only in runDbPublish when git fails... it is not, so
 * each fixture dir gets a minimal repo).
 */
function publishPrd(project: string, version: number): void {
	const out = runDbPublish({
		cwd: dir,
		projectName: project,
		runId: RUN_ID,
		kind: "prd",
		yamlArtifact: "PRD",
		envelope: envelope(version),
		payload: rows(),
		publishedPaths: [],
	});
	assert.equal(out.ok, true, `publish into ${project} must succeed: ${out.problems.join("; ")}`);
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-phase1-frz-"));
	dirs.push(dir);
	// Multi-design config (review GAP 1): freezeAllForHandoff loops every
	// project store — the fixture must DECLARE both projects or the helper's
	// fallback (caller's single name) is the correct behavior, not a test.
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	fsWrite(
		join(dir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectNames: [P1, P2] }, null, 2) + "\n",
		"utf8",
	);
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

describe("Phase 1 freeze — N4 handoff freeze + typed-reason unfreeze", () => {
	test("freezes exactly the kinds with heads; audit entries written; count correct", () => {
		publishPrd(P1, 1);
		publishPrd(P2, 1); // second project store (same run id)

		const out = freezeAllForHandoff(dir, P1, RUN_ID);
		assert.equal(out.ok, true, out.problems.join("; "));
		assert.equal(out.frozen, 2, "one kind per project store, both with heads");

		for (const project of [P1, P2]) {
			const db = openStoreDb(dbPath(project));
			try {
				const flags = db.prepare("SELECT kind, frozen, freeze_reason FROM artifacts WHERE run_id = ?").all(RUN_ID) as Array<{
					kind: string;
					frozen: number;
					freeze_reason: string | null;
				}>;
				assert.equal(flags.length, 1);
				assert.equal(flags[0]!.frozen, 1);
				assert.equal(flags[0]!.freeze_reason, "handoff (N4)");
				const audits = db
					.prepare("SELECT COUNT(*) AS n FROM audit_ledger WHERE action = 'freeze' AND actor = ?")
					.get(`velpari:handoff:${RUN_ID}`) as { n: number };
				assert.equal(audits.n, 1, "one freeze audit entry per project");
			} finally {
				closeStoreDb(db);
			}
		}
	});

	test("second call is idempotent; frozen artifact refuses the CAS publish door", () => {
		publishPrd(P1, 1);
		assert.equal(freezeAllForHandoff(dir, P1, RUN_ID).ok, true);
		const again = freezeAllForHandoff(dir, P1, RUN_ID);
		assert.equal(again.ok, true);
		assert.equal(again.frozen, 1, "re-freezing the same head is a no-op success");

		// The frozen artifact refuses the CAS door (FrozenArtifactError path).
		const refused = runDbPublish({
			cwd: dir,
			projectName: P1,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(2),
			payload: rows(),
			publishedPaths: [],
		});
		assert.equal(refused.ok, false);
		assert.ok(refused.problems.some((p) => /frozen/.test(p)), refused.problems.join("; "));

		// Unfreeze with a typed reason → the publish goes through.
		const unfrozen = unfreezeArtifact(dir, P1, RUN_ID, "prd", "review completed, proceed to revision 2");
		assert.equal(unfrozen.ok, true, unfrozen.problems.join("; "));
		const ok = runDbPublish({
			cwd: dir,
			projectName: P1,
			runId: RUN_ID,
			kind: "prd",
			yamlArtifact: "PRD",
			envelope: envelope(2),
			payload: rows(),
			publishedPaths: [],
		});
		assert.equal(ok.ok, true, `publish after unfreeze must succeed: ${ok.problems.join("; ")}`);
		assert.equal(ok.revision!.revisionNumber, 2);
	});

	test("unfreeze without a reason is refused (N4 typed-reason rule)", () => {
		publishPrd(P1, 1);
		assert.equal(freezeAllForHandoff(dir, P1, RUN_ID).ok, true);

		const refused = unfreezeArtifact(dir, P1, RUN_ID, "prd", "   ");
		assert.equal(refused.ok, false);
		assert.ok(refused.problems.some((p) => /non-empty reason/.test(p)), refused.problems.join("; "));

		// Still frozen after the refused unfreeze.
		const db = openStoreDb(dbPath(P1));
		try {
			const row = db.prepare("SELECT frozen FROM artifacts WHERE run_id = ? AND kind = 'prd'").get(RUN_ID) as {
				frozen: number;
			};
			assert.equal(row.frozen, 1);
		} finally {
			closeStoreDb(db);
		}
	});

	test("no published heads → freeze succeeds with zero kinds (nothing to freeze)", () => {
		const out = freezeAllForHandoff(dir, P1, RUN_ID);
		assert.equal(out.ok, true, out.problems.join("; "));
		assert.equal(out.frozen, 0);
	});

	test("VELPARI_STORE_KINDS covers the 9 store kinds", () => {
		assert.equal(VELPARI_STORE_KINDS.length, 9);
		assert.ok(VELPARI_STORE_KINDS.includes("prd"));
		assert.ok(VELPARI_STORE_KINDS.includes("final-design"));
		// The freeze loop consults getHeadRevision per kind — a head on any
		// kind is freezable (spot-check via the store API directly).
		const db = openStoreDb(dbPath(P1));
		try {
			const out = runDbPublish({
				cwd: dir,
				projectName: P1,
				runId: RUN_ID,
				kind: "prd",
				yamlArtifact: "PRD",
				envelope: envelope(1),
				payload: rows(),
				publishedPaths: [],
			});
			assert.equal(out.ok, true);
			assert.ok(getHeadRevision(db, RUN_ID, "prd"), "head visible before freeze");
			setFrozen(db, RUN_ID, "prd", true, "spot");
			const after = getHeadRevision(db, RUN_ID, "prd");
			assert.ok(after, "head still readable while frozen");
		} finally {
			closeStoreDb(db);
		}
	});
});
