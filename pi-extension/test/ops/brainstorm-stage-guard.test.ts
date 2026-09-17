/**
 * Stage-guard integration tests for /velpari-brainstorm (v2.2).
 *
 * Asserts:
 *   - When no state.json exists (currentStage === "none"), handler proceeds
 *     past the stage guard and creates a new run.
 *   - When state.json exists with currentStage === "brainstorming", handler
 *     proceeds (resume allowed).
 *   - When state.json exists with currentStage past "brainstorming", the
 *     stage guard fires: error is emitted, prompt is NOT sent, run dir is
 *     NOT modified.
 *   - The stage guard runs AFTER the multiplexer gate (no mux + advanced
 *     stage → multiplexer error wins).
 *   - The stage guard runs BEFORE createRun (refused re-run on "brainstormed"
 *     does not overwrite the existing state.json).
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

describe("/velpari-brainstorm stage guard (v2.2)", () => {
	it("proceeds past the stage guard when no state.json exists (fresh start)", async () => {
		setMux();

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const stageErrors = harness.notices.filter(
			(n) => n.level === "error" && /cannot start from stage/i.test(n.message),
		);
		assert.equal(stageErrors.length, 0, "no stage error when no state.json exists");
		assert.equal(harness.userMessages.length, 1, "parent LLM prompt should be sent");
		assert.ok(
			existsSync(join(tmpDir, ".IDE_Plans", "velpari", "state.json")),
			"state.json must be created on fresh start",
		);
	});

	it("proceeds past the stage guard when currentStage === brainstorming (resume)", async () => {
		setMux();
		saveState(makeStateAt("brainstorming"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const stageErrors = harness.notices.filter(
			(n) => n.level === "error" && /cannot start from stage/i.test(n.message),
		);
		assert.equal(stageErrors.length, 0, "resume from brainstorming must be allowed");
		assert.equal(harness.userMessages.length, 1, "parent LLM prompt should be sent");
	});

	it("HITS the stage guard when currentStage === brainstormed (no overwrite)", async () => {
		setMux();
		const originalState = makeStateAt("brainstormed");
		saveState(originalState, tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const stageErrors = harness.notices.filter(
			(n) => n.level === "error" && /cannot start from stage/i.test(n.message),
		);
		assert.equal(stageErrors.length, 1, "exactly one stage error");
		assert.match(stageErrors[0]!.message, /brainstormed/);
		assert.match(stageErrors[0]!.message, /\/velpari-prd/);
		assert.match(stageErrors[0]!.message, /\/velpari-reset/);

		assert.equal(harness.userMessages.length, 0, "parent LLM prompt must NOT be sent");

		// Critical: state.json is NOT overwritten
		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "brainstormed", "state.json must not be overwritten");
		assert.equal(after.runId, "2026-09-14-10-00-existing-run");
	});

	it("HITS the stage guard when currentStage === drafting-prd", async () => {
		setMux();
		saveState(makeStateAt("drafting-prd"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const stageErrors = harness.notices.filter(
			(n) => n.level === "error" && /cannot start from stage/i.test(n.message),
		);
		assert.equal(stageErrors.length, 1);
		assert.match(stageErrors[0]!.message, /drafting-prd/);
		assert.equal(harness.userMessages.length, 0);

		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "drafting-prd");
	});

	it("HITS the stage guard when currentStage === planned-tests (names /velpari-development-order)", async () => {
		setMux();
		saveState(makeStateAt("planned-tests"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const stageErrors = harness.notices.filter(
			(n) => n.level === "error" && /cannot start from stage/i.test(n.message),
		);
		assert.equal(stageErrors.length, 1);
		// In the industry-standard order, planned-tests → development-order (Stage 9) is the next step.
		assert.match(stageErrors[0]!.message, /\/velpari-development-order/);
	});

	it("HITS the stage guard when currentStage === handoff-ready (reset hint)", async () => {
		setMux();
		saveState(makeStateAt("handoff-ready"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const stageErrors = harness.notices.filter(
			(n) => n.level === "error" && /cannot start from stage/i.test(n.message),
		);
		assert.equal(stageErrors.length, 1);
		assert.match(stageErrors[0]!.message, /\/velpari-reset/);
		assert.match(stageErrors[0]!.message, /handoff-ready/);
	});

	it("multiplexer gate runs BEFORE stage guard (no mux wins)", async () => {
		clearAllMux();
		saveState(makeStateAt("brainstormed"), tmpDir);

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		// Only multiplexer error, not stage error
		const allErrors = harness.notices.filter((n) => n.level === "error");
		assert.equal(allErrors.length, 1, "exactly one error notice");
		assert.match(allErrors[0]!.message, /multiplexer/i);
		assert.doesNotMatch(allErrors[0]!.message, /cannot start from stage/i);

		// State.json unchanged
		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "brainstormed");
	});

	it("stage guard runs BEFORE createRun (no state overwrite)", async () => {
		setMux();
		const before = makeStateAt("brainstormed", "ORIGINAL_MISSION");
		saveState(before, tmpDir);
		const beforeJson = readFileSync(
			join(tmpDir, ".IDE_Plans", "velpari", "state.json"),
			"utf8",
		);

		await handleBrainstorm("DIFFERENT_MISSION", harness.ctx, harness.pi, tmpDir);

		// Refused — no new run, no new mission
		const afterJson = readFileSync(
			join(tmpDir, ".IDE_Plans", "velpari", "state.json"),
			"utf8",
		);
		assert.equal(beforeJson, afterJson, "state.json must be byte-for-byte unchanged");
		const after = loadState(tmpDir);
		assert.equal(after.mission, "ORIGINAL_MISSION", "mission must not change");
		assert.equal(after.currentStage, "brainstormed");
	});
});