import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	advanceStage,
	appendStageEntry,
	clearRun,
	createRun,
	loadState,
	saveState,
	type RunState,
} from "../src/core/state.js";

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
			currentStage: "discussed",
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

// ---------------------------------------------------------------------------
// appendStageEntry — Phase E followup
//
// The customType "velpari-state" and the field set (runId, mission, stage,
// updatedAt, history) are part of the contract other extensions / session
// forks rely on. Pin the shape directly.
// ---------------------------------------------------------------------------

test("appendStageEntry uses customType 'velpari-state' with the documented field set", () => {
	const captured: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		appendEntry(customType: string, data: unknown) {
			captured.push({ customType, data });
		},
	};
	const state: RunState = {
		version: 1,
		runId: "2026-09-05-test-run",
		mission: "test mission",
		currentStage: "planning-tests",
		history: [{ stage: "planning-tests", command: "/velpari-approve", timestamp: "2026-09-05T10:00:00Z" }],
		updatedAt: "2026-09-05T10:00:00Z",
	};
	appendStageEntry(pi as never, state);

	assert.equal(captured.length, 1, "appendEntry must be called exactly once");
	const entry = captured[0]!;
	assert.equal(entry.customType, "velpari-state");
	// appendStageEntry emits field `stage` (not RunState's `currentStage`) so
	// downstream session-fork handlers can stay schema-stable across
	// refactors. Cast loosens the type so we can assert on the emitted keys.
	const data = entry.data as Record<string, unknown>;
	assert.equal(data.runId, state.runId);
	assert.equal(data.mission, state.mission);
	assert.equal(data.stage, state.currentStage);
	assert.equal(data.updatedAt, state.updatedAt);
	assert.deepEqual(data.history, state.history);
});

// ---------------------------------------------------------------------------
// v0.5.1 Phase J.1 — --velpari-stage flag wiring.
//
// advanceStage now accepts an optional `pi` parameter. When the
// `velpari-stage` flag is set to a non-empty string, the override
// replaces the computed transition target. The command itself is still
// recorded in history so the audit trail is preserved.
// ---------------------------------------------------------------------------

test("advanceStage honors --velpari-stage flag when set", () => {
	const dir = tempDir();
	try {
		// Build a state at "discussing" so /velpari-approve would normally
		// transition to "drafted-prd". With the override flag set to
		// "planned-tests", the override wins.
		const state: RunState = {
			version: 1,
			runId: "test-run",
			mission: "Test Mission",
			currentStage: "discussed",
			history: [],
			updatedAt: "2026-09-05T00:00:00Z",
		};
		const pi = {
			getFlag: (name: string) => (name === "velpari-stage" ? "planned-tests" : undefined),
		};
		const next = advanceStage(state, "/velpari-approve", dir, pi as never);
		assert.equal(next.currentStage, "planned-tests");
		// Command is still the one that was invoked; the override only
		// changes the target stage.
		assert.equal(next.history.at(-1)!.command, "/velpari-approve");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("advanceStage falls back to STAGE_TRANSITIONS when --velpari-stage is not set", () => {
	const dir = tempDir();
	try {
		// Start at "drafting-prd" (after /velpari-prd). /velpari-approve
		// normally transitions to "drafted-prd".
		const state: RunState = {
			version: 1,
			runId: "test-run",
			mission: "Test Mission",
			currentStage: "drafting-prd",
			history: [],
			updatedAt: "2026-09-05T00:00:00Z",
		};
		const pi = { getFlag: () => undefined };
		const next = advanceStage(state, "/velpari-approve", dir, pi as never);
		assert.equal(next.currentStage, "drafted-prd");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
