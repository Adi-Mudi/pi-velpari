/**
 * Integration: Command registration (Phase 8 + v1.6.0 per-stage approve).
 *
 * Verifies all 41 commands register without conflict:
 *  - Phase 1-3 additions (rename, new configure-standards command)
 *  - Phase 8 /velpari-generate-sub-agents addition
 *  - v1.4.0: +velpari-design-logging + velpari-show-logging
 *  - v1.6.0: per-stage approve split (dropped the legacy generic
 *    add 9 per-stage /velpari-<stage>-approve commands)
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { COMMAND_NAMES, CommandName } from "../../src/commands/index.js";

describe("command registration — Phase 8 + v1.6.0 re-verification", () => {
	it("exports 43 command names (A5: +velpari-reconfirm; Phase 5: +velpari-export; Phase 6: +velpari-backfill)", () => {
		assert.strictEqual(COMMAND_NAMES.length, 43);
	});

	it("contains all expected user-facing commands", () => {
		const expected: CommandName[] = [
			// Stage commands (10)
			"velpari-brainstorm",
			"velpari-prd",
			"velpari-rtm",
			"velpari-feasibility",
			"velpari-architecture-generator",
			"velpari-pseudocode",
			"velpari-testplan",
			"velpari-atomic-function",
			"velpari-development-order",
			"velpari-final-design",
			// Per-stage approve commands (9 — v1.6.0)
			"velpari-prd-approve",
			"velpari-rtm-approve",
			"velpari-feasibility-approve",
			"velpari-architecture-generator-approve",
			"velpari-pseudocode-approve",
			"velpari-atomic-function-approve",
			"velpari-testplan-approve",
			"velpari-development-order-approve",
			"velpari-final-design-approve",
			// Discipline commands (13 — A5 added velpari-reconfirm)
			"velpari-approve-brainstorm",
			"velpari-status",
			"velpari-reset",
			"velpari-configure-inputs",
			"velpari-configure-requirements",
			"velpari-configure-standards",
			"velpari-configure-agents",
			"velpari-agents",
			"velpari-generate-sub-agents",
			"velpari-doctor",
			"velpari-handoff",
			"velpari-design-logging",
			"velpari-reconfirm",
			// Wrapper command (1)
			"velpari-prd-rtm",
			// View commands (8 — v1.4.0 added /velpari-show-logging)
			"velpari-show-brainstorm",
			"velpari-show-prd",
			"velpari-show-rtm",
			"velpari-show-feasibility",
			"velpari-show-design",
			"velpari-show-pseudocode",
			"velpari-show-testplan",
			"velpari-show-logging",
			// View/ops — Phase 5 export + Phase 6 backfill (43rd command)
			"velpari-export",
			"velpari-backfill",
		];
		for (const cmd of expected) {
			assert.ok((COMMAND_NAMES as readonly string[]).includes(cmd), `missing command: ${cmd}`);
		}
	});

	it("has no duplicate command names", () => {
		const seen = new Set<string>();
		for (const cmd of COMMAND_NAMES) {
			assert.ok(!seen.has(cmd), `duplicate command: ${cmd}`);
			seen.add(cmd);
		}
	});

	it("v1.6.0: legacy generic approve command is GONE; per-stage approve variants are present", () => {
		assert.ok(
			!(COMMAND_NAMES as readonly string[]).includes("velpari-approve"),
			"legacy generic approve must be removed in v1.6.0",
		);
		const perStage: CommandName[] = [
			"velpari-prd-approve",
			"velpari-rtm-approve",
			"velpari-feasibility-approve",
			"velpari-architecture-generator-approve",
			"velpari-pseudocode-approve",
			"velpari-atomic-function-approve",
			"velpari-testplan-approve",
			"velpari-development-order-approve",
			"velpari-final-design-approve",
		];
		for (const cmd of perStage) {
			assert.ok((COMMAND_NAMES as readonly string[]).includes(cmd), `missing per-stage approve command: ${cmd}`);
		}
	});

	it("Phase 1 + 2 rename: /velpari-design is GONE, /velpari-html-design is GONE, /velpari-final-design is present", () => {
		assert.ok(!(COMMAND_NAMES as readonly string[]).includes("velpari-design"));
		assert.ok(!(COMMAND_NAMES as readonly string[]).includes("velpari-html-design"));
		assert.ok((COMMAND_NAMES as readonly string[]).includes("velpari-final-design"));
	});

	it("Phase 3 addition: /velpari-configure-standards is present", () => {
		assert.ok((COMMAND_NAMES as readonly string[]).includes("velpari-configure-standards"));
	});

	it("every command name starts with /velpari-", () => {
		for (const cmd of COMMAND_NAMES) {
			assert.ok(cmd.startsWith("velpari-"), `command ${cmd} does not start with velpari-`);
		}
	});
});
