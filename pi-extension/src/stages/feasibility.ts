/**
 * /velpari-feasibility handler (Phase 7 update).
 *
 * Two-phase flow:
 *   1. Handler: gate check + bootstrap agents + build prompt + hand off via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-feasibility.md): spawn 4 subagents
 *      (feasibility-tech, feasibility-schedule, feasibility-cost, feasibility-risk)
 *      in parallel, write feasibility-study_<project>.md, show preview gate.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../core/config.js";
import { loadState } from "../core/state.js";
import {
	buildRunDir,
	buildWorkingGroupedPath,
	resolveDocArtifact,
} from "../core/paths.js";
import {
	compactProfileMetadata,
	loadRequirementsProfile,
} from "../core/requirements-profile.js";
import { runStageWithScouts, type StageRunConfig } from "../core/stage-runner.js";

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

	const resolved = resolveDocArtifact("RTM", projectName, cwd);
	if (!resolved) {
		ctx.ui.notify(
			`Cannot read RTM for ${projectName}: not found at Doc/requirements/RTM_${projectName}.md or Doc/RTM_${projectName}.md. ` +
				`Run /velpari-rtm and /velpari-approve first.`,
			"error",
		);
		return;
	}
	const inputArtifactPath = resolved.path;

	const runDir = buildRunDir(state.runId, cwd);
	const feasWorkingDir = join(runDir, "feasibility");
	const scoutsDir = join(feasWorkingDir, "scouts");
	const workingCopyPath = buildWorkingGroupedPath(cwd, state.runId, "feasibility-study", projectName);

	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

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
		workingCopyDir: feasWorkingDir,
		workingCopyPath,
		scoutsDir,
		cwd,
		profileMetadata,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}