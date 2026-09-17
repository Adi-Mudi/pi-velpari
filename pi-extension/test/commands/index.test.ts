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

import { COMMAND_NAMES, registerCommands } from "../../src/commands/index.js";

interface RegisteredCommand {
	name: string;
	description?: string;
	handler: (...args: unknown[]) => unknown;
}

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
		registerFlag(name: string, _meta: unknown, _parser: unknown) {
			flags.set(name, true);
		},
		registerHook(_name: string, _handler: unknown) {
			hookCalls.push(_name);
		},
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
			assert.ok(
				typeof cmd.description === "string" && cmd.description.length > 0,
				`${name} missing description`,
			);
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