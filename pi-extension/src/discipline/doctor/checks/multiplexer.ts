/**
 * Multiplexer detection check.
 *
 * Required for `/velpari-discuss v2.0` because the parent LLM spawns 4
 * visible subagents in multiplexer panes. Detects cmux / tmux / zellij /
 * wezterm / unknown by sniffing env vars, and looks up the
 * pi-interactive-subagents peer dep version.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type MultiplexerKind = "cmux" | "tmux" | "zellij" | "wezterm" | "unknown";

export interface MultiplexerInfo {
	mux: MultiplexerKind;
	source: string;
}

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
		return { mux: "zellij", source: env.ZELLIJ_PANE_ID ? "ZELLIJ_PANE_ID" : "ZELLIJ_SESSION_NAME" };
	}
	if (env.WEZTERM_PANE || env.WEZTERM_EXECUTABLE) {
		return { mux: "wezterm", source: env.WEZTERM_PANE ? "WEZTERM_PANE" : "WEZTERM_EXECUTABLE" };
	}
	if (env.CMUX_PANE_ID || env.CMUX_SESSION_NAME) {
		return { mux: "cmux", source: env.CMUX_PANE_ID ? "CMUX_PANE_ID" : "CMUX_SESSION_NAME" };
	}
	return { mux: "unknown", source: "(none — no multiplexer env vars detected)" };
}

/**
 * Best-effort lookup for the pi-interactive-subagents package version.
 * Searches the most common install locations.
 */
export function detectInteractiveSubagentsVersion(cwd: string = process.cwd()): string | undefined {
	const candidates = [
		join(cwd, "node_modules", "@earendil-works", "pi-interactive-subagents", "package.json"),
		join(cwd, "..", "node_modules", "@earendil-works", "pi-interactive-subagents", "package.json"),
		join(cwd, "..", "..", "node_modules", "@earendil-works", "pi-interactive-subagents", "package.json"),
		join(homedir(), ".pi", "agent", "extensions", "pi-interactive-subagents", "package.json"),
	];
	for (const candidate of candidates) {
		try {
			if (existsSync(candidate)) {
				const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
				if (pkg.version) return pkg.version;
			}
		} catch {
			// ignore parse errors
		}
	}
	return undefined;
}
