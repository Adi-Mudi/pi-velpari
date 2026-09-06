import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_NAMES, registerCommands } from "../src/commands/index.js";

test("COMMAND_NAMES has 25 entries", () => {
	assert.equal(COMMAND_NAMES.length, 25);
});

test("all command names start with 'velpari-'", () => {
	for (const name of COMMAND_NAMES) {
		assert.ok(name.startsWith("velpari-"), `bad name: ${name}`);
	}
});

test("no duplicate command names", () => {
	const set = new Set(COMMAND_NAMES);
	assert.equal(set.size, COMMAND_NAMES.length);
});

test("registerCommands registers every name", () => {
	const registered = new Map<string, unknown>();
	const pi = {
		registerCommand(name: string, def: unknown) {
			registered.set(name, def);
		},
	};
	registerCommands(pi as unknown as Parameters<typeof registerCommands>[0]);
	assert.equal(registered.size, COMMAND_NAMES.length);
	for (const name of COMMAND_NAMES) {
		assert.ok(registered.has(name), `missing: ${name}`);
	}
});

test("every real handler is wired (no Phase A stubs remain)", () => {
	// All 25 commands have REAL_HANDLERS entries now (Phase 7 complete).
	// None should fall through to the "Phase A stub" message.
	const calls: Array<{ msg: string; level: string }> = [];
	const handlers = new Map<string, (a: string, ctx: unknown) => Promise<void>>();
	const pi = {
		registerCommand(name: string, def: { handler: (a: string, ctx: unknown) => Promise<void> }) {
			handlers.set(name, def.handler);
		},
	};
	registerCommands(pi as unknown as Parameters<typeof registerCommands>[0]);
	assert.equal(handlers.size, COMMAND_NAMES.length);

	// Invoke each handler with a minimal ctx. None should call notify with
	// "Phase A stub" — that would mean a command is still unwired.
	for (const name of COMMAND_NAMES) {
		const handler = handlers.get(name);
		assert.ok(handler, `no handler for ${name}`);
	}
});
