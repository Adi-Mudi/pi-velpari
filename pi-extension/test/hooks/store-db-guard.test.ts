/**
 * Store DB scope guard tests (Phase 8 — tool_call write-lock covers the
 * stage DB scope).
 *
 * Covers: store-path blocks (DB file + YAML view + missing state), the
 * between-stages gap this guard closes (no state at all), non-store
 * paths stay free, read tools unaffected, fail-open on malformed input,
 * and ordering (non-store stage-folder writes still governed by the
 * stage lock, not shadowed).
 */

import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import * as path from "node:path";
import { guardStoreDbMutation, guardStageMutation } from "../../src/hooks/tool-call.js";
import type { RunState } from "../../src/core/state.js";

let cwd = "";

beforeEach(() => {
	// No filesystem access needed — the guard is path arithmetic only.
	cwd = path.resolve("/tmp/velpari-store-guard-fixture");
});

function stateWith(stage: string, runId = "r1"): RunState {
	return { runId, currentStage: stage, mission: "m" } as unknown as RunState;
}

describe("guardStoreDbMutation", () => {
	it("blocks write into the store DB file — even with NO state (between-stages gap)", () => {
		const block = guardStoreDbMutation("write", { path: path.join(cwd, "Doc", "store", "TodoApp", "index.db") }, cwd);
		assert.ok(block, "expected a block for the store DB path");
		assert.match(block.reason, /never edited by hand/);
		assert.match(block.reason, /velpari-backfill/);
	});

	it("blocks edit into an exported YAML view beside the DB", () => {
		const block = guardStoreDbMutation(
			"edit",
			{ path: path.join(cwd, "Doc", "store", "TodoApp", "PRD_TodoApp.yaml") },
			cwd,
		);
		assert.ok(block, "expected a block for the store YAML path");
	});

	it("blocks nested store paths (per-project subfolders)", () => {
		const block = guardStoreDbMutation(
			"write",
			{ path: path.join(cwd, "Doc", "store", "alpha", "sub", "evil.db") },
			cwd,
		);
		assert.ok(block);
	});

	it("allows writes OUTSIDE Doc/store (published docs, working copies, src)", () => {
		assert.equal(
			guardStoreDbMutation("write", { path: path.join(cwd, "Doc", "requirements", "PRD_TodoApp.md") }, cwd),
			undefined,
		);
		assert.equal(
			guardStoreDbMutation("edit", { path: path.join(cwd, "pi-extension", "src", "index.ts") }, cwd),
			undefined,
		);
		assert.equal(
			guardStoreDbMutation(
				"write",
				{ path: path.join(cwd, ".IDE_Plans", "velpari", "runs", "r1", "prd", "w.md") },
				cwd,
			),
			undefined,
		);
		// A sibling directory named like the store root must not match.
		assert.equal(guardStoreDbMutation("write", { path: path.join(cwd, "Doc", "storekeeper", "x.db") }, cwd), undefined);
	});

	it("read tools and other tools are never blocked", () => {
		const storePath = path.join(cwd, "Doc", "store", "TodoApp", "index.db");
		assert.equal(guardStoreDbMutation("read", { path: storePath }, cwd), undefined);
		assert.equal(guardStoreDbMutation("bash", { command: "cat Doc/store/x" }, cwd), undefined);
		assert.equal(guardStoreDbMutation("subagent", { task: "write Doc/store/x" }, cwd), undefined);
	});

	it("fails open on malformed input (no path)", () => {
		assert.equal(guardStoreDbMutation("write", {}, cwd), undefined);
		assert.equal(guardStoreDbMutation("write", { path: 42 }, cwd), undefined);
		assert.equal(guardStoreDbMutation("write", undefined, cwd), undefined);
	});

	it("ordering: non-store stage-folder writes are still governed by the stage lock (no shadowing)", () => {
		// The store guard must not swallow stage-lock behavior for
		// non-store paths: an out-of-run-folder write during an active
		// stage is blocked by the STAGE lock, not the store guard.
		const state = stateWith("drafting-prd");
		const outside = guardStoreDbMutation("write", { path: path.join(cwd, "random", "file.md") }, cwd);
		assert.equal(outside, undefined, "store guard allows non-store paths");
		const stageBlock = guardStageMutation("write", { path: path.join(cwd, "random", "file.md") }, state, cwd);
		assert.ok(stageBlock, "stage lock still blocks the out-of-folder write");
		assert.match(stageBlock.reason, /Locked: stage/);
	});
});
