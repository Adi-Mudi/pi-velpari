import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApproveDiscuss } from "../src/discuss-approve.js";
import { createRun, clearRun, loadState } from "../src/state.js";
import { saveFilesConfig } from "../src/config.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-discuss-approve-"));
}

function makeUI(notifies: Array<{ msg: string; level: string }>) {
	return {
		notifies,
		async confirm(_t: string, _m: string) {
			return true;
		},
		notify(msg: string, level: string) {
			notifies.push({ msg, level });
		},
	};
}

test("handleApproveDiscuss publishes working copy to Doc/", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{
				version: 3,
				projectName: "TestApp",
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		const state = createRun("Test Mission", dir);
		// Write a fake working copy
		const { writeFileSync, mkdirSync } = await import("node:fs");
		const workingDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "discuss");
		mkdirSync(workingDir, { recursive: true });
		const workingPath = join(workingDir, "discussion-notes.md");
		writeFileSync(workingPath, "# Discussion Notes — Test Mission\n\n## Mission\nTest Mission\n", "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleApproveDiscuss(ctx, dir);

		// Published copy exists at Doc/discussion-<topic-slug>.md
		const expectedPath = join(dir, "Doc", "discussion-test-mission.md");
		assert.ok(existsSync(expectedPath), "published copy not created");
		const content = readFileSync(expectedPath, "utf8");
		assert.match(content, /Test Mission/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleApproveDiscuss advances state to discussed", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{
				version: 3,
				projectName: "TestApp",
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		const state = createRun("Mission", dir);
		const { writeFileSync, mkdirSync } = await import("node:fs");
		const workingDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "discuss");
		mkdirSync(workingDir, { recursive: true });
		writeFileSync(join(workingDir, "discussion-notes.md"), "# Notes\n", "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleApproveDiscuss(ctx, dir);

		// After approve-discuss: state should be "discussed".
		// The chained handlePrd will error out because state is "discussed" not "drafting-prd",
		// and that's OK — the transition itself was the test target.
		const after = loadState(dir);
		assert.equal(after.currentStage, "discussed", "state should be 'discussed' after approve-discuss");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// TODO Phase C: implement timestamp suffix on re-run (FR-69).
// For now this test is marked as TODO and not active. The handler in Phase B does
// not yet detect filename conflicts; it always writes to Doc/discussion-<slug>.md.
// When the handler is extended, this test should be uncommented and the assertion verified.
test.todo("handleApproveDiscuss appends timestamp suffix on re-run (FR-69)", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{
				version: 3,
				projectName: "TestApp",
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		const state = createRun("Same Topic", dir);
		const { writeFileSync, mkdirSync } = await import("node:fs");
		const workingDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "discuss");
		mkdirSync(workingDir, { recursive: true });
		writeFileSync(join(workingDir, "discussion-notes.md"), "# Notes\n", "utf8");

		const notifies1: Array<{ msg: string; level: string }> = [];
		const ctx1 = { ui: makeUI(notifies1) } as never;
		await handleApproveDiscuss(ctx1, dir);

		// Second run on same topic — handler should detect conflict and append suffix.
		const state2 = createRun("Same Topic", dir);
		const workingDir2 = join(dir, ".IDE_Plans", "velpari", "runs", state2.runId, "discuss");
		mkdirSync(workingDir2, { recursive: true });
		writeFileSync(join(workingDir2, "discussion-notes.md"), "# Notes 2\n", "utf8");

		const notifies2: Array<{ msg: string; level: string }> = [];
		const ctx2 = { ui: makeUI(notifies2) } as never;
		await handleApproveDiscuss(ctx2, dir);

		// Expect at least one of:
		//   Doc/discussion-same-topic-<timestamp>.md
		//   Doc/discussion-same-topic.md  (overwrite, also acceptable per FR-69)
		const { readdirSync } = await import("node:fs");
		const docs = readdirSync(join(dir, "Doc"));
		const matching = docs.filter((f) => f.startsWith("discussion-same-topic"));
		assert.ok(matching.length >= 1, "at least one discussion-same-topic file should exist");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
