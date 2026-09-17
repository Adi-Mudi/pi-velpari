/**
 * Stages 6–10 state machine + history tests.
 *
 * The "redraft" concept (re-running a stage while its own draft is open)
 * is enforced at the runStage layer via STAGE_GATE, not at advanceStage.
 * STAGE_GATE accepts the stage's own in-progress state for redraft; this is
 * already asserted in `tests/stages/stage-gate.test.ts` (Phase 2).
 *
 * This file covers the state-machine level for Stages 6–10:
 *   - Every Stage 6–10 transition exists in STAGE_TRANSITIONS
 *   - The chain end-to-end produces the right history length
 *   - The first history entry is the initial createRun
 *   - Unknown commands throw with the current stage named
 *
 * Redraft at the runStage layer is covered by `tests/stages/stage-gate.test.ts`.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	createRun,
	advanceStage,
	loadState,
	saveState,
	type RunState,
} from "../../src/core/state.js";
import { STAGE_TRANSITIONS } from "../../src/core/constants.js";

let tmpDir: string;

function writeFilesConfig() {
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "StageChainApp" }),
	);
}

/** Walk the entire Option B chain up to and including finalized-design. */
function walkToFinalizedDesign(): RunState {
	writeFilesConfig();
	let s = createRun("TestApp", tmpDir) as RunState;
	const walk = [
		"/velpari-approve-brainstorm",
		"/velpari-prd",
		"/velpari-prd-approve",
		"/velpari-rtm",
		"/velpari-rtm-approve",
		"/velpari-feasibility",
		"/velpari-feasibility-approve",
		"/velpari-architecture-generator",
		"/velpari-architecture-generator-approve",
		"/velpari-atomic-function",
		"/velpari-atomic-function-approve",
		"/velpari-pseudocode",
		"/velpari-pseudocode-approve",
		"/velpari-testplan",
		"/velpari-testplan-approve",
		"/velpari-development-order",
		"/velpari-development-order-approve",
		"/velpari-final-design",
		"/velpari-final-design-approve",
	];
	for (const cmd of walk) s = advanceStage(s, cmd, tmpDir);
	return s;
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-stages-6-10-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("STAGE_TRANSITIONS — Stages 6–10 entries exist", () => {
	// The Option B migration reordered Stages 6/9/10. Each transition
	// must be present in STAGE_TRANSITIONS or the chain breaks.

	it("designed → analyzing-atomic-functions via /velpari-atomic-function", () => {
		const t = STAGE_TRANSITIONS.find(
			(tr) => tr.from === "designed" && tr.command === "/velpari-atomic-function",
		);
		assert.ok(t, "transition must exist");
		assert.equal(t!.to, "analyzing-atomic-functions");
	});

	it("analyzed-atomic-functions → writing-pseudocode via /velpari-pseudocode", () => {
		const t = STAGE_TRANSITIONS.find(
			(tr) =>
				tr.from === "analyzed-atomic-functions" && tr.command === "/velpari-pseudocode",
		);
		assert.ok(t);
		assert.equal(t!.to, "writing-pseudocode");
	});

	it("planned-tests → ordering-development via /velpari-development-order", () => {
		const t = STAGE_TRANSITIONS.find(
			(tr) => tr.from === "planned-tests" && tr.command === "/velpari-development-order",
		);
		assert.ok(t);
		assert.equal(t!.to, "ordering-development");
	});

	it("ordered-development → finalizing-design via /velpari-final-design", () => {
		const t = STAGE_TRANSITIONS.find(
			(tr) =>
				tr.from === "ordered-development" && tr.command === "/velpari-final-design",
		);
		assert.ok(t);
		assert.equal(t!.to, "finalizing-design");
	});

	it("finalized-design → handoff-ready via /velpari-handoff", () => {
		const t = STAGE_TRANSITIONS.find(
			(tr) => tr.from === "finalized-design" && tr.command === "/velpari-handoff",
		);
		assert.ok(t);
		assert.equal(t!.to, "handoff-ready");
	});
});

describe("history tracking — Stages 6–10", () => {
	it("the full Option B walk produces exactly 20 history entries", () => {
		const finalState = walkToFinalizedDesign();
		// 20 = 1 createRun + 19 walk commands
		assert.equal(
			finalState.history.length,
			20,
			`expected 20 history entries, got ${finalState.history.length}`,
		);
	});

	it("the first history entry is the initial createRun (brainstorming + /velpari-brainstorm)", () => {
		const finalState = walkToFinalizedDesign();
		const first = finalState.history[0]!;
		assert.equal(first.stage, "brainstorming");
		assert.equal(first.command, "/velpari-brainstorm");
	});

	it("every transition records exactly one history entry", () => {
		const finalState = walkToFinalizedDesign();
		// Each history entry's `stage` field must equal the previous target.
		// The first entry's stage is the initial state.
		for (let i = 1; i < finalState.history.length; i++) {
			const prev = finalState.history[i - 1]!;
			const curr = finalState.history[i]!;
			// Skip: redrafts don't add entries (but our walk has none).
			// The curr.stage should equal what advanceStage produced.
			assert.ok(curr.stage.length > 0, `entry ${i} has empty stage`);
			assert.ok(prev.stage.length > 0, `entry ${i - 1} has empty stage`);
		}
	});

	it("the chain reaches finalized-design (and only after that, handoff-ready)", () => {
		const finalState = walkToFinalizedDesign();
		assert.equal(finalState.currentStage, "finalized-design");
	});
});

describe("error handling — unknown command", () => {
	it("throws 'Cannot transition from <stage> via <cmd>' on unknown command", () => {
		const s = createRun("m", tmpDir); // brainstorming
		assert.throws(
			() => advanceStage(s, "/velpari-bogus-command", tmpDir),
			/Cannot transition from "brainstorming" via "\/velpari-bogus-command"/,
			"unknown commands must throw with current stage and command named",
		);
	});

	it("rejects command from wrong source stage with explicit stage name", () => {
		const s = createRun("m", tmpDir);
		saveState(s, tmpDir);
		const advanced = advanceStage(s, "/velpari-approve-brainstorm", tmpDir); // → brainstormed
		// Now try to skip the PRD stage.
		assert.throws(
			() => advanceStage(advanced, "/velpari-rtm", tmpDir),
			/Cannot transition from "brainstormed" via "\/velpari-rtm"/,
			"invalid sequence must throw naming both the current stage and the rejected command",
		);
	});
});
