/**
 * /velpari-pseudocode handler (Phase 7 update).
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

	const resolved = resolveDocArtifact("design", projectName, cwd);
	if (!resolved) {
		ctx.ui.notify(
			`Cannot read design for ${projectName}: not found at Doc/design/design_${projectName}.md or Doc/design_${projectName}.md. ` +
				`Run /velpari-design and /velpari-approve first.`,
			"error",
		);
		return;
	}
	const inputArtifactPath = resolved.path;

	const runDir = buildRunDir(state.runId, cwd);
	const pseudoWorkingDir = join(runDir, "pseudocode");
	const scoutsDir = join(pseudoWorkingDir, "scouts");
	const workingCopyPath = buildWorkingGroupedPath(cwd, state.runId, "pseudocode", projectName);

	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

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
		workingCopyDir: pseudoWorkingDir,
		workingCopyPath,
		scoutsDir,
		cwd,
		profileMetadata,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}