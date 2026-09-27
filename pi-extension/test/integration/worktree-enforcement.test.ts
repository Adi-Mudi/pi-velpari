/**
 * Integration — worktree enforcement end to end (Phase 5, N5/N6/N8/N14).
 *
 * One real fixture repo per flow (plus a real second `git worktree`), with a
 * real project store where the A/B verdict needs published revisions:
 *   1. state carried into another worktree → N6 block naming both folders;
 *   2. two live bindings claiming one folder → N5 block with the N5 wording;
 *   3. a foreign published revision → N8-B block naming artifact/rev/run/commit
 *      (+ the same facts in /velpari-status);
 *   4. own-run staleness → no hard block, report written, Type A wording;
 *   5. publish pre-check refuses from the wrong worktree;
 *   6. close paths (handoff / reset) release the folder for a new line.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { buildChangeReport, changeReportPath, writeChangeReport } from "../../src/core/change-report.js";
import { closeRunBinding, foreignLinesInWorktree, writeRunBinding } from "../../src/core/run-binding.js";
import { appendHistory } from "../../src/core/history.js";
import { saveState, type RunState } from "../../src/core/state.js";
import { hashFileContent } from "../../src/core/fingerprints.js";
import { recordPublish } from "../../src/core/freshness.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { publishArtifactCas, writeArtifact, type ArtifactPayload } from "../../src/io/store.js";
import { verifyRunStartLine, verifyRunWorktree, verifyUpstreamMoves } from "../../src/stages/worktree-lock.js";
import { precheckGitForPublish } from "../../src/ops/db-publish.js";

const PROJECT = "TestApp";
const IDENT = ["-c", "user.email=velpari@test.local", "-c", "user.name=Velpari Test"];

let dirs: string[] = [];

function freshDir(prefix = "velpari-wt-int-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function initRepo(dir: string, branch: string): void {
	execFileSync("git", ["init", "-b", branch], { cwd: dir });
	execFileSync("git", [...IDENT, "commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

function writeConfig(dir: string): void {
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(dir, ".pi", "velpari", "files.json"), JSON.stringify({ version: 4, projectName: PROJECT }));
}

/** A live run line bound to `dir` on `branch` (state + history + binding). */
function seedLine(dir: string, runId: string, branch: string, stage = "building-rtm"): RunState {
	const state: RunState = {
		version: 1,
		runId,
		mission: `mission ${runId}`,
		currentStage: stage as RunState["currentStage"],
		updatedAt: "2026-09-27T00:00:00.000Z",
		runWorktree: dir,
		runBranch: branch,
	};
	saveState(state, dir);
	appendHistory(dir, runId, { stage: "brainstorming", command: "/velpari-brainstorm", timestamp: "t0" });
	writeRunBinding(dir, { runId, branch, worktree: dir, startedAt: "t0", status: "active" });
	return state;
}

/** Publish one minimal PRD revision owned by `runId`. */
function publishPrd(dir: string, runId: string, textHash: string): void {
	const db = openStoreDb(buildStoreDbPath(PROJECT, dir));
	try {
		writeArtifact(db, "prd", runId, { version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" }, {
			fr: [{ id: "FR-1", phase: 1, textHash, text: `Prose ${textHash}.` }],
		} as ArtifactPayload);
		publishArtifactCas(db, runId, "prd", null);
	} finally {
		closeStoreDb(db);
	}
}

/** Make `rtm` stale: it consumed the project PRD, then that PRD changed. */
function makeRtmStale(dir: string): void {
	mkdirSync(join(dir, "Doc", "requirements"), { recursive: true });
	const prdPath = join(dir, "Doc", "requirements", `PRD_${PROJECT}.md`);
	writeFileSync(prdPath, "# PRD\n", "utf8");
	writeFileSync(join(dir, "Doc", "requirements", `RTM_${PROJECT}.md`), "# RTM\n", "utf8");
	recordPublish(dir, {
		artifact: "rtm",
		projectName: PROJECT,
		path: `Doc/requirements/RTM_${PROJECT}.md`,
		publishedAt: "2026-09-27T00:00:00.000Z",
		inputs: { [`prd:${PROJECT}`]: hashFileContent(prdPath)! },
	});
	writeFileSync(prdPath, "# PRD\nedited downstream\n", "utf8");
}

beforeEach(() => {
	dirs = [];
});

afterEach(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("worktree enforcement — end-to-end flows (Phase 5)", () => {
	it("N6: state carried into a second worktree is blocked, naming both folders", () => {
		const dirA = freshDir();
		initRepo(dirA, "velpari/line-A");
		writeConfig(dirA);
		const state = seedLine(dirA, "run-A", "velpari/line-A");

		const parent = freshDir();
		const dirB = join(parent, "line-b");
		execFileSync("git", ["worktree", "add", dirB, "-b", "velpari/line-B"], { cwd: dirA });
		cpSync(join(dirA, ".pi"), join(dirB, ".pi"), { recursive: true });
		cpSync(join(dirA, ".IDE_Plans"), join(dirB, ".IDE_Plans"), { recursive: true });

		const verdict = verifyRunWorktree(state, dirB);
		assert.equal(verdict.ok, false);
		const reason = verdict.ok ? "" : verdict.reason;
		assert.ok(reason.includes(dirA), "names the bound worktree");
		assert.ok(reason.includes(dirB), "names the current folder");
		assert.match(reason, /git worktree add \.\.\//);

		// …and the same run is fine in its own folder.
		assert.equal(verifyRunWorktree(state, dirA).ok, true);
	});

	it("N5: a second live line claiming the folder is blocked with the N5 wording", () => {
		const dir = freshDir();
		initRepo(dir, "velpari/line-A");
		writeConfig(dir);
		// Two live lines in one folder (a hand-copied `.pi/velpari`).
		seedLine(dir, "run-A", "velpari/line-A");
		const current = seedLine(dir, "run-B", "velpari/line-A");

		const lines = foreignLinesInWorktree(dir, current.runId);
		assert.deepEqual(
			lines.map((line) => line.runId),
			["run-A"],
		);
		const verdict = verifyRunStartLine(current, dir);
		assert.equal(verdict.ok, false);
		assert.match(verdict.ok ? "" : verdict.reason, /Run run-A is parallel to active run run-B/);
		assert.match(verdict.ok ? "" : verdict.reason, /git worktree add \.\.\//);
	});

	it("N8-B: a foreign published revision blocks with artifact/revision/run/commit", () => {
		const dir = freshDir();
		initRepo(dir, "velpari/line-A");
		writeConfig(dir);
		const state = seedLine(dir, "run-A", "velpari/line-A");
		execFileSync("git", ["add", "-A"], { cwd: dir });
		execFileSync("git", [...IDENT, "commit", "-m", "project"], { cwd: dir });

		publishPrd(dir, "run-A", "aaa111");
		publishPrd(dir, "run-B", "bbb222"); // foreign revision 2
		makeRtmStale(dir);

		const report = buildChangeReport(dir, state, { stage: "building-rtm" });
		const verdict = verifyUpstreamMoves(state, dir, { report });
		assert.equal(verdict.ok, false);
		const reason = verdict.ok ? "" : verdict.reason;
		assert.match(reason, /STOP — upstream moved by another run line \(N8-B\)/);
		assert.match(reason, /prd rev 2 published by run run-B/);
		assert.match(reason, /your line is at rev 1/);
		assert.match(reason, /git worktree add \.\.\//);

		// The same facts land in the report of record.
		const path = writeChangeReport(dir, report);
		const text = readFileSync(path, "utf8");
		assert.match(text, /published revision: 2 by run run-B/);
		assert.equal(existsSync(changeReportPath(dir, "run-A")), true);
	});

	it("Type A (own-run): no hard block, report written, own-run wording", () => {
		const dir = freshDir();
		initRepo(dir, "velpari/line-A");
		writeConfig(dir);
		const state = seedLine(dir, "run-A", "velpari/line-A");

		publishPrd(dir, "run-A", "aaa111");
		makeRtmStale(dir);

		const report = buildChangeReport(dir, state, { stage: "building-rtm" });
		assert.equal(report.entries[0]!.classification, "own-run");
		assert.match(report.entries[0]!.detail, /your own flow moved prd to rev 1/);
		assert.equal(verifyUpstreamMoves(state, dir, { report }).ok, true, "Type A never hard-blocks");
		const path = writeChangeReport(dir, report);
		assert.match(readFileSync(path, "utf8"), /your own flow moved prd/);
	});

	it("publish pre-check refuses from the wrong worktree, allows the bound one", () => {
		const dirA = freshDir();
		initRepo(dirA, "velpari/line-A");
		const state = seedLine(dirA, "run-A", "velpari/line-A");

		const parent = freshDir();
		const dirB = join(parent, "line-b");
		execFileSync("git", ["worktree", "add", dirB, "-b", "velpari/line-B"], { cwd: dirA });

		const bad = precheckGitForPublish(dirB, state);
		assert.equal(bad.ok, false);
		assert.match(bad.problems.join("\n"), /publish must run in the run's worktree/);

		const good = precheckGitForPublish(dirA, state);
		assert.equal(good.ok, true, good.problems.join("; "));
	});

	it("close paths release the folder: handoff and reset both unblock a new line", () => {
		const dir = freshDir();
		initRepo(dir, "velpari/line-A");
		writeConfig(dir);
		seedLine(dir, "run-A", "velpari/line-A");

		assert.equal(foreignLinesInWorktree(dir, "run-B").length, 1);
		assert.equal(closeRunBinding(dir, "run-A", "handoff"), true);
		assert.equal(foreignLinesInWorktree(dir, "run-B").length, 0, "handoff releases the folder");

		seedLine(dir, "run-C", "velpari/line-A");
		assert.equal(closeRunBinding(dir, "run-C", "reset"), true);
		assert.equal(foreignLinesInWorktree(dir, "run-D").length, 0, "reset releases the folder");
	});
});

