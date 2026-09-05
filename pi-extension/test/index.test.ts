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
	// v0.5.0 Phase I.2: track registered entry renderers.
	const entryRenderers = new Map<string, unknown>();
	// Phase E contract surfaces: events listeners (who subscribed) and
	// emitted payloads (what was sent). Tests use these.
	const eventListeners = new Map<string, Array<(p: unknown) => void>>();
	const emittedLog = new Map<string, Array<unknown>>();
	// v0.5.1 Phase J.2: track the documented ctx.ui.setStatus(key, text)
	// calls. undefined text means the extension cleared its status bar.
	const statuses = new Map<string, string | undefined>();
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
		entryRenderers,
		sentUserMessages,
		statuses,
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
		registerEntryRenderer(customType: string, renderer: unknown) {
			entryRenderers.set(customType, renderer);
		},
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

// ---------------------------------------------------------------------------
// Phase F followup — `pi.on("resources_discover", ...)` registration.
//
// The registration contributes `<cwd>/skills` as a Pi resource path so
// auto-discovery sees the project's skill/agent files. A future refactor
// that drops or renames the registration silently breaks auto-discovery;
// pin the contract directly.
// ---------------------------------------------------------------------------

test("index registers a resources_discover handler that contributes <cwd>/skills", async () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const handlers = pi.handlers.get("resources_discover") ?? [];
	assert.ok(handlers.length >= 1, "resources_discover handler must be registered");

	const result = (await (handlers[0] as (e: unknown) => Promise<unknown>)({})) as unknown as {
		skillPaths?: string[];
	};
	assert.ok(Array.isArray(result.skillPaths), "handler must return { skillPaths: string[] }");
	assert.equal(result.skillPaths!.length, 1);
	assert.match(result.skillPaths![0]!, /\/skills$/);
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

// ---------------------------------------------------------------------------
// v0.5.0 Phase I.2 followup — custom velpari-status entry renderer.
//
// index.ts now calls registerVelpariStatusRenderer(pi) at extension load,
// which delegates to pi.registerEntryRenderer("velpari-status", fn).
// The two tests below pin (a) the registration is in place and
// (b) invoking the captured renderer with a sample entry returns
// a value (a pi-tui Box component) without throwing.
// ---------------------------------------------------------------------------

test("index registers a velpari-status entry renderer", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const renderer = pi.entryRenderers.get("velpari-status");
	assert.ok(renderer, "velpari-status entry renderer must be registered");
	assert.equal(typeof renderer, "function", "renderer must be a function");
});

test("velpari-status renderer returns a pi-tui Box for a sample entry", () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	const renderer = pi.entryRenderers.get("velpari-status") as (
		entry: unknown,
		options: { expanded: boolean },
		theme: {
			bold: (s: string) => string;
			dim: (s: string) => string;
			fg: (_: string, s: string) => string;
			muted: (s: string) => string;
		},
	) => unknown;
	assert.ok(renderer, "renderer must be registered");
	const sample = {
		customType: "velpari-status",
		data: {
			runId: "2026-09-05-test",
			mission: "A reasonable mission for a test",
			stage: "discussed",
			updatedAt: "2026-09-05T16:30:00Z",
			profileId: "core-psrs-v1",
			profileKind: "common-core",
			profileVersion: "1.1.0",
			applicationType: "other",
			domain: "general",
			developmentMethod: "agile",
			regulated: false,
			outputVariant: "standard",
		},
	};
	const theme = {
		bold: (s: string) => `*${s}*`,
		dim: (s: string) => s,
		fg: (_: string, s: string) => s,
		muted: (s: string) => s,
	};
	// Call both collapsed and expanded; the renderer must not throw.
	const collapsed = renderer(sample, { expanded: false }, theme);
	const expanded = renderer(sample, { expanded: true }, theme);
	assert.ok(collapsed, "collapsed render must produce a value");
	assert.ok(expanded, "expanded render must produce a value");
});

// ---------------------------------------------------------------------------
// v0.5.1 Phase J.2 — TUI footer status bar via ctx.ui.setStatus.
//
// Per official Pi docs (docs/extensions.md, docs/tui.md, examples/
// extensions/status-line.ts), the status-bar API is
// `ctx.ui.setStatus(key, text)`. Passing `undefined` clears the status
// for that key. We test the canonical clear-on-session-start behavior:
// when a prior session left a "velpari" status bar visible, the new
// session must clear it before any command runs.
// ---------------------------------------------------------------------------

test("index clears any leftover velpari status bar on session_start", async () => {
	const pi = makeMockPi();
	index(pi as unknown as Parameters<typeof index>[0]);
	// Pre-stage a stale velpari status bar left over from a prior session.
	pi.statuses.set("velpari", "STALE: prior session");
	const startHandlers = (pi.handlers.get("session_start") ?? []) as Array<
		(event: unknown, ctx: unknown) => Promise<unknown>
	>;
	assert.ok(startHandlers.length >= 1, "session_start handler must be registered");
	// Drive every registered handler with a fake ctx that captures
	// ctx.ui.setStatus calls into our pi.statuses Map.
	const fakeCtx = {
		ui: {
			setStatus(key: string, text: string | undefined) {
				pi.statuses.set(key, text);
			},
		},
	};
	for (const handler of startHandlers) await handler({}, fakeCtx);
	// The clear call sets the key to undefined.
	assert.equal(
		pi.statuses.get("velpari"),
		undefined,
		"session_start must clear stale velpari status",
	);
});
