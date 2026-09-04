/**
 * /velpari-feasibility handler (v2.0 / Phase 3 of all-stages refactor).
 *
 * Two-phase flow (matches discuss/prd/rtm pattern):
 *   1. Handler: gate check + bootstrap agents + build prompt + hand off via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-feasibility.md): spawn 4 subagents
 *      (feasibility-tech, feasibility-schedule, feasibility-cost, feasibility-risk)
 *      in parallel, write feasibility-study_<project>.md, show preview gate.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../src/config.js";
import { buildOutputPath, buildRunDir } from "../src/paths.js";
import { loadState } from "../src/state.js";
import { runStageWithScouts, type StageRunConfig } from "../src/stage-runner.js";

const FEAS_SCOUTS = [
	{ name: "feasibility-tech" },
	{ name: "feasibility-schedule" },
	{ name: "feasibility-cost" },
	{ name: "feasibility-risk" },
] as const;

export async function handleFeasibility(
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

	// 2. Gate check: published RTM must exist.
	const inputArtifactPath = join(cwd, buildOutputPath("RTM", projectName));

	// 3. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const feasDir = join(runDir, "feasibility");
	const scoutsDir = join(feasDir, "scouts");
	const workingCopyPath = join(feasDir, `feasibility-study_${projectName}.md`);

	const stageConfig: StageRunConfig = {
		stage: "analyzing-feasibility",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: FEAS_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath,
		workingCopyDir: feasDir,
		workingCopyPath,
		scoutsDir,
		cwd,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}