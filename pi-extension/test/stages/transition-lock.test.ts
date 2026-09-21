/**
 * Transition-lock matrix tests (A1, D6).
 *
 * Covers the (fresh / stale × brainstorm-open / closed × stage) matrix
 * against the pure core (computeLegalCommandsFrom) plus a small
 * computeLegalCommands(cwd) integration pass:
 *   - closed + fresh: forward table + STAGE_GATE redraft self-loops
 *   - open: two-door collapse — only /velpari-approve-brainstorm is legal,
 *     every stage command blocked with the guide (stale set irrelevant)
 *   - closed + stale: stale declared inputs block, own-stale self-loop
 *     heals, earliestStale() names the EARLIEST stale stage's remedy
 *     (brainstorm sorts before every stage; no-stamp items ignored)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	computeLegalCommands,
	computeLegalCommandsFrom,
	type StageLockSpec,
} from "../../src/stages/transition-lock.js";
import {
	advanceStage,
	createRun,
	loadState,
	openBrainstormSession,
	saveState,
	type RunState,
} from "../../src/core/state.js";
import { STAGE_LOCK_SPECS } from "../../src/stages/registry.js";
import type { Stage } from "../../src/core/constants.js";
import type { StaleItem } from "../../src/core/freshness.js";

/** Minimal 3-stage spec list in pipeline execution order. */
const SPECS: StageLockSpec[] = [
	{
		key: "prd",
		command: "/velpari-prd",
		gate: ["brainstormed", "drafting-prd"],
		workingCopyArtifact: "PRD",
		inputs: [{ kind: "brainstorm", label: "brainstorm" }],
	},
	{
		key: "rtm",
		command: "/velpari-rtm",
		gate: ["drafted-prd", "building-rtm"],
		workingCopyArtifact: "RTM",
		inputs: [{ kind: "doc", artifact: "PRD", label: "PRD" }],
	},
	{
		key: "architecture-generator",
		command: "/velpari-architecture-generator",
		gate: ["analyzed-feasibility", "designing"],
		workingCopyArtifact: "design",
		inputs: [{ kind: "doc", artifact: "feasibility-study", label: "feasibility-study" }],
	},
];

function makeState(stage: Stage, extra?: Partial<RunState>): RunState {
	return {
		version: 1,
		runId: "run-1",
		mission: "Test mission",
		currentStage: stage,
		history: [],
		updatedAt: "2026-09-20T18:00:00.000Z",
		...extra,
	};
}

function stale(key: string, artifact: string, reason: StaleItem["reason"] = "input-changed"): StaleItem {
	return {
		key,
		artifact,
		path: `Doc/x/${key.replace(":", "_")}.md`,
		reason,
		changedInputs: reason === "no-stamp" ? [] : ["upstream:x"],
	};
}

describe("transition lock — closed session, fresh chain", () => {
	it("at brainstormed: forward table allows prd (+ brainstorm-anytime), blocks rtm naming prd", () => {
		const lock = computeLegalCommandsFrom({ state: makeState("brainstormed"), specs: SPECS });
		assert.equal(lock.brainstormOpen, false);
		assert.ok(lock.allowed.includes("/velpari-prd"));
		assert.ok(lock.allowed.includes("/velpari-brainstorm"), "brainstorm-anytime is always legal");
		assert.equal(lock.reasonFor("/velpari-prd"), null);
		const rtmBlock = lock.reasonFor("/velpari-rtm");
		assert.match(rtmBlock!, /Cannot run \/velpari-rtm at stage "brainstormed"/);
		assert.match(rtmBlock!, /\/velpari-prd/);
		assert.deepEqual(lock.nextCommands, ["/velpari-prd"]);
	});

	it("at an in-progress stage: redraft self-loop + its approve command are legal", () => {
		const lock = computeLegalCommandsFrom({ state: makeState("drafting-prd"), specs: SPECS });
		assert.equal(lock.reasonFor("/velpari-prd"), null);
		assert.equal(lock.reasonFor("/velpari-prd-approve"), null);
		assert.ok(lock.allowed.includes("/velpari-prd-approve"));
		assert.match(lock.reasonFor("/velpari-rtm-approve")!, /Cannot run \/velpari-rtm-approve/);
	});

	it("with no active run: only /velpari-brainstorm is legal", () => {
		const lock = computeLegalCommandsFrom({
			state: makeState("none", { runId: "" }),
			specs: SPECS,
		});
		assert.deepEqual(lock.allowed, ["/velpari-brainstorm"]);
		assert.deepEqual(lock.nextCommands, ["/velpari-brainstorm"]);
		assert.match(lock.reasonFor("/velpari-prd")!, /\/velpari-brainstorm/);
	});

	it("ungoverned commands (discipline/view/configure) are never blocked", () => {
		const lock = computeLegalCommandsFrom({ state: makeState("brainstormed"), specs: SPECS });
		assert.equal(lock.reasonFor("/velpari-status"), null);
		assert.equal(lock.reasonFor("/velpari-doctor"), null);
	});

	it("feasibility skip: architecture-generator from built-rtm only with the flag", () => {
		const gated = computeLegalCommandsFrom({ state: makeState("built-rtm"), specs: SPECS });
		assert.match(gated.reasonFor("/velpari-architecture-generator")!, /Cannot run/);
		const skipped = computeLegalCommandsFrom({
			state: makeState("built-rtm"),
			specs: SPECS,
			feasibilitySkip: true,
		});
		assert.equal(skipped.reasonFor("/velpari-architecture-generator"), null);
	});

	it("/velpari-approve-brainstorm is illegal without an open session", () => {
		const lock = computeLegalCommandsFrom({ state: makeState("brainstormed"), specs: SPECS });
		assert.match(lock.reasonFor("/velpari-approve-brainstorm")!, /No open brainstorm session/);
	});
});

describe("transition lock — brainstorm open (two-door collapse)", () => {
	it("only /velpari-approve-brainstorm is legal; every stage command gets the guide", () => {
		const lock = computeLegalCommandsFrom({ state: makeState("brainstorming"), specs: SPECS });
		assert.equal(lock.brainstormOpen, true);
		assert.equal(lock.pausedStage, undefined);
		assert.deepEqual(lock.allowed, ["/velpari-approve-brainstorm"]);
		assert.deepEqual(lock.nextCommands, ["/velpari-approve-brainstorm"]);
		assert.equal(lock.reasonFor("/velpari-approve-brainstorm"), null);

		const guide = lock.reasonFor("/velpari-prd")!;
		assert.match(guide, /Cannot run \/velpari-prd: brainstorm session open/);
		assert.match(guide, /\/velpari-approve-brainstorm/);
		assert.match(guide, /restart at \/velpari-prd/);
		assert.match(guide, /discard/);
		assert.match(lock.reasonFor("/velpari-rtm-approve")!, /brainstorm session open/);
		assert.match(lock.reasonFor("/velpari-brainstorm")!, /already open/);
	});

	it("the guide names the paused stage when the session was opened mid-run", () => {
		const lock = computeLegalCommandsFrom({
			state: makeState("brainstorming", { pausedStage: "building-rtm" }),
			specs: SPECS,
		});
		assert.equal(lock.pausedStage, "building-rtm");
		const guide = lock.reasonFor("/velpari-rtm")!;
		assert.match(guide, /paused at "building-rtm"/);
		assert.match(guide, /continue "building-rtm"/);
	});

	it("a stale set does not widen the open-session collapse", () => {
		const lock = computeLegalCommandsFrom({
			state: makeState("brainstorming", { pausedStage: "drafted-prd" }),
			specs: SPECS,
			staleSet: [stale("prd:TestApp", "prd")],
		});
		assert.deepEqual(lock.allowed, ["/velpari-approve-brainstorm"]);
		assert.match(lock.reasonFor("/velpari-prd")!, /brainstorm session open/);
	});
});

describe("transition lock — closed session, stale chain", () => {
	it("a stage whose OWN artifact is stale may re-run (update-mode self-loop)", () => {
		const lock = computeLegalCommandsFrom({
			state: makeState("drafted-prd"),
			specs: SPECS,
			staleSet: [stale("prd:TestApp", "prd")],
			projectName: "TestApp",
		});
		// drafted-prd is NOT in prd's gate row — the self-loop is what allows it.
		assert.equal(lock.reasonFor("/velpari-prd"), null);
		assert.ok(lock.allowed.includes("/velpari-prd"));
		assert.deepEqual(lock.nextCommands, ["/velpari-prd"]);
	});

	it("a stale declared input blocks the consuming stage with the republish + reconfirm remedy (input-changed)", () => {
		const lock = computeLegalCommandsFrom({
			state: makeState("drafted-prd"),
			specs: SPECS,
			staleSet: [stale("prd:TestApp", "prd")],
			cwd: "/tmp/any",
			projectName: "TestApp",
		});
		const block = lock.reasonFor("/velpari-rtm")!;
		assert.match(block, /Cannot run \/velpari-rtm: declared inputs are stale/);
		assert.match(block, /prd:TestApp is stale \(input-changed/);
		assert.match(block, /\/velpari-prd, then \/velpari-prd-approve/);
		assert.match(block, /\/velpari-reconfirm if the change has no impact on this artifact/);
	});

	it("an input-missing stale input keeps the republish-only remedy (D4)", () => {
		const lock = computeLegalCommandsFrom({
			state: makeState("drafted-prd"),
			specs: SPECS,
			staleSet: [stale("prd:TestApp", "prd", "input-missing")],
			cwd: "/tmp/any",
			projectName: "TestApp",
		});
		const block = lock.reasonFor("/velpari-rtm")!;
		assert.match(block, /prd:TestApp is stale \(input-missing/);
		assert.match(block, /republish via \/velpari-prd, then \/velpari-prd-approve/);
		assert.doesNotMatch(block, /reconfirm if the change has no impact/);
	});

	it("earliestStale orders by pipeline position — prd before rtm", () => {
		const lock = computeLegalCommandsFrom({
			state: makeState("built-rtm"),
			specs: SPECS,
			staleSet: [stale("rtm:TestApp", "rtm"), stale("prd:TestApp", "prd")],
			projectName: "TestApp",
		});
		const earliest = lock.earliestStale();
		assert.equal(earliest?.stage, "prd");
		assert.equal(earliest?.command, "/velpari-prd");
		assert.deepEqual(lock.nextCommands, ["/velpari-prd"]);
	});

	it("a stale brainstorm sorts before every stage and routes to /velpari-brainstorm", () => {
		const lock = computeLegalCommandsFrom({
			state: makeState("drafted-prd"),
			specs: SPECS,
			staleSet: [stale("prd:TestApp", "prd"), stale("brainstorm:test-mission", "brainstorm")],
			projectName: "TestApp",
		});
		const earliest = lock.earliestStale();
		assert.equal(earliest?.stage, "brainstorm");
		assert.equal(earliest?.command, "/velpari-brainstorm");
		assert.deepEqual(lock.nextCommands, ["/velpari-brainstorm"]);
	});

	it("no-stamp items are legacy warnings, never blocks", () => {
		const lock = computeLegalCommandsFrom({
			state: makeState("drafted-prd"),
			specs: SPECS,
			staleSet: [stale("prd:TestApp", "prd", "no-stamp")],
			cwd: "/tmp/any",
			projectName: "TestApp",
		});
		assert.equal(lock.earliestStale(), null);
		assert.equal(lock.reasonFor("/velpari-rtm"), null);
		assert.deepEqual(lock.nextCommands, ["/velpari-rtm"]);
	});
});

describe("transition lock — computeLegalCommands(cwd) integration", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-lock-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("fresh run: open session collapses to the approve door", () => {
		createRun("Test mission", tmpDir);
		const lock = computeLegalCommands(tmpDir, STAGE_LOCK_SPECS);
		assert.equal(lock.brainstormOpen, true);
		assert.deepEqual(lock.allowed, ["/velpari-approve-brainstorm"]);
		assert.deepEqual(lock.nextCommands, ["/velpari-approve-brainstorm"]);
	});

	it("approved brainstorm: prd + brainstorm-anytime are legal", () => {
		const s = createRun("Test mission", tmpDir);
		advanceStage(s, "/velpari-approve-brainstorm", tmpDir);
		const lock = computeLegalCommands(tmpDir, STAGE_LOCK_SPECS);
		assert.equal(lock.brainstormOpen, false);
		assert.equal(lock.reasonFor("/velpari-prd"), null);
		assert.ok(lock.allowed.includes("/velpari-brainstorm"));
		assert.deepEqual(lock.nextCommands, ["/velpari-prd"]);
	});

	it("paused mid-run session: the lock surfaces the paused stage", () => {
		const run = createRun("Test mission", tmpDir);
		saveState({ ...run, currentStage: "drafting-prd" as never }, tmpDir);
		openBrainstormSession(tmpDir);
		const lock = computeLegalCommands(tmpDir, STAGE_LOCK_SPECS);
		assert.equal(lock.brainstormOpen, true);
		assert.equal(lock.pausedStage, "drafting-prd");
		assert.match(lock.reasonFor("/velpari-prd")!, /paused at "drafting-prd"/);
		assert.equal(loadState(tmpDir).currentStage, "brainstorming");
	});

	it("registry STAGE_LOCK_SPECS covers every stage in execution order", () => {
		assert.deepEqual(
			STAGE_LOCK_SPECS.map((s) => s.key),
			[
				"prd",
				"rtm",
				"feasibility",
				"architecture-generator",
				"atomic-function",
				"pseudocode",
				"testplan",
				"development-order",
				"final-design",
			],
		);
	});
});
