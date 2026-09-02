import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, createRun, clearRun, type RunState } from "../src/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-state-"));
}

test("loadState returns empty state when no file exists", () => {
	const dir = tempDir();
	try {
		const state = loadState(dir);
		assert.equal(state.currentStage, "none");
		assert.equal(state.runId, "");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("saveState + loadState round-trip", () => {
	const dir = tempDir();
	try {
		const state: RunState = {
			version: 1,
			runId: "2026-09-02-test",
			mission: "test mission",
			currentStage: "discussing",
			history: [],
			updatedAt: "2026-09-02T00:00:00Z",
		};
		saveState(state, dir);
		const loaded = loadState(dir);
		assert.equal(loaded.runId, state.runId);
		assert.equal(loaded.mission, state.mission);
		assert.equal(loaded.currentStage, state.currentStage);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("createRun sets currentStage to 'discussing' and generates runId", () => {
	const dir = tempDir();
	try {
		const state = createRun("Test Mission With Spaces", dir);
		assert.equal(state.currentStage, "discussing");
		assert.match(state.runId, /test-mission-with-spaces/);
		assert.equal(state.mission, "Test Mission With Spaces");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("clearRun removes state file", () => {
	const dir = tempDir();
	try {
		createRun("To Be Cleared", dir);
		clearRun(dir);
		const state = loadState(dir);
		assert.equal(state.currentStage, "none");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
