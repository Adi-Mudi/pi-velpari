/**
 * /velpari-rtm handler (Phase 7 — Requirements Factory).
 *
 * Two-phase flow (matches discuss/prd pattern at a25e975 / 4f68d05):
 *   1. Handler: gate check + bootstrap agents + build prompt + hand off via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-rtm.md): spawn 4 subagents
 *      (rtm-requirement-tracer, rtm-test-case-linker, rtm-coverage-analyzer,
 *      rtm-consolidator) in parallel, write RTM_<project>.md, show preview gate.
 *
 * The RTM remains a separate document (Velpari Requirements Factory
 * design §6). It reads the published PSRS first, preferring the
 * grouped Doc/ layout and falling back to the legacy flat path.
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

	// 2. Gate check: published PSRS must exist (grouped first, legacy fallback).
	const resolved = resolveDocArtifact("PRD", projectName, cwd);
	if (!resolved) {
		ctx.ui.notify(
			`Cannot read PSRS for ${projectName}: not found at Doc/requirements/PRD_${projectName}.md or Doc/PRD_${projectName}.md. ` +
				`Run /velpari-prd and /velpari-approve first.`,
			"error",
		);
		return;
	}
	const inputArtifactPath = resolved.path;

	// 3. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const rtmWorkingPath = buildWorkingGroupedPath(cwd, state.runId, "RTM", projectName);
	const rtmWorkingDir = join(runDir, "rtm");
	const scoutsDir = join(rtmWorkingDir, "scouts");
	const workingCopyPath = rtmWorkingPath;

	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

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
		workingCopyDir: rtmWorkingDir,
		workingCopyPath,
		scoutsDir,
		cwd,
		profileMetadata,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}