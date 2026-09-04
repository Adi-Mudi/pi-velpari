/**
 * /velpari-design handler (v2.0 / Phase 4 of all-stages refactor).
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
import { loadFilesConfig } from "../src/config.js";
import { buildOutputPath, buildRunDir } from "../src/paths.js";
import { loadState } from "../src/state.js";
import { runStageWithScouts, type StageRunConfig } from "../src/stage-runner.js";

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

	// 2. Gate check: published feasibility study must exist.
	const inputArtifactPath = join(cwd, buildOutputPath("feasibility-study", projectName));

	// 3. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const designDir = join(runDir, "design");
	const scoutsDir = join(designDir, "scouts");
	const workingCopyPath = join(designDir, `design_${projectName}.md`);

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
		workingCopyDir: designDir,
		workingCopyPath,
		scoutsDir,
		cwd,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}