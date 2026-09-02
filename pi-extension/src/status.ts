/**
 * /velpari-status handler (FR-09).
 *
 * Pure read-only. Loads the current run state and emits a formatted
 * summary via ctx.ui.notify. Never modifies state.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadState } from "./state.js";
import { PATHS } from "./constants.js";
import { buildOutputPath, slugify } from "./paths.js";

const MAX_NOTIFY_LENGTH = 8000;

export async function handleStatus(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const state = loadState(cwd);
	if (state.currentStage === "none") {
		ctx.ui.notify("No active Velpari run.", "info");
		return;
	}

	const lines: string[] = [
		`# Velpari run ${state.runId}`,
		``,
		`Mission: ${state.mission || "(none)"}`,
		`Current stage: ${state.currentStage}`,
		`Updated: ${state.updatedAt || "(unknown)"}`,
		``,
		`## History`,
		...state.history.map((h) => `- ${h.timestamp} — ${h.command} → ${h.stage}`),
		``,
		`## Published artifacts (Doc/)`,
	];

	// Check which Doc/ artifacts exist
	const docDir = join(cwd, "Doc");
	if (existsSync(docDir)) {
		const topicSlug = slugify(state.mission);
		const candidates = [
			`discussion-${topicSlug}.md`,
			"PRD_Mission.md", // placeholder; real path depends on projectName
		];
		for (const c of candidates) {
			if (existsSync(join(docDir, c))) {
				lines.push(`- ${c}`);
			}
		}
	}

	const summary = lines.join("\n");
	if (summary.length <= MAX_NOTIFY_LENGTH) {
		ctx.ui.notify(summary, "info");
	} else {
		// Reserve room for the truncation marker so the total emitted length
		// does not exceed MAX_NOTIFY_LENGTH.
		const TRUNCATION_MARKER = "\n... [truncated]";
		const truncated = summary.slice(0, MAX_NOTIFY_LENGTH - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
		ctx.ui.notify(truncated, "info");
	}

	void buildOutputPath;
	void PATHS;
}
