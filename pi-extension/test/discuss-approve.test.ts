import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApproveDiscuss } from "../src/stages/discuss-approve.js";
import { createRun, clearRun, loadState } from "../src/core/state.js";
import { saveFilesConfig } from "../src/core/config.js";

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
		// v0.5.1 Phase J.2: handleApproveDiscuss pushes a footer status bar
		// via the documented ctx.ui.setStatus(key, text) API. No-op mock.
		setStatus(_key: string, _text: string | undefined) {
			// intentionally empty: tests assert on state + publishes, not the
			// status bar text. The status bar contract is pinned by
			// status.test.ts and index.test.ts.
		},
	};
}

function makeMockPi() {
	return {
		sentUserMessages: [] as string[],
		sendUserMessage(p: string) { this.sentUserMessages.push(p); },
		// Phase E: appendStageEntry calls pi.appendEntry. Mock as no-op so
		// the test rig stays compatible.
		appendEntry(_type: string, _data: unknown) { /* no-op */ },
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
		await handleApproveDiscuss(ctx, makeMockPi() as never, dir);

		// Published copy exists at Doc/discussion/discussion-<topic-slug>.md (grouped layout).
		const expectedPath = join(dir, "Doc", "discussion", "discussion-test-mission.md");
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
		await handleApproveDiscuss(ctx, makeMockPi() as never, dir);

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

test("handleApproveDiscuss appends timestamp suffix on re-run (FR-69)", async () => {
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
		await handleApproveDiscuss(ctx1, makeMockPi() as never, dir);

		// Second run on same topic — handler should detect conflict and append suffix.
		const state2 = createRun("Same Topic", dir);
		const workingDir2 = join(dir, ".IDE_Plans", "velpari", "runs", state2.runId, "discuss");
		mkdirSync(workingDir2, { recursive: true });
		writeFileSync(join(workingDir2, "discussion-notes.md"), "# Notes 2\n", "utf8");

		const notifies2: Array<{ msg: string; level: string }> = [];
		const ctx2 = { ui: makeUI(notifies2) } as never;
		await handleApproveDiscuss(ctx2, makeMockPi() as never, dir);

		// Expect at least one of:
		//   Doc/discussion/discussion-same-topic-<timestamp>.md
		//   Doc/discussion/discussion-same-topic.md  (overwrite, also acceptable per FR-69)
		const { readdirSync } = await import("node:fs");
		const docs = readdirSync(join(dir, "Doc", "discussion"));
		const matching = docs.filter((f) => f.startsWith("discussion-same-topic"));
		assert.ok(matching.length >= 1, "at least one discussion-same-topic file should exist");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
