/**
 * Brainstorm v2.2 single-shot guard — integration test.
 *
 * Walks the full brainstorm lifecycle through the state machine and
 * verifies the guard fires at the right moments:
 *   - Fresh run → /velpari-brainstorm is allowed
 *   - brainstorming → /velpari-brainstorm re-run is BLOCKED (v2.2 guard)
 *   - /velpari-approve-brainstorm advances to brainstormed
 *   - brainstormed → /velpari-brainstorm re-run is BLOCKED
 *   - User must /velpari-reset to start a new brainstorm
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
	type RunState,
} from "../../../src/core/state.js";

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
		const statePath = path.join(tmpDir, ".IDE_Plans", "velpari", "state.json");
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

		// Three entries: initial createRun + /velpari-approve-brainstorm + ... wait,
		// just two entries: initial createRun + advance.
		const state = loadState(tmpDir);
		assert.equal(state.history.length, 2);
		assert.equal(state.history[0]!.stage, "brainstorming");
		assert.equal(state.history[1]!.stage, "brainstormed");
	});

	it("approve-brainstorm preserves the mission in state history", () => {
		let s = createRun("MyMission", tmpDir);
		s = advanceStage(s, "/velpari-approve-brainstorm", tmpDir);
		const state = loadState(tmpDir);
		assert.equal(state.mission, "MyMission");
		assert.equal(state.currentStage, "brainstormed");
	});
});
