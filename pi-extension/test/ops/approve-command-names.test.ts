/**
 * Regression guard for the Phase I8 defect (2026-09-27 three-team review):
 * the three gate-blocking messages in `ops/approve.ts` hard-coded ONE
 * stage's approve command (`/velpari-pseudocode-approve`,
 * `/velpari-testplan-approve`, `/velpari-development-order-approve`), so
 * for 8 of 9 stages the user was told to re-run a DIFFERENT stage's
 * command — and the `perStageApproveCommand` fallback was
 * `/velpari-brainstorm-approve`, a name never present in COMMAND_NAMES
 * (the real bespoke command is `velpari-approve-brainstorm`).
 *
 * Guard 1 (behaviour): `approveCommandForStage(stage)` returns the
 * stage's own STAGE_TRANSITIONS approve command for every in-progress
 * AND rest state, and every name it can return is a registered command
 * (COMMAND_NAMES membership — this is the assertion that fails on the
 * old fallback).
 *
 * Guard 2 (source): the compiled `src/ops/approve.ts` code no longer
 * hard-codes `/velpari-<stage>-approve` outside the STAGE_APPROVE_MAP
 * table — that map is the legitimate home of those strings; message code
 * must interpolate `approveCommandForStage(...)`.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { approveCommandForStage } from "../../src/ops/approve.js";
import { STAGE_TRANSITIONS, type Stage } from "../../src/core/constants.js";
import { COMMAND_NAMES } from "../../src/commands/index.js";

/** Every in-progress→rest publish transition (one per Stage 2–10 pair). */
const APPROVE_ROWS = STAGE_TRANSITIONS.filter((t) => t.command.endsWith("-approve"));
const REGISTERED = new Set<string>(COMMAND_NAMES);

describe("approveCommandForStage", () => {
	it("returns each stage's own approve command (in-progress and rest states)", () => {
		assert.ok(APPROVE_ROWS.length >= 9, `expected >=9 approve rows, got ${APPROVE_ROWS.length}`);
		for (const row of APPROVE_ROWS) {
			const stages: readonly Stage[] = [row.from, row.to];
			for (const stage of stages) {
				assert.equal(
					approveCommandForStage(stage),
					row.command,
					`stage "${stage}" must be told to re-run its own approve command`,
				);
			}
		}
	});

	it("returns only names registered in COMMAND_NAMES (incl. the brainstorm fallback)", () => {
		const returned: string[] = [];
		for (const row of APPROVE_ROWS) {
			returned.push(approveCommandForStage(row.from), approveCommandForStage(row.to));
		}
		// Stages outside STAGE_APPROVE_MAP fall back to the bespoke command.
		returned.push(approveCommandForStage("brainstorming"), approveCommandForStage("brainstormed"));
		for (const name of returned) {
			assert.ok(REGISTERED.has(name.slice(1)), `"${name}" is not a registered command`);
		}
		assert.equal(approveCommandForStage("brainstorming"), "/velpari-approve-brainstorm");
	});
});

describe("approve.ts source hard-coding guard", () => {
	it("has no hard-coded /velpari-<stage>-approve outside the STAGE_APPROVE_MAP table", () => {
		const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "ops", "approve.js");
		const lines = readFileSync(file, "utf8").split("\n");
		let inMap = false;
		const codeLines: string[] = [];
		for (const line of lines) {
			if (line.includes("const STAGE_APPROVE_MAP")) inMap = true;
			if (inMap) {
				if (line.trim() === "];") inMap = false;
				continue;
			}
			const t = line.trim();
			if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) continue;
			codeLines.push(line);
		}
		const offenders = codeLines.join("\n").match(/\/velpari-[a-z-]+-approve/g) ?? [];
		assert.deepEqual(
			offenders,
			[],
			`hard-coded approve command(s) in message code — interpolate approveCommandForStage(state.currentStage): ${offenders.join(", ")}`,
		);
	});
});
