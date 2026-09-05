import { test } from "node:test";
import assert from "node:assert/strict";
import index from "../src/index.js";
import { COMMAND_NAMES } from "../src/core/commands.js";

interface RegisteredCommand {
	description: string;
	handler: (args: string, ctx: unknown) => Promise<void>;
}

function makeMockPi() {
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, ((event: unknown) => Promise<unknown>)[]>();
	const shortcuts = new Map<string, { description: string; handler: (ctx: unknown) => Promise<void> }>();
	const flags = new Map<string, { description: string; type?: string; default?: unknown }>();
	const sentUserMessages: string[] = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	// Phase E contract surfaces: events listeners (who subscribed) and
	// emitted payloads (what was sent). Tests use these.
	const eventListeners = new Map<string, Array<(p: unknown) => void>>();
	const emittedLog = new Map<string, Array<unknown>>();
	const fire = (event: string, payload: unknown) => {
		const log = emittedLog.get(event) ?? [];
		log.push(payload);
		emittedLog.set(event, log);
		const arr = eventListeners.get(event) ?? [];
		for (const fn of arr) fn(payload);
	};
	return {
		commands,
		handlers,
		shortcuts,
		flags,
		entries,
		sentUserMessages,
		registerCommand(name: string, def: RegisteredCommand) {
			commands.set(name, def);
		},
		on(event: string, handler: (event: unknown) => Promise<unknown>) {
			const arr = handlers.get(event) ?? [];
			arr.push(handler);
			handlers.set(event, arr);
		},
		registerShortcut(shortcut: string, def: { description: string; handler: (ctx: unknown) => Promise<void> }) {
			shortcuts.set(shortcut, def);
		},
		registerFlag(name: string, def: { description: string; type?: string; default?: unknown }) {
			flags.set(name, def);
		},
		getFlag(name: string): unknown {
			return flags.get(name)?.default;
		},
		sendUserMessage(msg: string, _opts?: unknown) {
			sentUserMessages.push(msg);
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ customType, data });
		},
		registerEntryRenderer(_customType: string, _renderer: unknown) { /* no-op */ },
		events: {
			on(event: string, fn: (payload: unknown) => void) {
				const arr = eventListeners.get(event) ?? [];
				arr.push(fn);
				eventListeners.set(event, arr);
			},
			emit(event: string, payload: unknown) {
				fire(event, payload);
			},
			// Exposed for tests to inspect what was emitted on the channel.
			listeners: eventListeners,
			emitted: emittedLog,
		},
	};
}

test("index exports a default function", () => {
	assert.equal(typeof index, "function");
});

test("index registers all 25 commands via ExtensionAPI", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	assert.equal(pi.commands.size, COMMAND_NAMES.length, "expected all 25 commands to register");
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
	const handlers = pi.handlers.get("session_before_compact");
	assert.ok(handlers && handlers.length > 0, "session_before_compact hook missing");
	const handler = handlers[0]!;
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

test("real handlers are wired for /velpari-handoff (Phase D)", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const def = pi.commands.get("velpari-handoff");
	assert.ok(def, "command missing");
	assert.ok(!def.description.includes("Phase A stub"), "velpari-handoff must use the real handler");
});

const SHOW_COMMANDS = [
	"velpari-show-discussion",
	"velpari-show-prd",
	"velpari-show-rtm",
	"velpari-show-feasibility",
	"velpari-show-design",
	"velpari-show-pseudocode",
	"velpari-show-testplan",
] as const;

for (const cmd of SHOW_COMMANDS) {
	test(`real handlers are wired for /${cmd} (Phase E)`, () => {
		const pi = makeMockPi();
		index(pi as unknown as Parameters<typeof index>[0]);
		const def = pi.commands.get(cmd);
		assert.ok(def, `command ${cmd} missing`);
		assert.ok(!def.description.includes("Phase A stub"), `${cmd} must use the real handler`);
	});
}

const DISCIPLINE_COMMANDS = [
	"velpari-status",
	"velpari-reset",
	"velpari-configure-inputs",
	"velpari-doctor",
] as const;

for (const cmd of DISCIPLINE_COMMANDS) {
	test(`real handlers are wired for /${cmd} (v1.0 complete)`, () => {
		const pi = makeMockPi();
		index(pi as unknown as Parameters<typeof index>[0]);
		const def = pi.commands.get(cmd);
		assert.ok(def, `command ${cmd} missing`);
		assert.ok(!def.description.includes("Phase A stub"), `${cmd} must use the real handler`);
	});
}

// ---------------------------------------------------------------------------
// Phase E followup — events emitted on the velpari:* channel.
//
// The event names are part of the cross-extension contract. Other Pi
// extensions subscribe to `velpari:start`, `velpari:before-compact`, and
// `velpari:shutdown`. Renaming any of them would silently break every
// listener. Pin the names + payload shape directly.
// ---------------------------------------------------------------------------

test("index emits velpari:start on session_start", async () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const startHandlers = (pi.handlers.get("session_start") ?? []) as Array<(e: unknown) => Promise<unknown>>;
	assert.ok(startHandlers.length >= 1, "session_start handler must be registered");
	// Index.ts registers two session_start handlers in sequence: one
	// rehydrates state, the other emits velpari:start. Drive every
	// registered handler — order is implementation detail.
	for (const handler of startHandlers) await handler({});
	const emitted = (pi.events.emitted.get("velpari:start") ?? []) as Array<Record<string, unknown>>;
	assert.equal(emitted.length, 1, "velpari:start must fire exactly once");
	assert.equal(typeof emitted[0]?.ts, "string", "payload must include `ts`");
});

test("index emits velpari:before-compact alongside the compaction return", async () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const compactHandlers = (pi.handlers.get("session_before_compact") ?? []) as Array<(e: unknown) => Promise<unknown>>;
	assert.ok(compactHandlers.length >= 1, "session_before_compact handler must be registered");
	// Index.ts registers two session_before_compact handlers in sequence:
	// the first returns { compaction: { ... } }, the second emits the
	// event. Drive every handler and capture EACH return value so we
	// can assert on the FIRST (the compaction return).
	const returns: Array<unknown> = [];
	for (const handler of compactHandlers) {
		returns.push(await handler({
			preparation: { firstKeptEntryId: "abc", tokensBefore: 1000 },
			reason: "manual",
		}));
	}
	assert.ok(returns[0] && (returns[0] as { compaction?: unknown }).compaction, "compaction return missing");
	const emitted = (pi.events.emitted.get("velpari:before-compact") ?? []) as Array<Record<string, unknown>>;
	assert.equal(emitted.length, 1, "velpari:before-compact must fire");
	assert.equal(emitted[0]?.reason, "manual");
});

test("index emits velpari:shutdown on session_shutdown", async () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const shutdownHandlers = (pi.handlers.get("session_shutdown") ?? []) as Array<(e: unknown) => Promise<unknown>>;
	assert.ok(shutdownHandlers.length >= 1, "session_shutdown handler must be registered");
	for (const handler of shutdownHandlers) await handler({ reason: "quit" });
	const emitted = (pi.events.emitted.get("velpari:shutdown") ?? []) as Array<Record<string, unknown>>;
	assert.equal(emitted.length, 1, "velpari:shutdown must fire");
	assert.equal(emitted[0]?.reason, "quit");
});
