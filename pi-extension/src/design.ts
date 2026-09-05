/**
 * /velpari-design handler (Phase 7 update).
 *
 * Two-phase flow:
 *   1. Handler: gate check + bootstrap agents + build prompt + hand off via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-design.md): spawn 4 subagents
 *      (design-module-decomposer, design-contract-definer,
 *      design-data-flow-mapper, design-error-definer) in parallel, write
 *      design_<project>.md, show preview gate.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "./config.js";
import { loadState } from "./state.js";
import {
	buildRunDir,
	buildWorkingGroupedPath,
	resolveDocArtifact,
} from "./paths.js";
import {
	compactProfileMetadata,
	loadRequirementsProfile,
} from "./requirements-profile.js";
import { runStageWithScouts, type StageRunConfig } from "./stage-runner.js";

const DESIGN_SCOUTS = [
	{ name: "design-module-decomposer" },
	{ name: "design-contract-definer" },
	{ name: "design-data-flow-mapper" },
	{ name: "design-error-definer" },
] as const;

export async function handleDesign(
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

	const resolved = resolveDocArtifact("feasibility-study", projectName, cwd);
	if (!resolved) {
		ctx.ui.notify(
			`Cannot read feasibility-study for ${projectName}: not found at Doc/feasibility/feasibility-study_${projectName}.md or Doc/feasibility-study_${projectName}.md. ` +
				`Run /velpari-feasibility and /velpari-approve first.`,
			"error",
		);
		return;
	}
	const inputArtifactPath = resolved.path;

	const runDir = buildRunDir(state.runId, cwd);
	const designWorkingDir = join(runDir, "design");
	const scoutsDir = join(designWorkingDir, "scouts");
	const workingCopyPath = buildWorkingGroupedPath(cwd, state.runId, "design", projectName);

	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

	const stageConfig: StageRunConfig = {
		stage: "designing",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: DESIGN_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath,
		workingCopyDir: designWorkingDir,
		workingCopyPath,
		scoutsDir,
		cwd,
		profileMetadata,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}