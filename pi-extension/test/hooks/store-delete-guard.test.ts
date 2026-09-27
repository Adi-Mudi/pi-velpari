// Unit tests — hooks/tool-call.ts store DELETE hard-lock (Phase 2, F12).
// Covers: destructive bash verbs naming a store path are blocked with the
// self-healing guidance (F16 + the three legitimate paths), non-store and
// sibling-path commands pass, fail-open on malformed input, and the
// end-to-end registration through registerToolCallHook.
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { guardStoreDeleteAttempt, registerToolCallHook } from "../../src/hooks/tool-call.js";
import { PATHS } from "../../src/core/constants.js";

type ToolCallHandler = (
	event: { toolName: string; input?: Record<string, unknown> },
	ctx: { cwd: string },
) => { block: true; reason: string } | undefined;

let cwd: string;
let handlers: Record<string, ToolCallHandler[]>;

function makePi(): ExtensionAPI {
	handlers = {};
	return {
		on: (event: string, handler: ToolCallHandler) => {
			handlers[event] = handlers[event] ?? [];
			handlers[event]!.push(handler);
		},
	} as unknown as ExtensionAPI;
}

beforeEach(() => {
	cwd = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-delete-guard-"));
	// A quiet, lock-free state: the stage guards must not interfere.
	fs.mkdirSync(path.join(cwd, PATHS.RUN_STATE_DIR), { recursive: true });
	handlers = {};
	makePi();
});

afterEach(() => {
	fs.rmSync(cwd, { recursive: true, force: true });
});

describe("guardStoreDeleteAttempt — bash delete hard-lock (F12)", () => {
	it("blocks rm on a store path with the self-healing guidance", () => {
		const block = guardStoreDeleteAttempt("bash", { command: "rm -rf Doc/store/TestApp/index.db" }, cwd);
		assert.ok(block, "expected a block");
		assert.match(block.reason, /Doc\/store\/TestApp\/index\.db|rm -rf Doc\/store\/TestApp\/index\.db/);
		assert.match(block.reason, /immutable \(F16\)/);
		assert.match(block.reason, /\/velpari-tombstone/);
		assert.match(block.reason, /\/velpari-rollback/);
		assert.match(block.reason, /\/velpari-export/);
	});

	it("blocks git rm, rmdir, shred and mv when they name the store", () => {
		for (const command of [
			"git rm Doc/store/TestApp/prd.yaml",
			"rmdir Doc/store/TestApp",
			"shred -u Doc/store/TestApp/index.db",
			"mv Doc/store/TestApp/index.db /tmp/x",
		]) {
			const block = guardStoreDeleteAttempt("bash", { command }, cwd);
			assert.ok(block, `expected a block for: ${command}`);
		}
	});

	it("allows non-store deletes, sibling paths, non-destructive commands and other tools", () => {
		assert.equal(guardStoreDeleteAttempt("bash", { command: "rm -rf Doc/design" }, cwd), undefined);
		assert.equal(guardStoreDeleteAttempt("bash", { command: "rm -rf Doc/storekeeper/x" }, cwd), undefined);
		assert.equal(guardStoreDeleteAttempt("bash", { command: "ls Doc/store" }, cwd), undefined);
		assert.equal(guardStoreDeleteAttempt("bash", { command: "cat Doc/store/TestApp/index.db" }, cwd), undefined);
		assert.equal(
			guardStoreDeleteAttempt("write", { path: "Doc/store/x" }, cwd),
			undefined,
			"edit/write has its own guard",
		);
		assert.equal(guardStoreDeleteAttempt("subagent", { task: "rm Doc/store/x" }, cwd), undefined);
	});

	it("fails open on malformed input", () => {
		assert.equal(guardStoreDeleteAttempt("bash", {}, cwd), undefined);
		assert.equal(guardStoreDeleteAttempt("bash", { command: "" }, cwd), undefined);
		assert.equal(guardStoreDeleteAttempt("bash", { command: 42 }, cwd), undefined);
		assert.equal(guardStoreDeleteAttempt("bash", undefined, cwd), undefined);
	});

	it("blocks through the registered hook (composition order intact)", () => {
		const pi = makePi();
		registerToolCallHook(pi);
		const hook = handlers.tool_call![0]!;

		const blocked = hook({ toolName: "bash", input: { command: "rm -rf Doc/store/TestApp/index.db" } }, { cwd });
		assert.ok(blocked, "the registered hook blocks the delete");
		assert.match(blocked.reason, /\/velpari-tombstone/);

		const allowed = hook({ toolName: "bash", input: { command: "rm -rf Doc/design" } }, { cwd });
		assert.equal(allowed, undefined, "non-store deletes still pass");
	});
});
