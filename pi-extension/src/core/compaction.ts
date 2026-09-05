import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadState } from "./state.js";
import { PATHS } from "./constants.js";

/**
 * Build a zero-LLM summary of the current Velpari run state. Used by the
 * `session_before_compact` hook (NFR-01). Pure deterministic — reads state.json
 * from disk and produces a markdown string.
 */
export function buildCompactionSummary(cwd: string = process.cwd()): string {
	const statePath = join(cwd, PATHS.STATE_FILE);
	if (!existsSync(statePath)) {
		return "No active Velpari run.";
	}

	try {
		const state = loadState(cwd);
		if (state.currentStage === "none") {
			return "No active Velpari run.";
		}
		const lines: string[] = [
			`# Velpari run ${state.runId}`,
			``,
			`Mission: ${state.mission || "(none)"}`,
			`Current stage: ${state.currentStage}`,
			`Updated: ${state.updatedAt || "(unknown)"}`,
			``,
			`History:`,
			...state.history.map((h) => `- ${h.timestamp} — ${h.command} → ${h.stage}`),
		];
		return lines.join("\n");
	} catch (err) {
		// Phase A: defensive — never let compaction throw.
		void err;
		void readFileSync; // keep import live for later phases
		return "Velpari state unreadable; compaction skipped.";
	}
}
