/**
 * /velpari-prd handler.
 *
 * Flow:
 * 1. Read Doc/discussion-<topic-slug>.md (gate check)
 * 2. Read projectName from .pi/velpari/files.json
 * 3. Compose prompt with stage skill + framework + discussion content
 * 4. Send prompt via ctx; LLM responds with PRD content
 * 5. Write working copy to .IDE_Plans/velpari/runs/<run-id>/prd/PRD_<projectName>.md
 * 6. Render preview + ask user to confirm
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig, validateFilesConfig } from "./config.js";
import { buildRunDir, buildOutputPath, slugify } from "./paths.js";
import { loadState } from "./state.js";

export async function handlePrd(ctx: ExtensionCommandContext, cwd: string = process.cwd()): Promise<void> {
	// 1. Read projectName
	const config = loadFilesConfig(cwd);
	if (!validateFilesConfig(config)) {
		ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
		return;
	}
	const projectName = config.projectName;

	// 2. Gate check: discussion must exist
	const state = loadState(cwd);
	if (!state.runId) {
		ctx.ui.notify("No active run. Run /velpari-discuss first.", "error");
		return;
	}

	// Try to find the discussion file (search by topic-slug from mission)
	const topicSlug = slugify(state.mission);
	const discussionPath = join(cwd, "Doc", `discussion-${topicSlug}.md`);
	if (!existsSync(discussionPath)) {
		ctx.ui.notify(`Discussion not found at ${discussionPath}. Run /velpari-discuss first.`, "error");
		return;
	}

	// 3. Build working-copy dir
	const runDir = buildRunDir(state.runId, cwd);
	const prdDir = join(runDir, "prd");
	mkdirSync(prdDir, { recursive: true });

	// 4. Compose PRD content (Phase B stub — real LLM call ships in Phase C)
	const prdContent = renderPrdStub(projectName, state.mission);

	// 5. Write working copy
	const workingPath = join(prdDir, `PRD_${projectName}.md`);
	writeFileSync(workingPath, prdContent, "utf8");

	// 6. Preview gate
	const targetPath = buildOutputPath("PRD", projectName);
	const confirmed = await ctx.ui.confirm(
		"Publish PRD?",
		`Working copy written to ${workingPath}. Publish to ${targetPath}?`,
	);
	if (confirmed) {
		ctx.ui.notify("PRD drafted. Run /velpari-approve to publish.", "info");
	}
}

function renderPrdStub(projectName: string, mission: string): string {
	return [
		`# Product Requirements Document — ${projectName}`,
		``,
		`## 1. Objective`,
		mission,
		``,
		`## 4. Key Features & Requirements`,
		``,
		`_Phase B stub. Real FR-Ns derive from discussion notes._`,
		``,
	].join("\n");
}
