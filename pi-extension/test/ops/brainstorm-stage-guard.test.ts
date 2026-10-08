/**
 * Stage-guard integration tests for /velpari-brainstorm (brainstorm-anytime).
 *
 * Asserts:
 *   - When no state.json exists (currentStage === "none"), handler proceeds
 *     past the stage guard and creates a new run.
 *   - When state.json exists with currentStage === "brainstorming", the
 *     nested-open guard fires: error is emitted, prompt is NOT sent, state
 *     is NOT modified.
 *   - When state.json exists with currentStage past "brainstorming", the
 *     handler pauses the current stage (openBrainstormSession — pausedStage
 *     recorded, same runId) and proceeds with the brainstorm flow.
 *   - The stage guard runs AFTER the multiplexer gate (no mux + open
 *     session → multiplexer error wins).
 *   - The nested-open guard runs BEFORE any state mutation (refused re-run
 *     leaves state.json byte-for-byte unchanged).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleBrainstorm } from "../../src/stages/brainstorm/index.js";
import { loadState, saveState, type RunState } from "../../src/core/state.js";

interface Notice {
	message: string;
	level: string;
}

interface Harness {
	notices: Notice[];
	userMessages: string[];
	ctx: ExtensionCommandContext;
	pi: ExtensionAPI;
	originalEnv: NodeJS.ProcessEnv;
	restoreEnv: () => void;
}

function makeHarness(): Harness {
	const notices: Notice[] = [];
	const userMessages: string[] = [];

	const ctx = {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
			setStatus: () => {},
			select: async () => "",
			confirm: async () => true,
			input: async () => "",
		},
	} as unknown as ExtensionCommandContext;

	const pi = {
		sendUserMessage: (msg: string) => {
			userMessages.push(msg);
		},
		appendEntry: () => {},
	} as unknown as ExtensionAPI;

	const originalEnv = { ...process.env };
	const restoreEnv = () => {
		for (const k of Object.keys(process.env)) {
			if (!(k in originalEnv)) delete process.env[k];
		}
		for (const [k, v] of Object.entries(originalEnv)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	};

	return { notices, userMessages, ctx, pi, originalEnv, restoreEnv };
}

function setMux() {
	delete process.env.PI_SUBAGENT_MUX;
	delete process.env.TMUX;
	delete process.env.ZELLIJ_PANE_ID;
	delete process.env.ZELLIJ_SESSION_NAME;
	delete process.env.WEZTERM_PANE;
	delete process.env.WEZTERM_EXECUTABLE;
	delete process.env.CMUX_PANE_ID;
	delete process.env.CMUX_SESSION_NAME;
	process.env.PI_SUBAGENT_MUX = "zellij";
}

function clearAllMux() {
	delete process.env.PI_SUBAGENT_MUX;
	delete process.env.TMUX;
	delete process.env.ZELLIJ_PANE_ID;
	delete process.env.ZELLIJ_SESSION_NAME;
	delete process.env.WEZTERM_PANE;
	delete process.env.WEZTERM_EXECUTABLE;
	delete process.env.CMUX_PANE_ID;
	delete process.env.CMUX_SESSION_NAME;
}

function makeStateAt(stage: RunState["currentStage"], mission = "test-mission"): RunState {
	return {
		version: 1,
		runId: "2026-09-14-10-00-existing-run",
		mission,
		currentStage: stage,
		history: [
			{
				stage: "brainstorming",
				command: "/velpari-brainstorm",
				timestamp: "2026-09-14T10:00:00.000Z",
			},
		],
		updatedAt: "2026-09-14T10:00:00.000Z",
	};
}

let tmpDir: string;
let harness: Harness;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-stage-guard-"));
	harness = makeHarness();
});

afterEach(() => {
	harness.restoreEnv();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("/velpari-brainstorm stage guard (brainstorm-anytime)", () => {
	it("proceeds past the stage guard when no state.json exists (fresh start)", async () => {
		setMux();

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const stageErrors = harness.notices.filter((n) => n.level === "error" && /already open/i.test(n.message));
		assert.equal(stageErrors.length, 0, "no stage error when no state.json exists");
		assert.equal(harness.userMessages.length, 1, "parent LLM prompt should be sent");
		assert.ok(existsSync(join(tmpDir, ".pi", "velpari", "state.json")), "state.json must be created on fresh start");
	});

	it("BLOCKS a nested open when currentStage === brainstorming (no state mutation)", async () => {
		setMux();
		saveState(makeStateAt("brainstorming"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const stageErrors = harness.notices.filter((n) => n.level === "error" && /already open/i.test(n.message));
		assert.equal(stageErrors.length, 1, "exactly one nested-open error");
		assert.match(stageErrors[0]!.message, /\/velpari-approve-brainstorm/);
		assert.match(stageErrors[0]!.message, /discard/);
		assert.ok(!stageErrors[0]!.message.includes("/velpari-reset"));
		assert.equal(harness.userMessages.length, 0, "parent LLM prompt must NOT be sent");

		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "brainstorming", "state must not change");
		assert.equal(after.pausedStage, undefined);
	});

	it("OPENS a paused session when currentStage === brainstormed (same runId)", async () => {
		setMux();
		saveState(makeStateAt("brainstormed"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const stageErrors = harness.notices.filter((n) => n.level === "error" && /already open/i.test(n.message));
		assert.equal(stageErrors.length, 0, "brainstorm-anytime allows opening from brainstormed");
		assert.equal(harness.userMessages.length, 1, "parent LLM prompt should be sent");

		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "brainstorming");
		assert.equal(after.pausedStage, "brainstormed");
		assert.equal(after.runId, "2026-09-14-10-00-existing-run", "same run is reused");
	});

	it("OPENS a paused session when currentStage === drafting-prd", async () => {
		setMux();
		saveState(makeStateAt("drafting-prd"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const stageErrors = harness.notices.filter((n) => n.level === "error" && /already open/i.test(n.message));
		assert.equal(stageErrors.length, 0);
		assert.equal(harness.userMessages.length, 1);

		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "brainstorming");
		assert.equal(after.pausedStage, "drafting-prd");
	});

	it("OPENS a paused session when currentStage === planned-tests", async () => {
		setMux();
		saveState(makeStateAt("planned-tests"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "brainstorming");
		assert.equal(after.pausedStage, "planned-tests");
		assert.equal(harness.userMessages.length, 1);
	});

	it("OPENS a paused session when currentStage === handoff-ready", async () => {
		setMux();
		saveState(makeStateAt("handoff-ready"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "brainstorming");
		assert.equal(after.pausedStage, "handoff-ready");
		assert.equal(harness.userMessages.length, 1);
	});

	it("multiplexer gate runs BEFORE stage guard (no mux wins)", async () => {
		clearAllMux();
		saveState(makeStateAt("brainstorming"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		// Only multiplexer error, not a nested-open error
		const allErrors = harness.notices.filter((n) => n.level === "error");
		assert.equal(allErrors.length, 1, "exactly one error notice");
		assert.match(allErrors[0]!.message, /multiplexer/i);
		assert.doesNotMatch(allErrors[0]!.message, /already open/i);

		// State.json unchanged
		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "brainstorming");
	});

	it("nested-open guard runs BEFORE any state mutation (no overwrite)", async () => {
		setMux();
		const before = makeStateAt("brainstorming", "ORIGINAL_MISSION");
		saveState(before, tmpDir);
		const beforeJson = readFileSync(join(tmpDir, ".pi", "velpari", "state.json"), "utf8");

		await handleBrainstorm("DIFFERENT_MISSION", harness.ctx, harness.pi, tmpDir);

		// Refused — no new run, no new mission
		const afterJson = readFileSync(join(tmpDir, ".pi", "velpari", "state.json"), "utf8");
		assert.equal(beforeJson, afterJson, "state.json must be byte-for-byte unchanged");
		const after = loadState(tmpDir);
		assert.equal(after.mission, "ORIGINAL_MISSION", "mission must not change");
		assert.equal(after.currentStage, "brainstorming");
	});
});
