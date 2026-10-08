/**
 * /velpari-design-logging handler gate tests (v1.4.0).
 *
 * Covers the gating logic (no state mutation, no IO side effects
 * beyond the notify). Verifies that:
 *   - No runId / currentStage === "none" → refuse.
 *   - No projectName → refuse.
 *   - Stage before designed → refuse.
 *   - Missing PRD → refuse.
 *   - Missing design → refuse.
 *   - No multiplexer and no PI_SUBAGENT_MUX → refuse.
 *   - Happy path: writes nothing but emits a notify with the 3 scout names.
 *
 * Note: we don't mock the multiplexer module (node:test lacks
 * `mock.module`). Instead we use PI_SUBAGENT_MUX to drive the
 * multiplexer gate in both directions.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleDesignLogging } from "../../src/ops/design-logging.js";
import { saveState, type RunState } from "../../src/core/state.js";

type Notice = { msg: string; level: string };
type Ctx = Parameters<typeof handleDesignLogging>[0];
type Api = Parameters<typeof handleDesignLogging>[1];

let cwd: string;
let notices: Notice[];
let sentMessages: string[];
let prevPiSubagentMux: string | undefined;

/** Every env var detectMultiplexer (core/multiplexer.ts) sniffs. The
 *  multiplexer-gate test must control ALL of them — leaving TMUX or
 *  ZELLIJ_* to the real machine makes the suite fail inside a mux. */
const MUX_ENV_KEYS = [
	"PI_SUBAGENT_MUX",
	"TMUX",
	"ZELLIJ_PANE_ID",
	"ZELLIJ_SESSION_NAME",
	"WEZTERM_PANE",
	"WEZTERM_EXECUTABLE",
	"CMUX_PANE_ID",
	"CMUX_SESSION_NAME",
] as const;
let savedMuxEnv: Record<string, string | undefined> = {};

function seedState(patch: Partial<RunState> = {}): void {
	const state: RunState = {
		version: 1,
		runId: "2026-09-16-10-00-test",
		mission: "test",
		currentStage: "designed",
		history: [],
		updatedAt: new Date().toISOString(),
		...patch,
	};
	saveState(state, cwd);
}

function seedProjectName(name = "Demo"): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "velpari", "files.json"),
		JSON.stringify({
			version: 4,
			projectName: name,
			codePaths: ["src/"],
			testPaths: ["test/"],
			docPaths: ["Doc/"],
			excludedPaths: [],
		}),
	);
}

function seedPublishedPRD(name = "Demo"): void {
	mkdirSync(join(cwd, "Doc", "requirements"), { recursive: true });
	writeFileSync(join(cwd, "Doc", "requirements", `PRD_${name}.md`), "# PRD\n\n## Functional Requirements");
}

function seedPublishedDesign(name = "Demo"): void {
	mkdirSync(join(cwd, "Doc", "design"), { recursive: true });
	writeFileSync(join(cwd, "Doc", "design", `design_${name}.md`), "# Design\n");
}

function makeCtx(): { ctx: Ctx; pi: Api } {
	notices = [];
	sentMessages = [];
	// Build a minimal ExtensionCommandContext with just the surface the
	// handler touches (ctx.ui.notify + ctx.ui.setStatus + ctx.ui.confirm).
	const uiMock = {
		notify: (msg: string, level: string) => {
			notices.push({ msg, level });
		},
		setStatus: () => {},
		confirm: async () => true,
	};
	const ctx = { ui: uiMock } as unknown as Ctx;
	const pi: Api = {
		flags: {},
		sendUserMessage: (prompt: string) => {
			sentMessages.push(prompt);
		},
		appendEntry: () => {},
	} as unknown as Api;
	return { ctx, pi };
}

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "vp-handler-"));
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	// Snapshot + clear the WHOLE mux env set so the machine's real
	// multiplexer (tmux/zellij/wezterm/cmux) can never leak into a test.
	savedMuxEnv = {};
	for (const k of MUX_ENV_KEYS) {
		savedMuxEnv[k] = process.env[k];
		delete process.env[k];
	}
	prevPiSubagentMux = savedMuxEnv.PI_SUBAGENT_MUX;
	// Default: bypass the multiplexer gate so the happy-path tests don't
	// need a real terminal multiplexer in CI. The dedicated "no mux" test
	// unsets it.
	process.env.PI_SUBAGENT_MUX = "1";
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
	for (const k of MUX_ENV_KEYS) {
		const v = savedMuxEnv[k];
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe("handleDesignLogging — gates", () => {
	it("refuses when no active run", async () => {
		// state.json absent → runId="" → currentStage="none"
		const ctx = makeCtx();
		await handleDesignLogging(ctx.ctx, ctx.pi, cwd);
		const error = notices.find((n) => n.level === "error");
		assert.ok(error, "should emit an error notify");
		assert.ok(error!.msg.includes("No active run"));
		assert.strictEqual(sentMessages.length, 0);
	});

	it("refuses when projectName is missing", async () => {
		seedState();
		// No files.json
		const ctx = makeCtx();
		await handleDesignLogging(ctx.ctx, ctx.pi, cwd);
		const error = notices.find((n) => n.level === "error");
		assert.ok(error);
		assert.ok(error!.msg.includes("Project name not set"));
		assert.strictEqual(sentMessages.length, 0);
	});

	it("refuses when stage is before designed", async () => {
		seedState({ currentStage: "drafted-prd" });
		seedProjectName();
		const ctx = makeCtx();
		await handleDesignLogging(ctx.ctx, ctx.pi, cwd);
		const error = notices.find((n) => n.level === "error");
		assert.ok(error);
		assert.ok(error!.msg.includes("Design must be approved first"));
	});

	it("refuses when PRD is missing", async () => {
		seedState();
		seedProjectName();
		// No PRD published
		const ctx = makeCtx();
		await handleDesignLogging(ctx.ctx, ctx.pi, cwd);
		const error = notices.find((n) => n.level === "error");
		assert.ok(error);
		assert.ok(error!.msg.includes("PRD not found"));
	});

	it("refuses when design is missing", async () => {
		seedState();
		seedProjectName();
		seedPublishedPRD();
		// No design
		const ctx = makeCtx();
		await handleDesignLogging(ctx.ctx, ctx.pi, cwd);
		const error = notices.find((n) => n.level === "error");
		assert.ok(error);
		assert.ok(error!.msg.includes("Design not found"));
	});
});

describe("handleDesignLogging — multiplexer gate", () => {
	it("refuses when no multiplexer and no PI_SUBAGENT_MUX override", async () => {
		delete process.env.PI_SUBAGENT_MUX;
		seedState();
		seedProjectName();
		seedPublishedPRD();
		seedPublishedDesign();
		const ctx = makeCtx();
		await handleDesignLogging(ctx.ctx, ctx.pi, cwd);
		const error = notices.find((n) => n.level === "error");
		// beforeEach cleared every mux env var, so this is env-independent:
		// the multiplexer gate (ops/design-logging.ts) must be the refuser.
		assert.ok(error, "expected an error notify when multiplexer is missing");
		assert.ok(
			error!.msg.includes("requires a multiplexer"),
			`expected the multiplexer-gate message, got: ${error!.msg}`,
		);
		assert.strictEqual(sentMessages.length, 0);
	});
});

describe("handleDesignLogging — happy path", () => {
	it("emits the 3-scout names in the notify when all gates pass", async () => {
		seedState();
		seedProjectName("HappyApp");
		seedPublishedPRD("HappyApp");
		seedPublishedDesign("HappyApp");
		const ctx = makeCtx();
		await handleDesignLogging(ctx.ctx, ctx.pi, cwd);
		const info = notices.find((n) => n.level === "info");
		assert.ok(info);
		assert.ok(info!.msg.includes("logging-standards-researcher"));
		assert.ok(info!.msg.includes("logging-architecture-designer"));
		assert.ok(info!.msg.includes("logging-compliance-mapper"));
		assert.ok(info!.msg.includes("Working copy target:"));
		assert.ok(info!.msg.includes("Published target:"));
		// Should have sent exactly one prompt to the parent LLM
		assert.strictEqual(sentMessages.length, 1);
		// The prompt should reference the 3 scouts + the input artifact paths
		assert.ok(sentMessages[0]!.includes("logging-standards-researcher-report.json"));
	});

	it("update mode: when a published logging plan exists, the prompt notes it", async () => {
		seedState();
		seedProjectName("UpdateApp");
		seedPublishedPRD("UpdateApp");
		seedPublishedDesign("UpdateApp");
		// Pre-publish a logging plan so the handler detects update mode
		mkdirSync(join(cwd, "Doc", "observability"), { recursive: true });
		writeFileSync(
			join(cwd, "Doc", "observability", "logging-plan_UpdateApp.md"),
			"---\nartifact: logging-plan\nproject: UpdateApp\nversion: 1.0.0\nstatus: approved\n---\n\n## 1. Logging Objectives & Scope\n\nbody\n",
		);
		const ctx = makeCtx();
		await handleDesignLogging(ctx.ctx, ctx.pi, cwd);
		const info = notices.find((n) => n.level === "info");
		assert.ok(info);
		assert.ok(info!.msg.includes("Update mode: revising"));
		// And the prompt should include the update-mode block
		assert.ok(sentMessages[0]!.includes("## Update Mode"));
	});
});
