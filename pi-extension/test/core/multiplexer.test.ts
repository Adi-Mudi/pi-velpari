/**
 * Multiplexer detection tests (v2.1 lifecycle upgrade).
 *
 * Covers:
 *   - Each supported mux is detected via its primary env var
 *   - Zellij secondary env var fallback
 *   - Wezterm and cmux env var detection
 *   - Herdr env var detection (HERDR_ENV primary, HERDR_PANE_ID secondary)
 *   - PI_SUBAGENT_MUX override beats every other signal
 *   - "unknown" when no mux env vars are set
 *   - isSupportedMux returns false only for "unknown"
 *   - multiplexerRequiredMessage lists all supported muxes
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	detectMultiplexer,
	isSupportedMux,
	multiplexerRequiredMessage,
	SUPPORTED_MULTIPLEXERS,
	type MultiplexerInfo,
} from "../../src/core/multiplexer.js";

/**
 * Build a process env with all mux-related vars cleared, then apply overrides.
 * @param {Record<string, string | undefined>} overrides - Env vars to set (undefined clears them)
 * @returns {NodeJS.ProcessEnv} Env suitable for detectMultiplexer
 */
function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
	const base: Record<string, string | undefined> = {
		TMUX: undefined,
		ZELLIJ_PANE_ID: undefined,
		ZELLIJ_SESSION_NAME: undefined,
		WEZTERM_PANE: undefined,
		WEZTERM_EXECUTABLE: undefined,
		CMUX_PANE_ID: undefined,
		CMUX_SESSION_NAME: undefined,
		HERDR_ENV: undefined,
		HERDR_PANE_ID: undefined,
		PI_SUBAGENT_MUX: undefined,
	};
	for (const [k, v] of Object.entries(overrides)) base[k] = v;
	return base as NodeJS.ProcessEnv;
}

describe("detectMultiplexer", () => {
	it("detects tmux via TMUX env var", () => {
		const info = detectMultiplexer(env({ TMUX: "/tmp/tmux-1000/default,12345,0" }));
		assert.equal(info.mux, "tmux");
		assert.equal(info.source, "TMUX");
		assert.ok(isSupportedMux(info));
	});

	it("detects zellij via ZELLIJ_PANE_ID", () => {
		const info = detectMultiplexer(env({ ZELLIJ_PANE_ID: "42" }));
		assert.equal(info.mux, "zellij");
		assert.equal(info.source, "ZELLIJ_PANE_ID");
	});

	it("detects zellij via ZELLIJ_SESSION_NAME when ZELLIJ_PANE_ID absent", () => {
		const info = detectMultiplexer(env({ ZELLIJ_SESSION_NAME: "main" }));
		assert.equal(info.mux, "zellij");
		assert.equal(info.source, "ZELLIJ_SESSION_NAME");
	});

	it("detects wezterm via WEZTERM_PANE", () => {
		const info = detectMultiplexer(env({ WEZTERM_PANE: "0" }));
		assert.equal(info.mux, "wezterm");
		assert.equal(info.source, "WEZTERM_PANE");
	});

	it("detects wezterm via WEZTERM_EXECUTABLE when WEZTERM_PANE absent", () => {
		const info = detectMultiplexer(env({ WEZTERM_EXECUTABLE: "/usr/bin/wezterm" }));
		assert.equal(info.mux, "wezterm");
		assert.equal(info.source, "WEZTERM_EXECUTABLE");
	});

	it("detects cmux via CMUX_PANE_ID", () => {
		const info = detectMultiplexer(env({ CMUX_PANE_ID: "7" }));
		assert.equal(info.mux, "cmux");
		assert.equal(info.source, "CMUX_PANE_ID");
	});

	it("detects cmux via CMUX_SESSION_NAME when CMUX_PANE_ID absent", () => {
		const info = detectMultiplexer(env({ CMUX_SESSION_NAME: "s1" }));
		assert.equal(info.mux, "cmux");
		assert.equal(info.source, "CMUX_SESSION_NAME");
	});

	it("detects herdr via HERDR_ENV=1", () => {
		const info = detectMultiplexer(env({ HERDR_ENV: "1" }));
		assert.equal(info.mux, "herdr");
		assert.equal(info.source, "HERDR_ENV");
		assert.ok(isSupportedMux(info));
	});

	it("detects herdr via HERDR_PANE_ID when present", () => {
		const info = detectMultiplexer(env({ HERDR_PANE_ID: "p1" }));
		assert.equal(info.mux, "herdr");
		assert.equal(info.source, "HERDR_PANE_ID");
	});

	it("prefers HERDR_PANE_ID as source when both herdr vars are set", () => {
		const info = detectMultiplexer(env({ HERDR_ENV: "1", HERDR_PANE_ID: "p1" }));
		assert.equal(info.mux, "herdr");
		assert.equal(info.source, "HERDR_PANE_ID");
	});

	it("PI_SUBAGENT_MUX override with 'herdr' is honored", () => {
		const info = detectMultiplexer(env({ PI_SUBAGENT_MUX: "herdr", TMUX: "x" }));
		assert.equal(info.mux, "herdr");
		assert.equal(info.source, "PI_SUBAGENT_MUX");
	});

	it("tmux wins over herdr when both TMUX and HERDR_ENV are set (herdr check is last)", () => {
		const info = detectMultiplexer(env({ TMUX: "/tmp/tmux-1000/default,12345,0", HERDR_ENV: "1" }));
		assert.equal(info.mux, "tmux");
		assert.equal(info.source, "TMUX");
	});

	it("returns 'unknown' when no mux env vars are set", () => {
		const info = detectMultiplexer(env({}));
		assert.equal(info.mux, "unknown");
		assert.equal(isSupportedMux(info), false);
	});

	it("PI_SUBAGENT_MUX override beats every other signal", () => {
		const info = detectMultiplexer(
			env({
				PI_SUBAGENT_MUX: "zellij",
				TMUX: "/tmp/tmux-1000/default,12345,0",
				ZELLIJ_PANE_ID: "1",
				WEZTERM_PANE: "0",
				CMUX_PANE_ID: "0",
			}),
		);
		assert.equal(info.mux, "zellij");
		assert.equal(info.source, "PI_SUBAGENT_MUX");
	});

	it("PI_SUBAGENT_MUX override with unsupported value falls through to env sniff", () => {
		const info = detectMultiplexer(env({ PI_SUBAGENT_MUX: "bogus", TMUX: "/tmp/tmux-1000/default,12345,0" }));
		assert.equal(info.mux, "tmux");
		assert.equal(info.source, "TMUX");
	});

	it("PI_SUBAGENT_MUX override with 'cmux' is honored", () => {
		const info = detectMultiplexer(env({ PI_SUBAGENT_MUX: "cmux" }));
		assert.equal(info.mux, "cmux");
		assert.equal(info.source, "PI_SUBAGENT_MUX");
	});

	it("PI_SUBAGENT_MUX override with 'wezterm' is honored", () => {
		const info = detectMultiplexer(env({ PI_SUBAGENT_MUX: "wezterm" }));
		assert.equal(info.mux, "wezterm");
		assert.equal(info.source, "PI_SUBAGENT_MUX");
	});

	it("default export from doctor module matches L0 implementation", () => {
		// The doctor module re-exports detectMultiplexer from L0. Same env
		// must produce the same result regardless of import path.
		const info = detectMultiplexer(env({ TMUX: "x" }));
		assert.equal(info.mux, "tmux");
	});
});

describe("isSupportedMux", () => {
	const cases: Array<[MultiplexerInfo, boolean]> = [
		[{ mux: "tmux", source: "TMUX" }, true],
		[{ mux: "zellij", source: "ZELLIJ_PANE_ID" }, true],
		[{ mux: "wezterm", source: "WEZTERM_PANE" }, true],
		[{ mux: "cmux", source: "CMUX_PANE_ID" }, true],
		[{ mux: "herdr", source: "HERDR_ENV" }, true],
		[{ mux: "unknown", source: "(none)" }, false],
	];
	for (const [info, expected] of cases) {
		it(`returns ${expected} for mux=${info.mux}`, () => {
			assert.equal(isSupportedMux(info), expected);
		});
	}
});

describe("SUPPORTED_MULTIPLEXERS", () => {
	it("lists exactly the five supported muxes", () => {
		assert.deepEqual([...SUPPORTED_MULTIPLEXERS], ["zellij", "tmux", "wezterm", "cmux", "herdr"]);
	});

	it("does not include 'unknown'", () => {
		assert.equal(SUPPORTED_MULTIPLEXERS.includes("unknown"), false);
	});
});

describe("multiplexerRequiredMessage", () => {
	it("lists every supported mux in the message body", () => {
		const msg = multiplexerRequiredMessage();
		assert.match(msg, /zellij/);
		assert.match(msg, /tmux/);
		assert.match(msg, /wezterm/);
		assert.match(msg, /cmux/);
		assert.match(msg, /herdr/);
	});

	it("mentions the PI_SUBAGENT_MUX override env var", () => {
		const msg = multiplexerRequiredMessage();
		assert.match(msg, /PI_SUBAGENT_MUX/);
	});

	it("tells the developer to run inside a multiplexer", () => {
		const msg = multiplexerRequiredMessage();
		assert.match(msg, /multiplexer pane/i);
	});
});
