/**
 * /velpari-rtm handler (v2.0 / Phase 3 of all-stages refactor).
 *
 * Two-phase flow (matches discuss/prd pattern at a25e975 / 4f68d05):
 *   1. Handler: gate check + bootstrap agents + build prompt + hand off via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-rtm.md): spawn 4 subagents
 *      (rtm-requirement-tracer, rtm-test-case-linker, rtm-coverage-analyzer,
 *      rtm-consolidator) in parallel, write RTM_<project>.md, show preview gate.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../src/config.js";
import { buildOutputPath, buildRunDir } from "../src/paths.js";
import { loadState } from "../src/state.js";
import { runStageWithScouts, type StageRunConfig } from "../src/stage-runner.js";

const RTM_SCOUTS = [
	{ name: "rtm-requirement-tracer" },
	{ name: "rtm-test-case-linker" },
	{ name: "rtm-coverage-analyzer" },
	{ name: "rtm-consolidator" },
] as const;

export async function handleRtm(
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

	// 2. Gate check: published PRD must exist.
	const inputArtifactPath = join(cwd, buildOutputPath("PRD", projectName));

	// 3. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const rtmDir = join(runDir, "rtm");
	const scoutsDir = join(rtmDir, "scouts");
	const workingCopyPath = join(rtmDir, `RTM_${projectName}.md`);

	const stageConfig: StageRunConfig = {
		stage: "building-rtm",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: RTM_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath,
		workingCopyDir: rtmDir,
		workingCopyPath,
		scoutsDir,
		cwd,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}