/**
 * Stage gate tests (sequence hardening).
 *
 * Asserts the hard gate in runStage (STAGE_GATE):
 *   - a stage command runs only from its allowed source stage(s)
 *   - the block error names the correct command to run first
 *   - re-running a stage already in progress (redraft) stays allowed
 *   - nextCommandsFor lists the correct follow-up command(s)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage, STAGE_GATE } from "../../src/stages/registry.js";
import { advanceStage, createRun } from "../../src/core/state.js";
import { nextCommandsFor, STAGE_TRANSITIONS } from "../../src/core/constants.js";

interface Notice {
	message: string;
	level: string;
}

let tmpDir: string;
let notices: Notice[];

function makeCtx(): ExtensionCommandContext {
	notices = [];
	return {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
		},
	} as unknown as ExtensionCommandContext;
}

const pi = {} as ExtensionAPI;

function lastNotice(): Notice {
	assert.ok(notices.length > 0, "expected at least one notify call");
	return notices[notices.length - 1]!;
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-stage-gate-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("nextCommandsFor", () => {
	it("names the follow-up command for each stage", () => {
		assert.deepEqual(nextCommandsFor("brainstorming"), ["/velpari-approve-brainstorm"]);
		assert.deepEqual(nextCommandsFor("brainstormed"), ["/velpari-prd"]);
		assert.deepEqual(nextCommandsFor("planned-tests"), [
			"/velpari-atomic-function",
			"/velpari-design",
			"/velpari-handoff",
		]);
	});

	it("falls back to /velpari-status at a terminal stage", () => {
		assert.deepEqual(nextCommandsFor("handoff-ready"), ["/velpari-status"]);
	});

	it("includes the conditional built-rtm → designing transition", () => {
		assert.ok(
			STAGE_TRANSITIONS.some(
				(t) =>
					t.from === "built-rtm" && t.to === "designing" && t.command === "/velpari-architecture-generator",
			),
		);
	});

	it("hides the feasibility-skip command by default and shows it with the flag", () => {
		assert.deepEqual(nextCommandsFor("built-rtm"), ["/velpari-feasibility"]);
		assert.deepEqual(nextCommandsFor("built-rtm", { feasibilitySkip: true }), [
			"/velpari-feasibility",
			"/velpari-architecture-generator",
		]);
	});
});

describe("runStage hard gate", () => {
	it("blocks /velpari-prd while brainstorming and names the correct command", async () => {
		createRun("Test mission", tmpDir);
		await runStage("prd", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Cannot run \/velpari-prd at stage "brainstorming"/);
		assert.match(n.message, /\/velpari-approve-brainstorm/);
	});

	it("blocks /velpari-rtm at brainstormed and names /velpari-prd", async () => {
		const state = createRun("Test mission", tmpDir);
		advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		await runStage("rtm", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Cannot run \/velpari-rtm at stage "brainstormed"/);
		assert.match(n.message, /\/velpari-prd/);
	});

	it("blocks the optional stages before design is approved", async () => {
		const state = createRun("Test mission", tmpDir);
		const brainstormed = advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		advanceStage(brainstormed, "/velpari-prd", tmpDir); // drafting-prd
		await runStage("development-order", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Cannot run \/velpari-development-order at stage "drafting-prd"/);
	});

	it("allows the stage from its exact source stage (gate passes, next check runs)", async () => {
		const state = createRun("Test mission", tmpDir);
		advanceStage(state, "/velpari-approve-brainstorm", tmpDir); // brainstormed
		await runStage("prd", makeCtx(), pi, tmpDir);
		// Gate passed — the next failing precondition is the missing config.
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Project name not set/);
	});

	it("allows re-running a stage already in progress (redraft)", async () => {
		const state = createRun("Test mission", tmpDir);
		const brainstormed = advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		advanceStage(brainstormed, "/velpari-prd", tmpDir); // drafting-prd
		assert.ok((STAGE_GATE.prd as readonly string[]).includes("drafting-prd"));
		await runStage("prd", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.match(n.message, /Project name not set/);
	});

	it("blocks with no active run", async () => {
		await runStage("prd", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /No active run/);
	});
});

describe("feasibility-skip gate", () => {
	function advanceToBuiltRtm(): void {
		const s0 = createRun("Test mission", tmpDir);
		const s1 = advanceStage(s0, "/velpari-approve-brainstorm", tmpDir);
		const s2 = advanceStage(s1, "/velpari-prd", tmpDir);
		const s3 = advanceStage(s2, "/velpari-approve", tmpDir);
		const s4 = advanceStage(s3, "/velpari-rtm", tmpDir);
		advanceStage(s4, "/velpari-approve", tmpDir); // built-rtm
	}

	function seedProjectConfig(): void {
		const configDir = path.join(tmpDir, ".pi", "velpari");
		fs.mkdirSync(configDir, { recursive: true });
		fs.writeFileSync(
			path.join(configDir, "files.json"),
			JSON.stringify({ version: 4, projectName: "TestApp" }),
		);
	}

	it("blocks /velpari-architecture-generator from built-rtm without a published feasibility doc", async () => {
		advanceToBuiltRtm();
		await runStage("architecture-generator", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Cannot run \/velpari-architecture-generator at stage "built-rtm"/);
		assert.match(n.message, /Run \/velpari-feasibility first\./);
		assert.ok(!n.message.includes("or /velpari-architecture-generator"));
	});

	it("allows /velpari-architecture-generator from built-rtm when a published feasibility doc exists", async () => {
		advanceToBuiltRtm();
		seedProjectConfig();
		const feasDir = path.join(tmpDir, "Doc", "feasibility");
		fs.mkdirSync(feasDir, { recursive: true });
		fs.writeFileSync(path.join(feasDir, "feasibility-study_TestApp.md"), "# Feasibility\n");
		const sent: string[] = [];
		const piMock = {
			sendUserMessage: (message: string) => {
				sent.push(message);
			},
		} as unknown as ExtensionAPI;
		await runStage("architecture-generator", makeCtx(), piMock, tmpDir);
		assert.equal(sent.length, 1);
		assert.ok(notices.every((n) => n.level !== "error"));
	});
});
