/**
 * tool_call hook tests (Phase 2).
 *
 * Drives the registered tool_call handler directly (mock ExtensionAPI
 * captures the handler from pi.on). Asserts:
 *   - the hook registers on the "tool_call" event
 *   - edit/write outside the brainstorm folder is blocked with a reason
 *     while a brainstorm is open
 *   - writes inside the brainstorm folder pass
 *   - the lock lifts once the stage advances past "brainstorming"
 *   - fail-open: a guard/state error never blocks the tool call
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerToolCallHook, guardStageMutation } from "../../src/hooks/tool-call.js";
import {
	advanceStage,
	createRun,
	discardBrainstormSession,
	loadState,
	openBrainstormSession,
	saveState,
} from "../../src/core/state.js";
import { PATHS } from "../../src/core/constants.js";

type ToolCallHandler = (
	event: { toolName: string; input?: Record<string, unknown> },
	ctx: { cwd: string },
) => { block: true; reason: string } | undefined;

let tmpDir: string;
let handlers: Record<string, ToolCallHandler[]>;

function makePi(): ExtensionAPI {
	handlers = {};
	const pi = {
		on: (event: string, handler: ToolCallHandler) => {
			(handlers[event] ??= []).push(handler);
		},
	};
	return pi as unknown as ExtensionAPI;
}

function fire(toolName: string, input?: Record<string, unknown>) {
	const list = handlers["tool_call"] ?? [];
	assert.equal(list.length, 1, "expected exactly one tool_call handler");
	return list[0]!({ toolName, input }, { cwd: tmpDir });
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-tool-call-"));
	registerToolCallHook(makePi());
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("tool_call hook (brainstorm mutation lock)", () => {
	it("registers on the tool_call event", () => {
		assert.ok(handlers["tool_call"]);
	});

	it("passes everything through when no brainstorm is active", () => {
		assert.equal(fire("write", { path: "src/index.ts" }), undefined);
	});

	it("blocks edit/write outside the brainstorm folder while brainstorming", () => {
		const run = createRun("Test mission", tmpDir);
		assert.equal(loadState(tmpDir).currentStage, "brainstorming");

		const res = fire("write", { path: "src/index.ts" });
		assert.equal(res?.block, true);
		assert.match(res?.reason ?? "", /velpari-approve-brainstorm/);

		const edit = fire("edit", { path: "README.md" });
		assert.equal(edit?.block, true);

		// Inside the brainstorm folder: allowed.
		const inside = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", run.runId, "brainstorm", "brainstorm-notes.md");
		assert.equal(fire("write", { path: inside }), undefined);

		// Non-mutating tools pass through.
		assert.equal(fire("read", { path: "src/index.ts" }), undefined);
		assert.equal(fire("bash", { command: "ls" }), undefined);
	});

	it("lifts the lock once the stage advances past brainstorming", () => {
		const state = createRun("Test mission", tmpDir);
		assert.equal(fire("write", { path: "src/index.ts" })?.block, true);

		advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		assert.equal(loadState(tmpDir).currentStage, "brainstormed");
		assert.equal(fire("write", { path: "src/index.ts" }), undefined);
	});

	it("fails open when state cannot be loaded (corrupt state.json)", () => {
		const filePath = path.join(tmpDir, PATHS.STATE_FILE);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, "{ not json", "utf8");

		// The guard throws internally; the hook must allow the call.
		assert.equal(fire("write", { path: "src/index.ts" }), undefined);
	});
});

describe("tool_call hook (stage mutation lock)", () => {
	/** Walk the chained state machine through the given commands. */
	function walkTo(commands: string[]) {
		let state = loadState(tmpDir);
		for (const command of commands) {
			state = advanceStage(state, command, tmpDir);
		}
		return state;
	}

	it("blocks edit/write outside the stage folder while a stage draft is open", () => {
		const run = createRun("Test mission", tmpDir);
		const state = walkTo(["/velpari-approve-brainstorm", "/velpari-prd"]);
		assert.equal(state.currentStage, "drafting-prd");

		const res = fire("write", { path: "src/index.ts" });
		assert.equal(res?.block, true);
		assert.match(res?.reason ?? "", /Locked: stage "drafting-prd" in progress/);
		assert.match(res?.reason ?? "", /velpari_stage_publish|\/velpari-prd-approve/);

		// Doc/ is NOT exempt — publishing goes through the publish tool only.
		const doc = fire("write", { path: path.join(tmpDir, "Doc", "requirements", "PRD_X.md") });
		assert.equal(doc?.block, true);

		// Inside the stage folder: allowed.
		const inside = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", run.runId, "prd", "PRD_X.md");
		assert.equal(fire("write", { path: inside }), undefined);

		// Reads and bash pass through.
		assert.equal(fire("read", { path: "src/index.ts" }), undefined);
		assert.equal(fire("bash", { command: "ls" }), undefined);
	});

	it("maps planning-tests to the tests/ run folder", () => {
		const run = createRun("Test mission", tmpDir);
		const state = walkTo([
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
		]);
		assert.equal(state.currentStage, "planning-tests");

		assert.equal(fire("write", { path: "src/index.ts" })?.block, true);
		const inside = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", run.runId, "tests", "test-cases_X.md");
		assert.equal(fire("write", { path: inside }), undefined);
	});

	it("lifts the lock on completed stages", () => {
		createRun("Test mission", tmpDir);
		const state = walkTo(["/velpari-approve-brainstorm", "/velpari-prd", "/velpari-prd-approve"]);
		assert.equal(state.currentStage, "drafted-prd");
		assert.equal(fire("write", { path: "src/index.ts" }), undefined);
	});
});

describe("tool_call hook (scout spawn guard)", () => {
	it("blocks subagent spawns without a -report.json path during scout stages", () => {
		createRun("Test mission", tmpDir);
		let state = loadState(tmpDir);
		state = advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		advanceStage(state, "/velpari-prd", tmpDir); // drafting-prd

		const blocked = fire("subagent", { agent: "fr-extractor", task: "extract FRs" });
		assert.equal(blocked?.block, true);
		assert.match(blocked?.reason ?? "", /-report\.json/);

		const allowed = fire("subagent", {
			agent: "fr-extractor",
			task: "extract FRs and write prd/scouts/fr-extractor-report.json",
		});
		assert.equal(allowed, undefined);
	});

	it("does not gate subagent spawns outside scout stages", () => {
		const state = createRun("Test mission", tmpDir);
		advanceStage(state, "/velpari-approve-brainstorm", tmpDir); // brainstormed
		assert.equal(fire("subagent", { task: "anything" }), undefined);
	});
});

describe("tool_call hook (mutation-lock precedence, D4)", () => {
	function openPausedBrainstorm(pausedStage: string) {
		const run = createRun("Test mission", tmpDir);
		saveState({ ...run, currentStage: pausedStage as never }, tmpDir);
		return openBrainstormSession(tmpDir);
	}

	it("brainstorm lock wins over the stage lock while a session is open (pausedStage set)", () => {
		const opened = openPausedBrainstorm("drafting-prd");
		assert.equal(loadState(tmpDir).currentStage, "brainstorming");
		assert.equal(loadState(tmpDir).pausedStage, "drafting-prd");

		// A write INSIDE the paused stage's folder would be allowed by the
		// stage lock — but the brainstorm lock owns the whole project while
		// the session is open and blocks it.
		const prdWorking = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", opened.runId, "prd", "working-copy.md");
		const res = fire("write", { path: prdWorking });
		assert.equal(res?.block, true);
		assert.match(res?.reason ?? "", /read-only/);
		assert.match(res?.reason ?? "", /velpari-approve-brainstorm/);

		// Writes inside the brainstorm folder stay allowed.
		const inside = path.join(
			tmpDir,
			".IDE_Plans",
			"velpari",
			"runs",
			opened.runId,
			"brainstorm",
			"brainstorm-notes.md",
		);
		assert.equal(fire("write", { path: inside }), undefined);
	});

	it("guardStageMutation is suppressed at brainstorming even when called directly", () => {
		openPausedBrainstorm("drafting-prd");
		const state = loadState(tmpDir);
		const res = guardStageMutation("write", { path: "src/index.ts" }, state, tmpDir);
		assert.equal(res, undefined, "stage lock must not fire while a brainstorm is open");
	});

	it("discard lifts the brainstorm lock and restores the stage lock at the resumed stage", () => {
		const opened = openPausedBrainstorm("drafting-prd");
		const prdWorking = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", opened.runId, "prd", "working-copy.md");
		assert.equal(fire("write", { path: prdWorking })?.block, true);

		discardBrainstormSession(tmpDir);
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd");

		// Stage lock back in force: inside the stage folder allowed,
		// outside blocked.
		assert.equal(fire("write", { path: prdWorking }), undefined);
		assert.equal(fire("write", { path: "src/index.ts" })?.block, true);
	});
});
