import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleStatus } from "../src/discipline/status.js";
import { createRun, clearRun } from "../src/core/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-status-"));
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

test("handleStatus reports no run when state is empty", async () => {
	const dir = tempDir();
	try {
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleStatus(ctx as never, undefined, dir);
		const info = notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /No active Velpari run/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleStatus shows state fields when run is active", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleStatus(ctx as never, undefined, dir);
		const info = notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /Mission/);
		assert.match(info.msg, /Current stage: discussing/);
		assert.match(info.msg, /History/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleStatus includes history entries", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleStatus(ctx as never, undefined, dir);
		const info = notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /\/velpari-discuss/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleStatus truncates long history (MAX_NOTIFY_LENGTH = 8000)", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		// Patch state to have a very long history
		const { readFileSync, writeFileSync } = await import("node:fs");
		const statePath = join(dir, ".IDE_Plans", "velpari", "state.json");
		const state = JSON.parse(readFileSync(statePath, "utf8"));
		state.history = Array.from({ length: 200 }, (_, i) => ({
			stage: `stage-${i}`,
			command: `/velpari-cmd-${i} with some extra text to make each line longer`,
			timestamp: new Date().toISOString(),
		}));
		writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleStatus(ctx as never, undefined, dir);

		const info = notifies.find((n) => n.level === "info");
		assert.ok(info, "expected an info notification");
		assert.ok(
			info.msg.length <= 8000,
			`truncated notification must be <= 8000 chars, got ${info.msg.length}`,
		);
		assert.match(info.msg, /\.\.\. \[truncated\]/, "must include truncation marker");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
