import { test } from "node:test";
import assert from "node:assert/strict";
import index from "../src/index.js";
import { COMMAND_NAMES } from "../src/commands.js";

interface RegisteredCommand {
	description: string;
	handler: (args: string, ctx: unknown) => Promise<void>;
}

function makeMockPi() {
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
	return {
		commands,
		handlers,
		registerCommand(name: string, def: RegisteredCommand) {
			commands.set(name, def);
		},
		on(event: string, handler: (event: unknown) => Promise<unknown>) {
			handlers.set(event, handler);
		},
	};
}

test("index exports a default function", () => {
	assert.equal(typeof index, "function");
});

test("index registers all 23 commands via ExtensionAPI", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	assert.equal(pi.commands.size, COMMAND_NAMES.length, "expected all 23 commands to register");
	for (const name of COMMAND_NAMES) {
		assert.ok(pi.commands.has(name), `missing command: ${name}`);
	}
});

test("index registers session_before_compact hook", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	assert.ok(pi.handlers.has("session_before_compact"), "session_before_compact hook not registered");
});

test("compaction hook returns a compaction object", async () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const handler = pi.handlers.get("session_before_compact");
	assert.ok(handler, "hook missing");
	const event = {
		preparation: { firstKeptEntryId: "abc", tokensBefore: 1000 },
	};
	const result = await handler(event);
	assert.ok(result && typeof result === "object", "hook did not return an object");
	const r = result as { compaction?: { summary?: string; firstKeptEntryId?: string; tokensBefore?: number } };
	assert.ok(r.compaction, "compaction key missing");
	assert.equal(typeof r.compaction.summary, "string", "summary must be a string");
	assert.equal(r.compaction.firstKeptEntryId, "abc");
	assert.equal(r.compaction.tokensBefore, 1000);
});

test("real handlers are wired for /velpari-discuss (Phase B)", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const def = pi.commands.get("velpari-discuss");
	assert.ok(def, "command missing");
	assert.ok(
		!def.description.includes("Phase A stub"),
		"velpari-discuss must use the real handler in Phase B",
	);
});

test("real handlers are wired for /velpari-prd (Phase B)", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const def = pi.commands.get("velpari-prd");
	assert.ok(def, "command missing");
	assert.ok(!def.description.includes("Phase A stub"), "velpari-prd must use the real handler");
});

test("real handlers are wired for /velpari-rtm (Phase B)", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const def = pi.commands.get("velpari-rtm");
	assert.ok(def, "command missing");
	assert.ok(!def.description.includes("Phase A stub"), "velpari-rtm must use the real handler");
});

test("real handlers are wired for /velpari-approve-discuss (Phase B)", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const def = pi.commands.get("velpari-approve-discuss");
	assert.ok(def, "command missing");
	assert.ok(
		!def.description.includes("Phase A stub"),
		"velpari-approve-discuss must use the real handler",
	);
});

test("real handlers are wired for /velpari-feasibility (Phase C)", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const def = pi.commands.get("velpari-feasibility");
	assert.ok(def, "command missing");
	assert.ok(!def.description.includes("Phase A stub"), "velpari-feasibility must use the real handler");
});

test("real handlers are wired for /velpari-design (Phase C)", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const def = pi.commands.get("velpari-design");
	assert.ok(def, "command missing");
	assert.ok(!def.description.includes("Phase A stub"), "velpari-design must use the real handler");
});

test("real handlers are wired for /velpari-pseudocode (Phase C)", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const def = pi.commands.get("velpari-pseudocode");
	assert.ok(def, "command missing");
	assert.ok(!def.description.includes("Phase A stub"), "velpari-pseudocode must use the real handler");
});

test("real handlers are wired for /velpari-testplan (Phase C)", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const def = pi.commands.get("velpari-testplan");
	assert.ok(def, "command missing");
	assert.ok(!def.description.includes("Phase A stub"), "velpari-testplan must use the real handler");
});

test("real handlers are wired for /velpari-approve (Phase C)", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const def = pi.commands.get("velpari-approve");
	assert.ok(def, "command missing");
	assert.ok(!def.description.includes("Phase A stub"), "velpari-approve must use the real handler");
});
