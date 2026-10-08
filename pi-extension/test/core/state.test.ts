// Unit tests — core/state.ts general RunState fields (Foundation 2026-09-27).
// Covers: setRunWorktreeBranch round-trip (N5/N6 runBranch/runWorktree),
// validation (empty branch/worktree rejected), absent-on-empty-state.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadState, createRun, setRunWorktreeBranch } from "../../src/core/state.js";

describe("state — runBranch/runWorktree (N5/N6, Foundation)", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "velpari-state-wt-"));
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("absent on a fresh empty state", () => {
		const state = loadState(dir);
		assert.equal(state.runBranch, undefined);
		assert.equal(state.runWorktree, undefined);
	});

	test("set → save → load round-trips both fields", () => {
		const state = createRun("test mission", dir);
		setRunWorktreeBranch(state, "velpari/phase-1-publish", join(dir, "wt-publish"), dir);
		const loaded = loadState(dir);
		assert.equal(loaded.runBranch, "velpari/phase-1-publish");
		assert.equal(loaded.runWorktree, join(dir, "wt-publish"));
	});

	test("empty branch or worktree rejected", () => {
		const state = createRun("test mission", dir);
		assert.throws(() => setRunWorktreeBranch(state, "", "/x", dir), /non-empty/);
		assert.throws(() => setRunWorktreeBranch(state, "main", "  ", dir), /non-empty/);
	});

	test("other state fields survive the setter (spread, not replace)", () => {
		const state = createRun("keep me", dir);
		setRunWorktreeBranch(state, "main", dir, dir);
		const loaded = loadState(dir);
		assert.equal(loaded.mission, "keep me");
		assert.equal(loaded.currentStage, "brainstorming");
		assert.ok(loaded.runId.length > 0);
	});
});
