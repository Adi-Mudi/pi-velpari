/**
 * /velpari-rtm handler.
 *
 * Flow:
 * 1. Read Doc/PRD_<projectName>.md (gate check)
 * 2. Read projectName from .pi/velpari/files.json
 * 3. Compose prompt with stage skill + framework + PRD content
 * 4. Send prompt via ctx; LLM responds with RTM table
 * 5. Write working copy to .IDE_Plans/velpari/runs/<run-id>/rtm/RTM_<projectName>.md
 * 6. Render preview + ask user to confirm
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig, validateFilesConfig } from "./config.js";
import { buildRunDir, buildOutputPath } from "./paths.js";
import { loadState } from "./state.js";

export async function handleRtm(ctx: ExtensionCommandContext, cwd: string = process.cwd()): Promise<void> {
	// 1. Read projectName
	const config = loadFilesConfig(cwd);
	if (!validateFilesConfig(config)) {
		ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
		return;
	}
	const projectName = config.projectName;

	// 2. Gate check: PRD must exist
	const state = loadState(cwd);
	if (!state.runId) {
		ctx.ui.notify("No active run. Run /velpari-discuss first.", "error");
		return;
	}

	const prdPath = join(cwd, buildOutputPath("PRD", projectName));
	if (!existsSync(prdPath)) {
		ctx.ui.notify(`PRD not found at ${prdPath}. Run /velpari-prd first.`, "error");
		return;
	}

	// 3. Build working-copy dir
	const runDir = buildRunDir(state.runId, cwd);
	const rtmDir = join(runDir, "rtm");
	mkdirSync(rtmDir, { recursive: true });

	// 4. Compose RTM content (Phase B stub)
	const rtmContent = renderRtmStub(projectName);

	// 5. Write working copy
	const workingPath = join(rtmDir, `RTM_${projectName}.md`);
	writeFileSync(workingPath, rtmContent, "utf8");

	// 6. Preview gate
	const targetPath = buildOutputPath("RTM", projectName);
	const confirmed = await ctx.ui.confirm(
		"Publish RTM?",
		`Working copy written to ${workingPath}. Publish to ${targetPath}?`,
	);
	if (confirmed) {
		ctx.ui.notify("RTM drafted. Run /velpari-approve to publish.", "info");
	}
}

function renderRtmStub(projectName: string): string {
	return [
		`# Requirements Traceability Matrix — ${projectName}`,
		``,
		`| Req ID | Description | Design Element | Implementation / Helper Function | Test Case(s) | Status |`,
		`| --- | --- | --- | --- | --- | --- |`,
		`| FR-01 | (stub) | (stub) | (stub) | (stub) | approved |`,
		``,
		`_Phase B stub. Real RTM rows derive from PRD FR-Ns._`,
		``,
	].join("\n");
}
