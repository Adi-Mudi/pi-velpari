/**
 * Multiplexer hard-gate integration tests for /velpari-brainstorm (v2.1).
 *
 * Asserts:
 *   - When PI_SUBAGENT_MUX is set, handler proceeds past the gate
 *   - When no mux env vars are set, handler hits the gate, emits the
 *     required message, and returns BEFORE creating any state.json or run
 *     directory (no orphan runs)
 *   - The TMUX env var alone is enough to pass the gate
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleBrainstorm } from "../../src/stages/brainstorm/index.js";
import { loadState } from "../../src/core/state.js";

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

function setMux(
	envKey: "PI_SUBAGENT_MUX" | "TMUX" | "ZELLIJ_PANE_ID" | "WEZTERM_PANE" | "CMUX_PANE_ID",
	value: string,
) {
	// Clear all mux signals first, then set the one we want.
	delete process.env.PI_SUBAGENT_MUX;
	delete process.env.TMUX;
	delete process.env.ZELLIJ_PANE_ID;
	delete process.env.ZELLIJ_SESSION_NAME;
	delete process.env.WEZTERM_PANE;
	delete process.env.WEZTERM_EXECUTABLE;
	delete process.env.CMUX_PANE_ID;
	delete process.env.CMUX_SESSION_NAME;
	process.env[envKey] = value;
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

let tmpDir: string;
let harness: Harness;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-mux-gate-"));
	harness = makeHarness();
});

afterEach(() => {
	harness.restoreEnv();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("/velpari-brainstorm multiplexer gate (v2.1)", () => {
	it("proceeds past the gate when PI_SUBAGENT_MUX is set", async () => {
		setMux("PI_SUBAGENT_MUX", "zellij");

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		// No "multiplexer" error was emitted
		const muxErrors = harness.notices.filter((n) => n.level === "error" && /multiplexer/i.test(n.message));
		assert.equal(muxErrors.length, 0, "no multiplexer error should be emitted when override is set");

		// Handler proceeded to sendUserMessage (parent LLM now drives the lifecycle)
		assert.equal(harness.userMessages.length, 1, "parent LLM prompt should be sent");

		// State file was created (createRun ran)
		assert.ok(existsSync(join(tmpDir, ".pi", "velpari", "state.json")), "state.json must exist after handler proceeds");
	});

	it("proceeds past the gate when TMUX env var is set", async () => {
		setMux("TMUX", "/tmp/tmux-1000/default,12345,0");

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const muxErrors = harness.notices.filter((n) => n.level === "error" && /multiplexer/i.test(n.message));
		assert.equal(muxErrors.length, 0);
		assert.equal(harness.userMessages.length, 1);
		assert.ok(existsSync(join(tmpDir, ".pi", "velpari", "state.json")));
	});

	it("proceeds past the gate when ZELLIJ_PANE_ID is set", async () => {
		setMux("ZELLIJ_PANE_ID", "42");

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const muxErrors = harness.notices.filter((n) => n.level === "error" && /multiplexer/i.test(n.message));
		assert.equal(muxErrors.length, 0);
		assert.equal(harness.userMessages.length, 1);
	});

	it("proceeds past the gate when WEZTERM_PANE is set", async () => {
		setMux("WEZTERM_PANE", "0");

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const muxErrors = harness.notices.filter((n) => n.level === "error" && /multiplexer/i.test(n.message));
		assert.equal(muxErrors.length, 0);
		assert.equal(harness.userMessages.length, 1);
	});

	it("proceeds past the gate when CMUX_PANE_ID is set", async () => {
		setMux("CMUX_PANE_ID", "7");

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		const muxErrors = harness.notices.filter((n) => n.level === "error" && /multiplexer/i.test(n.message));
		assert.equal(muxErrors.length, 0);
		assert.equal(harness.userMessages.length, 1);
	});

	it("HITS the gate when no mux env vars are set — emits error and returns early", async () => {
		clearAllMux();

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		// Exactly one error notice was emitted, with the required message
		const errorNotices = harness.notices.filter((n) => n.level === "error");
		assert.equal(errorNotices.length, 1, "exactly one error notice must be emitted");
		const msg = errorNotices[0]!.message;
		assert.match(msg, /multiplexer/i);
		assert.match(msg, /zellij/);
		assert.match(msg, /tmux/);
		assert.match(msg, /wezterm/);
		assert.match(msg, /cmux/);
		assert.match(msg, /PI_SUBAGENT_MUX/);

		// Parent LLM prompt was NOT sent (gate stopped the flow)
		assert.equal(harness.userMessages.length, 0, "parent LLM prompt must NOT be sent when gate fails");

		// No state.json was created — no orphan run
		assert.equal(
			existsSync(join(tmpDir, ".pi", "velpari", "state.json")),
			false,
			"no state.json must be created when the gate fails",
		);

		// No run directory was created
		const runsDir = join(tmpDir, ".IDE_Plans", "velpari", "runs");
		assert.equal(existsSync(runsDir), false, "no runs/ directory must be created when the gate fails");
	});

	it("gate runs BEFORE seed-input guard (gate has priority)", async () => {
		// Empty mission with no mux: gate should fire first and the
		// seed-input guard should NOT be reached.
		clearAllMux();

		await handleBrainstorm("", harness.ctx, harness.pi, tmpDir);

		// Only the multiplexer error appears — not the seed-input error
		const errorMessages = harness.notices.filter((n) => n.level === "error").map((n) => n.message);
		assert.equal(errorMessages.length, 1, "exactly one error notice");
		assert.match(errorMessages[0]!, /multiplexer/i);
	});

	it("gate runs BEFORE loadState/createRun (no orphan state)", async () => {
		clearAllMux();

		await handleBrainstorm("test-mission", harness.ctx, harness.pi, tmpDir);

		// loadState is called only inside the handler AFTER the gate. With
		// the gate active, calling loadState outside the handler (here)
		// must return the "no state" default — proves the handler didn't
		// reach createRun.
		const state = loadState(tmpDir);
		assert.equal(state.currentStage, "none", "no run must have been created");
	});
});
