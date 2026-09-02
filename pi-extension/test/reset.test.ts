import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleReset } from "../src/reset.js";
import { createRun, clearRun, loadState } from "../src/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-reset-"));
}

function makeUI(notifies: Array<{ msg: string; level: string }>, confirmResult: boolean) {
	return {
		notifies,
		confirmResult,
		confirmCalls: 0,
		async confirm(_t: string, _m: string) {
			this.confirmCalls++;
			return this.confirmResult;
		},
		notify(msg: string, level: string) {
			notifies.push({ msg, level });
		},
	};
}

test("handleReset reports no run when state is empty", async () => {
	const dir = tempDir();
	try {
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies, true) } as never;
		await handleReset(ctx, dir);
		const info = notifies.find((n) => n.level === "info" && /no active run/i.test(n.msg));
		assert.ok(info, "expected info notification about no active run");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleReset does not clear state when user declines", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const statePath = join(dir, ".IDE_Plans", "velpari", "state.json");
		assert.ok(existsSync(statePath), "state.json should exist after createRun");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies, false) } as never; // decline
		await handleReset(ctx, dir);

		assert.ok(existsSync(statePath), "state.json should still exist after declined reset");
		const cancelled = notifies.some((n) => /cancelled/i.test(n.msg));
		assert.ok(cancelled, "expected 'cancelled' notification");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleReset clears state when user confirms", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const statePath = join(dir, ".IDE_Plans", "velpari", "state.json");
		assert.ok(existsSync(statePath));

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies, true) } as never; // confirm
		await handleReset(ctx, dir);

		assert.ok(!existsSync(statePath), "state.json should be removed after confirmed reset");
		const state = loadState(dir);
		assert.equal(state.currentStage, "none", "state should be 'none' after reset");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
