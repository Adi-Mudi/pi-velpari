/**
 * Tests for commands/index.ts.
 * Phase 2: smoke test — assert every /velpari-* command name resolves to a
 * registerable handler and the wiring is internally consistent.
 *
 * The commands/ folder files themselves (brainstorm.ts, prd.ts, etc.)
 * are thin shims — they exist to satisfy the "one file per command"
 * orchestrator rule. We do not invoke the handlers here; integration
 * tests in test/integration/ cover that. This test only guards the
 * composition root.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	COMMAND_NAMES,
	COMMAND_PREFLIGHT_CLASS,
	PREFLIGHT_WRAPPED_MARK,
	registerCommands,
} from "../../src/commands/index.js";

interface RegisteredCommand {
	name: string;
	description?: string;
	handler: (...args: unknown[]) => unknown;
}

/**
 * Build a fake Pi ExtensionAPI that records registered commands, flags, and
 * hook calls in maps the tests can assert on.
 * @returns {ExtensionAPI} Fake API exposing `commands`, `flags`, `hookCalls`.
 */
function makeFakePi(): ExtensionAPI & {
	commands: Map<string, RegisteredCommand>;
	flags: Map<string, unknown>;
	hookCalls: string[];
} {
	const commands = new Map<string, RegisteredCommand>();
	const flags = new Map<string, unknown>();
	const hookCalls: string[] = [];
	const fakePi = {
		commands,
		flags,
		hookCalls,
		registerCommand(name: string, spec: { description?: string; handler: (...args: unknown[]) => unknown }) {
			commands.set(name, { name, ...spec });
		},
		/**
		 * Record a flag registration as enabled.
		 * @param {string} name - Flag name.
		 * @param {unknown} _meta - Ignored flag metadata.
		 * @param {unknown} _parser - Ignored value parser.
		 * @returns {void} Nothing; the flag is stored as `true`.
		 */
		registerFlag(name: string, _meta: unknown, _parser: unknown) {
			flags.set(name, true);
		},
		/**
		 * Record a hook registration.
		 * @param {string} _name - Hook event name.
		 * @param {unknown} _handler - Ignored hook handler.
		 * @returns {void} Nothing; the hook name is appended to `hookCalls`.
		 */
		registerHook(_name: string, _handler: unknown) {
			hookCalls.push(_name);
		},
		/**
		 * Read back a registered flag value.
		 * @param {string} name - Flag name.
		 * @returns {unknown} The stored value, or `undefined` when unregistered.
		 */
		getFlag(name: string) {
			return flags.get(name);
		},
	};
	return fakePi as unknown as ExtensionAPI & {
		commands: Map<string, RegisteredCommand>;
		flags: Map<string, unknown>;
		hookCalls: string[];
	};
}

describe("commands/index — COMMAND_NAMES invariants", () => {
	it("has at least 30 entries", () => {
		assert.ok(COMMAND_NAMES.length >= 30);
	});

	it("every name is unique", () => {
		const set = new Set<string>(COMMAND_NAMES);
		assert.equal(set.size, COMMAND_NAMES.length, "duplicates found in COMMAND_NAMES");
	});

	it("every name starts with 'velpari-'", () => {
		for (const n of COMMAND_NAMES) {
			assert.ok(n.startsWith("velpari-"), `${n} does not start with velpari-`);
		}
	});

	it("contains the headline stage commands", () => {
		for (const required of [
			"velpari-brainstorm",
			"velpari-prd",
			"velpari-rtm",
			"velpari-feasibility",
			"velpari-architecture-generator",
			"velpari-pseudocode",
			"velpari-testplan",
		]) {
			assert.ok(COMMAND_NAMES.includes(required as (typeof COMMAND_NAMES)[number]), `${required} missing`);
		}
	});

	it("contains the discipline commands (v1.6.0: velpari-approve split into per-stage approve variants)", () => {
		for (const required of [
			"velpari-approve-brainstorm",
			"velpari-status",
			"velpari-reset",
			"velpari-doctor",
			"velpari-handoff",
			"velpari-prd-approve",
			"velpari-rtm-approve",
			"velpari-feasibility-approve",
			"velpari-architecture-generator-approve",
			"velpari-pseudocode-approve",
			"velpari-atomic-function-approve",
			"velpari-testplan-approve",
			"velpari-development-order-approve",
			"velpari-final-design-approve",
		]) {
			assert.ok(COMMAND_NAMES.includes(required as (typeof COMMAND_NAMES)[number]), `${required} missing`);
		}
	});

	it("contains the view commands", () => {
		for (const required of [
			"velpari-show-brainstorm",
			"velpari-show-prd",
			"velpari-show-rtm",
			"velpari-show-feasibility",
			"velpari-show-design",
			"velpari-show-pseudocode",
			"velpari-show-testplan",
		]) {
			assert.ok(COMMAND_NAMES.includes(required as (typeof COMMAND_NAMES)[number]), `${required} missing`);
		}
	});

	it("contains the protection commands (phase 2: F23/N4/F16/F21)", () => {
		for (const required of ["velpari-db-reset", "velpari-freeze", "velpari-tombstone", "velpari-rollback"]) {
			assert.ok(COMMAND_NAMES.includes(required as (typeof COMMAND_NAMES)[number]), `${required} missing`);
		}
	});

	it("contains the retention command (phase 4: N7 keep-last-N cleanup)", () => {
		assert.ok(COMMAND_NAMES.includes("velpari-retention-prune" as (typeof COMMAND_NAMES)[number]));
	});

	it("contains the Phase 6 merge-back command (N12, 51st command)", () => {
		assert.ok(COMMAND_NAMES.includes("velpari-merge-back"));
	});

	it("contains the v1.2 revision-status command (B6, 52nd command)", () => {
		assert.ok(COMMAND_NAMES.includes("velpari-revision-status"));
	});

	it("contains the headline /velpari-generate-sub-agents + /velpari-final-design", () => {
		assert.ok(COMMAND_NAMES.includes("velpari-generate-sub-agents"));
		assert.ok(COMMAND_NAMES.includes("velpari-final-design"));
	});
});

describe("commands/index — registerCommands wiring", () => {
	it("registers every COMMAND_NAME without throwing", () => {
		const pi = makeFakePi();
		registerCommands(pi);
		assert.equal(pi.commands.size, COMMAND_NAMES.length, "every COMMAND_NAME was registered");
	});

	it("every registered command has a callable handler", () => {
		const pi = makeFakePi();
		registerCommands(pi);
		for (const [name, cmd] of pi.commands) {
			assert.equal(typeof cmd.handler, "function", `${name} has no handler`);
		}
	});

	it("every registered command has a non-empty description", () => {
		const pi = makeFakePi();
		registerCommands(pi);
		for (const [name, cmd] of pi.commands) {
			assert.ok(typeof cmd.description === "string" && cmd.description.length > 0, `${name} missing description`);
		}
	});

	it("registers no command that is NOT in COMMAND_NAMES", () => {
		const pi = makeFakePi();
		registerCommands(pi);
		for (const name of pi.commands.keys()) {
			assert.ok(
				COMMAND_NAMES.includes(name as (typeof COMMAND_NAMES)[number]),
				`${name} registered but not in COMMAND_NAMES`,
			);
		}
	});

	it("registerCommands is idempotent enough not to throw on a fresh pi", () => {
		const a = makeFakePi();
		registerCommands(a);
		const b = makeFakePi();
		registerCommands(b);
		assert.equal(a.commands.size, b.commands.size);
	});
});

describe("commands/index — type-level", () => {
	it("CommandName type covers every COMMAND_NAME entry (compile-time + runtime)", () => {
		// Runtime sanity: index into the type tuple.
		type First = (typeof COMMAND_NAMES)[number];
		const first: First = COMMAND_NAMES[0];
		assert.equal(typeof first, "string");
	});
});

describe("registerCommands — command-start preflight (E#3)", () => {
	/** Make a temp project dir with a corrupt (untracked) files.json. */
	function makeCorruptProject(): string {
		const cwd = mkdtempSync(path.join(os.tmpdir(), "velpari-cmdgate-"));
		mkdirSync(path.join(cwd, ".pi", "velpari"), { recursive: true });
		writeFileSync(path.join(cwd, ".pi", "velpari", "files.json"), "{broken", "utf8");
		return cwd;
	}

	it("wrapped command: preflight blocks before the handler (config-unreadable, handler skipped)", async () => {
		const cwd = makeCorruptProject();
		try {
			const pi = makeFakePi();
			registerCommands(pi);
			const notifies: string[] = [];
			const ctx = { ui: { notify: (m: string) => notifies.push(m) }, cwd };
			const cmd = pi.commands.get("velpari-handoff");
			assert.ok(cmd, "velpari-handoff registered");
			await cmd.handler("", ctx);
			assert.ok(
				notifies.some((m) => m.includes("config-unreadable")),
				`preflight must run first: ${JSON.stringify(notifies)}`,
			);
			assert.ok(
				!notifies.some((m) => /No active run/.test(m)),
				`handler must NOT run after a failed preflight: ${JSON.stringify(notifies)}`,
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("exempt-view command: passes straight through (no config-unreadable notify)", async () => {
		const cwd = makeCorruptProject();
		try {
			const pi = makeFakePi();
			registerCommands(pi);
			const notifies: string[] = [];
			const ctx = { ui: { notify: (m: string) => notifies.push(m) }, cwd };
			const cmd = pi.commands.get("velpari-status");
			assert.ok(cmd, "velpari-status registered");
			try {
				await cmd.handler("", ctx);
			} catch {
				/* view-side errors are irrelevant — the assertion is about the gate */
			}
			assert.ok(
				!notifies.some((m) => m.includes("config-unreadable")),
				`exempt commands must not run command-start preflight: ${JSON.stringify(notifies)}`,
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("every wrapped handler remains a callable function (pins the wrapper typing)", () => {
		const pi = makeFakePi();
		registerCommands(pi);
		for (const name of Object.keys(COMMAND_PREFLIGHT_CLASS).filter(
			(n) => (COMMAND_PREFLIGHT_CLASS as Record<string, string>)[n] === "wrapped",
		)) {
			const cmd = pi.commands.get(name);
			assert.ok(cmd, `${name} registered`);
			assert.equal(typeof cmd.handler, "function", `${name} handler callable`);
		}
	});
});

describe("COMMAND_PREFLIGHT_CLASS registry coverage (Q4)", () => {
	it("class counts pin: wrapped 22 / exempt-stage 11 / exempt-recovery 8 / exempt-view 11 = 52 = COMMAND_NAMES.length", () => {
		const entries = Object.entries(COMMAND_PREFLIGHT_CLASS as Record<string, string>);
		/**
		 * Count table entries assigned to one class.
		 * @param {string} cls - CommandClass value to count.
		 * @returns {number} Number of commands with that class.
		 */
		const count = (cls: string): number => entries.filter(([, v]) => v === cls).length;
		assert.equal(count("wrapped"), 22, "wrapped count");
		assert.equal(count("exempt-stage"), 11, "exempt-stage count");
		assert.equal(count("exempt-recovery"), 8, "exempt-recovery count");
		assert.equal(count("exempt-view"), 11, "exempt-view count");
		assert.equal(entries.length, COMMAND_NAMES.length);
	});

	it("table keys deep-equal COMMAND_NAMES (both directions: unknown entry or missing class fails)", () => {
		const keys = Object.keys(COMMAND_PREFLIGHT_CLASS).sort();
		const names = [...COMMAND_NAMES].sort();
		assert.deepEqual(keys, names);
	});

	it("exempt-view and exempt-recovery members match the locked Q4 lists", () => {
		/**
		 * Command names assigned to one preflight class, sorted.
		 * @param {string} cls - CommandClass value ("exempt-view" / "exempt-recovery").
		 * @returns {string[]} Sorted command names carrying that class.
		 */
		const members = (cls: string): string[] =>
			Object.keys(COMMAND_PREFLIGHT_CLASS)
				.filter((n) => (COMMAND_PREFLIGHT_CLASS as Record<string, string>)[n] === cls)
				.sort();
		// exempt-view (11) — pure readers.
		assert.deepEqual(members("exempt-view"), [
			"velpari-agents",
			"velpari-export",
			"velpari-show-brainstorm",
			"velpari-show-design",
			"velpari-show-feasibility",
			"velpari-show-logging",
			"velpari-show-prd",
			"velpari-show-pseudocode",
			"velpari-show-rtm",
			"velpari-show-testplan",
			"velpari-status",
		]);
		// exempt-recovery (8) — FIX broken state (reset is NOT wrapped).
		assert.deepEqual(members("exempt-recovery"), [
			"velpari-backfill",
			"velpari-configure-agents",
			"velpari-configure-inputs",
			"velpari-configure-requirements",
			"velpari-configure-standards",
			"velpari-doctor",
			"velpari-migrate-store",
			"velpari-reset",
		]);
	});

	it("observed wrapped-set (marked registrations) deep-equals the table's wrapped entries", () => {
		const pi = makeFakePi();
		registerCommands(pi);
		const observed = [...pi.commands.entries()]
			.filter(([, cmd]) => (cmd as unknown as Record<symbol, unknown>)[PREFLIGHT_WRAPPED_MARK] === true)
			.map(([name]) => name)
			.sort();
		const tableWrapped = Object.entries(COMMAND_PREFLIGHT_CLASS as Record<string, string>)
			.filter(([, v]) => v === "wrapped")
			.map(([name]) => name)
			.sort();
		assert.deepEqual(observed, tableWrapped);
	});

	it("every observed-wrapped def's handler is callable and every exempt def is unmarked", () => {
		const pi = makeFakePi();
		registerCommands(pi);
		for (const [name, cmd] of pi.commands) {
			const cls = (COMMAND_PREFLIGHT_CLASS as Record<string, string>)[name];
			const marked = (cmd as unknown as Record<symbol, unknown>)[PREFLIGHT_WRAPPED_MARK] === true;
			assert.equal(typeof cmd.handler, "function", `${name} handler callable`);
			assert.equal(marked, cls === "wrapped", `${name} (${cls}) mark presence`);
		}
	});

	// Build-time layer of the same contract: `satisfies Record<CommandName,
	// CommandClass>` in src/commands/index.ts makes a 53rd command without a
	// class a tsc error — this suite pins the runtime half.
});
