import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_NAMES, registerCommands } from "../src/commands.js";

test("COMMAND_NAMES has 23 entries", () => {
	assert.equal(COMMAND_NAMES.length, 23);
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

test("stub handler invokes ctx.ui.notify", async () => {
	const calls: Array<{ msg: string; level: string }> = [];
	// velpari-discuss is now a real handler in Phase B; use velpari-doctor (still a stub).
	let capturedHandler: ((a: string, ctx: unknown) => Promise<void>) | undefined;
	const pi = {
		registerCommand(name: string, def: { handler: (a: string, ctx: unknown) => Promise<void> }) {
			if (name === "velpari-doctor") capturedHandler = def.handler;
		},
	};
	registerCommands(pi as unknown as Parameters<typeof registerCommands>[0]);
	assert.ok(capturedHandler, "velpari-doctor handler not captured");

	const ctx = {
		ui: {
			notify(msg: string, level: string) {
				calls.push({ msg, level });
			},
		},
	};
	await capturedHandler!("hello", ctx);
	assert.equal(calls.length, 1);
	assert.match(calls[0]!.msg, /Phase A stub/);
	assert.match(calls[0]!.msg, /hello/);
	assert.equal(calls[0]!.level, "info");
});
