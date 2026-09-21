/**
 * Brainstorm guard — integration tests.
 *
 * Part 1 (state machine): /velpari-brainstorm is not a STAGE_TRANSITIONS
 * row, so advanceStage rejects same-stage re-entry; approve advances to
 * brainstormed; reset clears state for a fresh run.
 *
 * Part 2 (brainstorm-anytime, A2): the open/resume/discard session
 * primitives pause and resume mid-run stages — open from any stage, two
 * approve doors, nested-open block, discard without an artifact.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	createRun,
	advanceStage,
	discardBrainstormSession,
	loadState,
	openBrainstormSession,
	resumeFromBrainstorm,
	saveState,
	type RunState,
} from "../../../src/core/state.js";
import { loadHistory } from "../../../src/core/history.js";

let tmpDir: string;

function writeFilesConfig() {
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TestApp" }),
	);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-bs-guard-"));
	writeFilesConfig();
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("brainstorm guard — full lifecycle integration", () => {
	it("fresh run allows /velpari-brainstorm", () => {
		const s = createRun("Test mission", tmpDir);
		assert.equal(s.currentStage, "brainstorming");
		assert.equal(loadState(tmpDir).currentStage, "brainstorming");
	});

	it("re-running /velpari-brainstorm from brainstorming is blocked (v2.2 guard)", () => {
		const s = createRun("Test mission", tmpDir);
		assert.throws(
			() => advanceStage(s, "/velpari-brainstorm", tmpDir),
			/No matching transition/,
			"state machine must reject same-stage re-entry for brainstorm",
		);
		// State unchanged.
		assert.equal(loadState(tmpDir).currentStage, "brainstorming");
	});

	it("approve-brainstorm advances to brainstormed; re-running brainstorm stays blocked", () => {
		let s = createRun("Test mission", tmpDir);
		s = advanceStage(s, "/velpari-approve-brainstorm", tmpDir);
		assert.equal(s.currentStage, "brainstormed");

		// Re-running /velpari-brainstorm from brainstormed is also blocked.
		assert.throws(
			() => advanceStage(s, "/velpari-brainstorm", tmpDir),
			/No matching transition/,
			"brainstormed state must not allow re-entry into brainstorming",
		);
	});

	it("/velpari-reset clears state, allowing a fresh /velpari-brainstorm", () => {
		let s = createRun("Original", tmpDir);
		s = advanceStage(s, "/velpari-approve-brainstorm", tmpDir);
		assert.equal(s.currentStage, "brainstormed");
		assert.ok(loadState(tmpDir).runId, "precondition: state exists");

		// clearRun removes state.json (no advanceState call needed).
		const statePath = path.join(tmpDir, ".pi", "velpari", "state.json");
		fs.unlinkSync(statePath);
		assert.ok(!fs.existsSync(statePath));

		// Fresh createRun starts a new brainstorm.
		const s2 = createRun("AfterReset", tmpDir);
		assert.equal(s2.currentStage, "brainstorming");
		assert.equal(s2.mission, "AfterReset");
	});

	it("history records one entry per brainstorm lifecycle phase", () => {
		let s: RunState = createRun("Test", tmpDir);
		s = advanceStage(s, "/velpari-approve-brainstorm", tmpDir);

		// Two entries in the per-run history.jsonl: initial createRun + advance.
		const history = loadHistory(tmpDir, s.runId);
		assert.equal(history.length, 2);
		assert.equal(history[0]!.stage, "brainstorming");
		assert.equal(history[1]!.stage, "brainstormed");
	});

	it("approve-brainstorm preserves the mission in state history", () => {
		let s = createRun("MyMission", tmpDir);
		s = advanceStage(s, "/velpari-approve-brainstorm", tmpDir);
		const state = loadState(tmpDir);
		assert.equal(state.mission, "MyMission");
		assert.equal(state.currentStage, "brainstormed");
	});
});

describe("brainstorm-anytime — full lifecycle integration (A2)", () => {
	function enterStage(stage: string): RunState {
		const run = createRun("Test mission", tmpDir);
		const moved: RunState = { ...run, currentStage: stage as never };
		saveState(moved, tmpDir);
		return moved;
	}

	it("open from a mid-run stage pauses it; approve-continue resumes it", () => {
		enterStage("building-rtm");
		const opened = openBrainstormSession(tmpDir);
		assert.equal(opened.currentStage, "brainstorming");
		assert.equal(opened.pausedStage, "building-rtm");

		const resumed = resumeFromBrainstorm(tmpDir, "continue");
		assert.equal(resumed.currentStage, "building-rtm");
		assert.equal(resumed.pausedStage, undefined);

		// History: open + resume entries on the same run.
		const history = loadHistory(tmpDir, resumed.runId);
		const commands = history.map((h) => h.command);
		assert.ok(commands.some((c) => c.includes("open-session")));
		assert.ok(commands.some((c) => c.includes("continue")));
	});

	it("open from a mid-run stage; approve-restart lands at brainstormed", () => {
		enterStage("designing");
		openBrainstormSession(tmpDir);

		const restarted = resumeFromBrainstorm(tmpDir, "restart-prd");
		assert.equal(restarted.currentStage, "brainstormed");
		assert.equal(restarted.pausedStage, undefined);
	});

	it("a nested open is the only blocked re-entry", () => {
		enterStage("designing");
		openBrainstormSession(tmpDir);
		assert.throws(
			() => openBrainstormSession(tmpDir),
			/already open|brainstorming/,
			"nested open must throw",
		);
		// The paused session is untouched.
		const state = loadState(tmpDir);
		assert.equal(state.currentStage, "brainstorming");
		assert.equal(state.pausedStage, "designing");
	});

	it("discard resumes the paused stage without an artifact; a new brainstorm may open afterwards", () => {
		enterStage("drafted-prd");
		const opened = openBrainstormSession(tmpDir);
		discardBrainstormSession(tmpDir);
		assert.equal(loadState(tmpDir).currentStage, "drafted-prd");

		// A second session may open from the same stage.
		const reopened = openBrainstormSession(tmpDir);
		assert.equal(reopened.currentStage, "brainstorming");
		assert.equal(reopened.pausedStage, "drafted-prd");
		assert.equal(reopened.runId, opened.runId, "same run is reused");

		const history = loadHistory(tmpDir, opened.runId);
		const commands = history.map((h) => h.command);
		assert.ok(commands.some((c) => c.includes("discard")));
	});
});
