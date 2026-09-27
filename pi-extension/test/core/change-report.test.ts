// Tests — core/change-report.ts (Phase 5, F14 + N8).
// Builds real staleness (recordPublish + an edited input) and a real store
// (two runs publishing PRD), then asserts: the empty report, the Type B
// (foreign-run) wording with the worktree fix, the Type A (own-run) wording
// without it, the kinds filter, the rendered "behind upstream" line, stable
// markdown, and the file landing in the run folder.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	buildChangeReport,
	changeReportPath,
	renderChangeReport,
	writeChangeReport,
	type ChangeReport,
} from "../../src/core/change-report.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { publishArtifactCas, writeArtifact, type ArtifactPayload } from "../../src/io/store.js";
import { hashFileContent } from "../../src/core/fingerprints.js";
import { recordPublish } from "../../src/core/freshness.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { createRun, type RunState } from "../../src/core/state.js";

const PROJECT = "TestApp";

let dirs: string[] = [];

function freshDir(prefix = "velpari-changereport-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function writeAt(root: string, rel: string, content: string): string {
	const abs = join(root, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content);
	return abs;
}

function writeFilesConfig(root: string): void {
	writeAt(root, join(".pi", "velpari", "files.json"), JSON.stringify({ version: 4, projectName: PROJECT }));
}

/** Publish one minimal PRD revision for `runId` into the project store. */
function publishPrd(root: string, runId: string, textHash: string): void {
	const db = openStoreDb(buildStoreDbPath(PROJECT, root));
	try {
		writeArtifact(db, "prd", runId, { version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" }, {
			fr: [{ id: "FR-1", phase: 1, textHash, text: `Prose for ${textHash}.` }],
		} as ArtifactPayload);
		publishArtifactCas(db, runId, "prd", null);
	} finally {
		closeStoreDb(db);
	}
}

/** Make `rtm` stale: it consumed the PRD file, then that file changed. */
function makeRtmStale(root: string): void {
	const prdPath = writeAt(root, join("Doc", "requirements", `PRD_${PROJECT}.md`), "# PRD\n");
	writeAt(root, join("Doc", "requirements", `RTM_${PROJECT}.md`), "# RTM\n");
	recordPublish(root, {
		artifact: "rtm",
		projectName: PROJECT,
		path: `Doc/requirements/RTM_${PROJECT}.md`,
		publishedAt: "2026-09-27T00:00:00.000Z",
		inputs: { [`prd:${PROJECT}`]: hashFileContent(prdPath)! },
	});
	writeFileSync(prdPath, "# PRD\nedited after the RTM consumed it\n", "utf8");
}

/** A run state for `runId` (state.json itself is irrelevant to the report). */
function runState(root: string, runId: string): RunState {
	return { ...createRun("report mission", root), runId };
}

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("buildChangeReport — F14 + N8", () => {
	let dir: string;
	beforeEach(() => {
		dir = freshDir();
		writeFilesConfig(dir);
	});

	test("clean run: no entries, no foreign lines, 'nothing to confirm' text", () => {
		const report = buildChangeReport(dir, runState(dir, "run-A"), { stage: "building-rtm" });
		assert.deepEqual(report.entries, []);
		assert.deepEqual(report.foreignLines, []);
		assert.equal(report.stage, "building-rtm");
		assert.match(report.text, /No upstream movement — nothing to confirm\./);
		assert.match(report.text, /- verdict: ok/);
	});

	test("Type B (foreign-run): STOP wording + the git worktree add fix", () => {
		publishPrd(dir, "run-A", "aaa111");
		publishPrd(dir, "run-B", "bbb222");
		makeRtmStale(dir);

		const report = buildChangeReport(dir, runState(dir, "run-A"));
		assert.equal(report.entries.length, 1);
		const entry = report.entries[0]!;
		assert.equal(entry.artifact, "rtm", "the stale consumer is the RTM");
		assert.equal(entry.kind, "rtm");
		assert.equal(entry.reason, "input-changed");
		assert.equal(entry.classification, "foreign-run");
		assert.equal(entry.move!.kind, "prd", "the moved artifact is the changed INPUT (PRD)");
		assert.match(entry.detail, /^STOP — foreign run run-B published prd rev 2/);
		assert.match(entry.detail, /git worktree add \.\.\//);
		assert.match(entry.detail, /your line is at rev 1/);
		assert.match(report.text, /published revision: 2 by run run-B/);
	});

	test("Type A (own-run): review + confirm wording, no worktree demand", () => {
		publishPrd(dir, "run-A", "aaa111");
		makeRtmStale(dir);

		const report = buildChangeReport(dir, runState(dir, "run-A"));
		const entry = report.entries[0]!;
		assert.equal(entry.classification, "own-run");
		assert.equal(entry.move!.kind, "prd");
		assert.match(entry.detail, /your own flow moved prd to rev 1/);
		assert.doesNotMatch(entry.detail, /git worktree add/);
		assert.match(entry.detail, /velpari-reconfirm/);
	});

	test("a file-only input (brainstorm notes) is own-run, never a foreign move", () => {
		const notesPath = writeAt(dir, join("Doc", "brainstorm", "brainstorm-cli-todo.md"), "# notes\n");
		writeAt(dir, join("Doc", "requirements", `PRD_${PROJECT}.md`), "# PRD\n");
		recordPublish(dir, {
			artifact: "prd",
			projectName: PROJECT,
			path: `Doc/requirements/PRD_${PROJECT}.md`,
			publishedAt: "2026-09-27T00:00:00.000Z",
			inputs: { "brainstorm:cli-todo": hashFileContent(notesPath)! },
		});
		writeFileSync(notesPath, "# notes\nedited\n", "utf8");

		const entry = buildChangeReport(dir, runState(dir, "run-A")).entries[0]!;
		assert.equal(entry.artifact, "prd");
		assert.equal(entry.move, null);
		assert.equal(entry.classification, "own-run");
	});

	test("kinds filter narrows the report to the stage's inputs", () => {
		publishPrd(dir, "run-A", "aaa111");
		makeRtmStale(dir);

		assert.equal(buildChangeReport(dir, runState(dir, "run-A"), { kinds: ["prd"] }).entries.length, 0);
		assert.equal(buildChangeReport(dir, runState(dir, "run-A"), { kinds: ["rtm"] }).entries.length, 1);
		assert.equal(buildChangeReport(dir, runState(dir, "run-A"), { kinds: ["testplan"] }).entries.length, 0);
	});

	test("markdown is stable across builds (only generatedAt varies)", () => {
		makeRtmStale(dir);
		const state = runState(dir, "run-A");
		const strip = (report: ChangeReport) => report.text.replace(/^Generated: .*$/m, "Generated: X");
		assert.equal(strip(buildChangeReport(dir, state)), strip(buildChangeReport(dir, state)));
	});

	test("writeChangeReport lands in the run folder with the rendered text", () => {
		makeRtmStale(dir);
		const state = runState(dir, "run-A");
		const report = buildChangeReport(dir, state);
		const path = writeChangeReport(dir, report);

		assert.equal(path, changeReportPath(dir, "run-A"));
		assert.ok(existsSync(path));
		assert.equal(readFileSync(path, "utf8"), report.text);
		assert.match(readFileSync(path, "utf8"), /# Change report — run run-A/);
	});
});

describe("renderChangeReport — renderer rules", () => {
	test("renders the behind-upstream advise and the N14 limitation note", () => {
		const report: ChangeReport = {
			runId: "run-A",
			stage: "building-rtm",
			generatedAt: "2026-09-27T00:00:00.000Z",
			worktree: {
				bound: "/tmp/wt-a",
				current: "/tmp/wt-a",
				boundBranch: "velpari/line-A",
				currentBranch: "velpari/line-A",
				mismatch: false,
				upstream: "origin/velpari/line-A",
				behind: 3,
			},
			foreignLines: [],
			entries: [],
			text: "",
		};
		const text = renderChangeReport(report);
		assert.match(text, /behind-upstream: 3 commit\(s\) behind origin\/velpari\/line-A/);
		assert.match(text, /cross-machine limitation/);
		assert.match(text, /- bound: \/tmp\/wt-a @ velpari\/line-A/);
	});

	test("flags a worktree mismatch in the verdict line", () => {
		const report: ChangeReport = {
			runId: "run-A",
			stage: "building-rtm",
			generatedAt: "2026-09-27T00:00:00.000Z",
			worktree: {
				bound: "/tmp/wt-a",
				current: "/tmp/wt-b",
				boundBranch: "velpari/line-A",
				currentBranch: "velpari/line-B",
				mismatch: true,
				upstream: null,
				behind: 0,
			},
			foreignLines: [{ runId: "run-B", branch: "velpari/line-B", worktree: "/tmp/wt-b", startedAt: "t", status: "active" }],
			entries: [],
			text: "",
		};
		const text = renderChangeReport(report);
		assert.match(text, /verdict: MISMATCH/);
		assert.match(text, /- run run-B @ velpari\/line-B — git worktree add \.\.\//);
	});
});

