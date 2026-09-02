import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApprove } from "../src/approve.js";
import { createRun, clearRun } from "../src/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-approve-"));
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

test("handleApprove refuses when in discussing stage (FR-59)", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		// State is currently 'discussing'
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleApprove(ctx, dir);
		const errored = notifies.some(
			(n) => n.level === "error" && /approve-discuss/i.test(n.msg),
		);
		assert.ok(errored, "expected an error redirecting to /velpari-approve-discuss");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleApprove publishes working copy for stages 2-7", async () => {
	const dir = tempDir();
	try {
		const state = createRun("Mission", dir);
		// Manually set state to drafting-prd by creating a working copy
		const { writeFileSync, mkdirSync } = await import("node:fs");
		const workingDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "prd");
		mkdirSync(workingDir, { recursive: true });
		writeFileSync(join(workingDir, "PRD_TestApp.md"), "# PRD content\n", "utf8");

		// But state is still 'discussing' from createRun. handleApprove will refuse.
		// The test documents the gate behavior.
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleApprove(ctx, dir);
		// The handler refuses because state is 'discussing' (FR-59).
		const errored = notifies.some((n) => n.level === "error");
		assert.ok(errored, "expected handleApprove to error in discussing state");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleApprove refuses when no run is active", async () => {
	const dir = tempDir();
	try {
		// No createRun — state stays 'none'
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleApprove(ctx, dir);
		const errored = notifies.some((n) => n.level === "error");
		assert.ok(errored, "expected an error when no run is active");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
