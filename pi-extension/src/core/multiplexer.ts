/**
 * Multiplexer detection — Layer 0 helper.
 *
 * Pure env-var sniffer with no I/O and no UI. Promoted from
 * `doctor/checks/multiplexer.ts` so L1 handlers (the brainstorm handler in
 * particular) can import it without violating the layer rule. The doctor
 * check now re-exports from here.
 *
 * Why a multiplexer is required:
 *   Velpari spawns visible scout subagents in multiplexer panes at the
 *   brainstorm SCAN step. Without a multiplexer, the parent LLM has
 *   nowhere to put the panes and scouts fail to spawn. Failing fast at
 *   brainstorm entry (before any state work) prevents orphan runs.
 *
 * Override:
 *   Set `PI_SUBAGENT_MUX` to one of the supported kinds to force a value
 *   (used by wrappers / tests).
 */

export type MultiplexerKind = "cmux" | "tmux" | "zellij" | "wezterm" | "unknown";

export interface MultiplexerInfo {
	mux: MultiplexerKind;
	source: string;
}

/** Multiplexers velpari explicitly supports. Order = display order in
 * error messages. */
export const SUPPORTED_MULTIPLEXERS: readonly MultiplexerKind[] = ["zellij", "tmux", "wezterm", "cmux"];

/**
 * Detect the active multiplexer by sniffing env vars.
 * `PI_SUBAGENT_MUX` overrides everything (lets a wrapper force a value).
 */
export function detectMultiplexer(env: NodeJS.ProcessEnv = process.env): MultiplexerInfo {
	const override = env.PI_SUBAGENT_MUX;
	if (override === "cmux" || override === "tmux" || override === "zellij" || override === "wezterm") {
		return { mux: override, source: "PI_SUBAGENT_MUX" };
	}
	if (env.TMUX) return { mux: "tmux", source: "TMUX" };
	if (env.ZELLIJ_PANE_ID || env.ZELLIJ_SESSION_NAME) {
		return {
			mux: "zellij",
			source: env.ZELLIJ_PANE_ID ? "ZELLIJ_PANE_ID" : "ZELLIJ_SESSION_NAME",
		};
	}
	if (env.WEZTERM_PANE || env.WEZTERM_EXECUTABLE) {
		return {
			mux: "wezterm",
			source: env.WEZTERM_PANE ? "WEZTERM_PANE" : "WEZTERM_EXECUTABLE",
		};
	}
	if (env.CMUX_PANE_ID || env.CMUX_SESSION_NAME) {
		return {
			mux: "cmux",
			source: env.CMUX_PANE_ID ? "CMUX_PANE_ID" : "CMUX_SESSION_NAME",
		};
	}
	return { mux: "unknown", source: "(none — no multiplexer env vars detected)" };
}

/** True when the detected multiplexer is one velpari supports. */
export function isSupportedMux(info: MultiplexerInfo): boolean {
	return info.mux !== "unknown";
}

/**
 * Build the user-facing error message when no multiplexer is detected.
 * Lists the supported muxes so the developer can pick one to run inside.
 */
export function multiplexerRequiredMessage(): string {
	const list = SUPPORTED_MULTIPLEXERS.join(" / ");
	return (
		"Velpari needs a multiplexer (" +
		list +
		") to spawn visible subagents.\n" +
		"Run this command inside a multiplexer pane and try again.\n" +
		"To override detection, set PI_SUBAGENT_MUX to one of: " +
		list +
		"."
	);
}
