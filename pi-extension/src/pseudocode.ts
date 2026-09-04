/**
 * /velpari-pseudocode handler (v2.0 / Phase 4 of all-stages refactor).
 *
 * Two-phase flow:
 *   1. Handler: gate check + bootstrap agents + build prompt + hand off via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-pseudocode.md): spawn 4 subagents
 *      (pseudo-algorithm-extractor, pseudo-edge-case-handler,
 *      pseudo-complexity-analyzer, pseudo-consolidator) in parallel, write
 *      pseudocode_<project>.md, show preview gate.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../src/config.js";
import { buildOutputPath, buildRunDir } from "../src/paths.js";
import { loadState } from "../src/state.js";
import { runStageWithScouts, type StageRunConfig } from "../src/stage-runner.js";

const PSEUDO_SCOUTS = [
	{ name: "pseudo-algorithm-extractor" },
	{ name: "pseudo-edge-case-handler" },
	{ name: "pseudo-complexity-analyzer" },
	{ name: "pseudo-consolidator" },
] as const;

export async function handlePseudocode(
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

	// 2. Gate check: published design must exist.
	const inputArtifactPath = join(cwd, buildOutputPath("design", projectName));

	// 3. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const pseudoDir = join(runDir, "pseudocode");
	const scoutsDir = join(pseudoDir, "scouts");
	const workingCopyPath = join(pseudoDir, `pseudocode_${projectName}.md`);

	const stageConfig: StageRunConfig = {
		stage: "writing-pseudocode",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: PSEUDO_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath,
		workingCopyDir: pseudoDir,
		workingCopyPath,
		scoutsDir,
		cwd,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}