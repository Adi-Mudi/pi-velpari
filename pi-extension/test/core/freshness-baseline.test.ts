/**
 * Tests of the F7 baseline stamp (core/freshness.ts:recordStageBaselines):
 * a starting stage adopts the current head revision of every upstream kind;
 * the baselines table records (kind, consumer_stage) → revision_id; the
 * helper is best-effort (missing store = returned message, never a throw).
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { recordStageBaselines } from "../../src/core/freshness.js";
import { runDbPublish } from "../../src/ops/db-publish.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import type { ArtifactEnvelopeInput, ArtifactPayload } from "../../src/io/store.js";

const PROJECT = "Phase1Base";
let dir: string;
const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

const RUN_ID = "phase1-base-run";

function envelope(version: number): ArtifactEnvelopeInput {
	return {
		version,
		stage: "drafting-prd",
		generatedAt: "2026-09-27T00:00:00.000Z",
		changeLog: JSON.stringify([`2026-09-27: baseline fixture v${version}.`]),
	};
}

function rows(): ArtifactPayload {
	return {
		fr: [{ id: "FR-01", phase: 1, textHash: "a".repeat(64), text: "The system shall accept text input." }],
		nfr: [{ id: "NFR-01", phase: 1, textHash: "b".repeat(64), text: "p95 latency shall stay under 200 ms." }],
		prdSection: [{ no: 1, title: "Objective", body: "Prose for the objective." }],
	} as unknown as ArtifactPayload;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-phase1-base-"));
	dirs.push(dir);
	// runDbPublish's git commit step needs a repo — pin identity + isolate
	// ambient config (Design 9, same as db-publish.test.ts).
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

describe("Phase 1 baselines — F7 downstream adoption", () => {
	test("stage start stamps (kind, consumer) → head revision; re-publish moves the row", () => {
		// Publish prd rev 1, then start the RTM stage.
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
		assert.equal(out.ok, true, out.problems.join("; "));

		assert.equal(recordStageBaselines(dir, PROJECT, RUN_ID, "building-rtm"), null);
		assert.equal(recordStageBaselines(dir, PROJECT, RUN_ID, "analyzing-feasibility"), null);

		const db = openStoreDb(join(dir, "Doc", "store", PROJECT, "index.db"));
		try {
			const rows1 = db
				.prepare("SELECT consumer_stage, revision_id FROM baselines WHERE kind = 'prd' ORDER BY consumer_stage")
				.all() as Array<{ consumer_stage: string; revision_id: number }>;
			assert.equal(rows1.length, 2, "both consuming stages stamped");
			const rev1 = rows1[0]!.revision_id;

			// Re-publish prd (rev 2), re-stamp — the row moves to the newer revision.
			const out2 = runDbPublish({
				cwd: dir,
				projectName: PROJECT,
				runId: RUN_ID,
				kind: "prd",
				yamlArtifact: "PRD",
				envelope: envelope(2),
				payload: rows(),
				publishedPaths: [],
			});
			assert.equal(out2.ok, true, out2.problems.join("; "));
			assert.equal(recordStageBaselines(dir, PROJECT, RUN_ID, "building-rtm"), null);

			const rows2 = db
				.prepare("SELECT consumer_stage, revision_id FROM baselines WHERE kind = 'prd' AND consumer_stage = 'building-rtm'")
				.all() as Array<{ consumer_stage: string; revision_id: number }>;
			assert.equal(rows2.length, 1, "upsert — one row per (kind, consumer)");
			assert.notEqual(rows2[0]!.revision_id, rev1, "the row moved to the newer revision");
		} finally {
			closeStoreDb(db);
		}
	});

	test("no upstream published → silent no-op (null, no rows); unknown stage → no-op", () => {
		// No publish happened at all.
		assert.equal(recordStageBaselines(dir, PROJECT, RUN_ID, "building-rtm"), null);
		// Brainstorm has no upstream entry.
		assert.equal(recordStageBaselines(dir, PROJECT, RUN_ID, "brainstorming"), null);

		const db = openStoreDb(join(dir, "Doc", "store", PROJECT, "index.db"));
		try {
			const n = db.prepare("SELECT COUNT(*) AS n FROM baselines").get() as { n: number };
			assert.equal(n.n, 0, "nothing stamped when no upstream head exists");
		} finally {
			closeStoreDb(db);
		}
	});

	test("missing store → error message returned, never thrown", () => {
		const missingDir = join(dir, "no-store-here");
		mkdirSync(missingDir, { recursive: true });
		const err = recordStageBaselines(missingDir, PROJECT, RUN_ID, "building-rtm");
		assert.equal(typeof err === "string" || err === null, true, "returns a message or null — never throws");
	});
});
