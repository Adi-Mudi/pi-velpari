import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleStatus } from "../src/discipline/status.js";
import { createRun, clearRun } from "../src/core/state.js";
import { saveFilesConfig } from "../src/core/config.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-status-"));
}

function makeUI(
	notifies: Array<{ msg: string; level: string }>,
	statuses?: Map<string, string | undefined>,
) {
	return {
		notifies,
		async confirm(_t: string, _m: string) {
			return true;
		},
		notify(msg: string, level: string) {
			notifies.push({ msg, level });
		},
		setStatus(key: string, text: string | undefined) {
			statuses?.set(key, text);
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

// ---------------------------------------------------------------------------
// Phase E followup — status.ts pi.appendEntry path.
//
// When `pi` is supplied, handleStatus writes the status to the session as
// a `velpari-status` entry instead of a notify blob. This test pins:
//   - the customType string ("velpari-status")
//   - the payload schema (runId, mission, stage, profileId, body, ...)
//   - that the legacy MAX_NOTIFY_LENGTH path is bypassed
// ---------------------------------------------------------------------------

test("handleStatus appends a velpari-status entry when pi is provided", async () => {
	const dir = tempDir();
	try {
		// Stage a run + projectName so the helper has data to summarize.
		createRun("mission-X", dir);
		saveFilesConfig(
			{
				version: 3,
				projectName: "TestApp",
				framework: {},
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		const captured: Array<{ customType: string; data: unknown }> = [];
		const pi = {
			appendEntry(customType: string, data: unknown) {
				captured.push({ customType, data });
			},
		};
		// v0.5.1 Phase J.2: capture ctx.ui.setStatus calls. Per official Pi
		// docs, the status-bar API is ctx.ui.setStatus(key, text), not
		// pi.setStatus(...).
		const statuses = new Map<string, string | undefined>();
		const ui = makeUI([] as never, statuses);
		const ctx = { ui } as never;
		await handleStatus(ctx, pi as never, dir);

		assert.ok(captured.length === 1, "appendEntry must be called exactly once");
		const entry = captured[0]!;
		assert.equal(entry.customType, "velpari-status");
		const data = entry.data as Record<string, unknown>;
		// createRun sets a non-empty runId derived from mission+stamp; assert
		// it's non-empty and matches the mission-derived slug.
		assert.equal(typeof data.runId, "string");
		assert.match(data.runId as string, /mission-x/);
		assert.equal(data.mission, "mission-X");
		assert.equal(typeof data.stage, "string");
		assert.equal(data.profileId, "(none)", "no profile saved → (none)");
		// Body must contain the markdown summary, not the entry envelope.
		assert.ok(typeof data.body === "string", "body must be a string");
		assert.match(data.body as string, /Mission: mission-X/);
		// v0.5.1 Phase J.2: handleStatus must also push a footer status bar
		// with the current stage and mission. createRun starts the run at
		// stage "discussing", so assert the status bar prefix.
		const statusBar = statuses.get("velpari");
		assert.ok(typeof statusBar === "string", "handleStatus must call ctx.ui.setStatus('velpari', ...)");
		assert.match(statusBar!, /^stage: discussing \| mission: mission-X$/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
