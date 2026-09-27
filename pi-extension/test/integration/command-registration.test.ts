/**
 * Integration: Command registration — the single integration-time count pin.
 *
 * Verifies all 51 commands register without conflict (Phase I reconciliation;
 * the marked per-phase blocks are folded into the canonical registry):
 *  - v1.6.0: per-stage approve split (dropped the legacy generic
 *    command, added 9 per-stage /velpari-<stage>-approve commands)
 *  - A5: +velpari-reconfirm; Phase 5: +velpari-export
 *  - Phase 6 backfill + Phase 10 portfolio + Phase 11 migrate-store
 *  - protection phase (46th–49th): +db-reset/freeze/tombstone/rollback
 *  - export/retention phase (50th): +velpari-retention-prune
 *  - Phase 6 doctor (51st): +velpari-merge-back
 * This file owns the ONLY hard-coded command count in the test tree.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { COMMAND_NAMES, CommandName } from "../../src/commands/index.js";

describe("command registration — Phase 8 + v1.6.0 re-verification", () => {
	it("exports 51 command names (A5: +velpari-reconfirm; Phase 5: +velpari-export; Phase 6: +velpari-backfill; Phase 10: +velpari-portfolio; Phase 11: +velpari-migrate-store; protection phase: +db-reset/freeze/tombstone/rollback; export/retention phase: +velpari-retention-prune; Phase 6 doctor: +velpari-merge-back)", () => {
		assert.strictEqual(COMMAND_NAMES.length, 51);
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
			// Ops — Phase 10 portfolio registry (44th command)
			"velpari-portfolio",
			// Ops — Phase 11 one-time migration (45th command, §15.6)
			"velpari-migrate-store",
			// Ops — Phase 2 protection commands (46th–49th)
			"velpari-db-reset",
			"velpari-freeze",
			"velpari-tombstone",
			"velpari-rollback",
			// Ops — Phase 4 export/retention (50th command, N7)
			"velpari-retention-prune",
			// Ops — Phase 6 guided merge-back (51st command, N12)
			"velpari-merge-back",
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
