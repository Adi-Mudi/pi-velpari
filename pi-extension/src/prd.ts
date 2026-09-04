/**
 * /velpari-prd handler (v2.0 / Phase 2 of all-stages refactor).
 *
 * Two-phase flow (matches the discuss pattern at commit a25e975):
 *   1. Handler (this file): gate check + bootstrap agents + build prompt
 *      + hand off via `pi.sendUserMessage(prompt)`.
 *   2. Parent LLM (driven by skills/velpari-prd.md): spawn 4 subagents
 *      (fr-extractor, nfr-checker, helper-detector, consolidator) in
 *      parallel, read their reports, write the working-copy PRD, show
 *      preview gate, tell user to run /velpari-approve.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../src/config.js";
import { buildRunDir, buildDiscussionPath, slugify } from "../src/paths.js";
import { loadState } from "../src/state.js";
import { runStageWithScouts, type StageRunConfig } from "../src/stage-runner.js";

const PRD_SCOUTS = [
	{ name: "fr-extractor" },
	{ name: "nfr-checker" },
	{ name: "helper-detector" },
	{ name: "consolidator" },
] as const;

export async function handlePrd(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	// 1. Load state + config.
	const state = loadState(cwd);
	if (!state.runId) {
		ctx.ui.notify("No active run. Run /velpari-discuss first.", "error");
		return;
	}
	const config = loadFilesConfig(cwd);
	if (!config.projectName) {
		ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
		return;
	}
	const projectName = config.projectName;

	// 2. Gate check: published discussion must exist.
	const topicSlug = slugify(state.mission);
	const inputArtifactPath = buildDiscussionPath(topicSlug);
	const fullInputPath = join(cwd, inputArtifactPath);

	// 3. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const prdDir = join(runDir, "prd");
	const scoutsDir = join(prdDir, "scouts");
	const workingCopyPath = join(prdDir, `PRD_${projectName}.md`);

	const stageConfig: StageRunConfig = {
		stage: "drafting-prd",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: PRD_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath: fullInputPath,
		workingCopyDir: prdDir,
		workingCopyPath,
		scoutsDir,
		cwd,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}