import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleStatus } from "../src/status.js";
import { createRun, clearRun } from "../src/state.js";

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
		await handleStatus(ctx, dir);
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
		await handleStatus(ctx, dir);
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
		await handleStatus(ctx, dir);
		const info = notifies.find((n) => n.level === "info");
		assert.ok(info);
		assert.match(info.msg, /\/velpari-discuss/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
