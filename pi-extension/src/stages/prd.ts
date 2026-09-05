/**
 * /velpari-prd handler (Phase 7 — Requirements Factory).
 *
 * Two-phase flow (matches the discuss pattern at commit a25e975):
 *   1. Handler (this file): gate check + bootstrap agents + build prompt
 *      + hand off via `pi.sendUserMessage(prompt)`.
 *   2. Parent LLM (driven by skills/velpari-prd.md): spawn 4 subagents
 *      (fr-extractor, nfr-checker, helper-detector, consolidator) in
 *      parallel, read their reports, write the working-copy PSRS
 *      (Product and Software Requirements Specification, kept under
 *      the file name `PRD_<projectName>.md` for compatibility), and
 *      show the preview gate.
 *
 * The working copy is written to the grouped working-copy layout
 * (`.IDE_Plans/velpari/runs/<run-id>/prd/PRD_<projectName>.md`).
 * Reading the discussion artifact prefers the grouped Doc/ layout and
 * falls back to the legacy flat Doc/ path.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../core/config.js";
import { loadState } from "../core/state.js";
import {
	buildGroupedDiscussionPath,
	buildRunDir,
	buildWorkingGroupedPath,
	resolveDiscussionArtifact,
	slugify,
} from "../core/paths.js";
import {
	compactProfileMetadata,
	loadRequirementsProfile,
} from "../core/requirements-profile.js";
import { runStageWithScouts, type StageRunConfig } from "../core/stage-runner.js";

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

	// 2. Gate check: published discussion must exist (grouped first, legacy fallback).
	const topicSlug = slugify(state.mission);
	const groupedDiscussionPath = join(cwd, buildGroupedDiscussionPath(topicSlug));
	const resolved = resolveDiscussionArtifact(topicSlug, cwd);
	const inputArtifactPath = resolved?.path ?? groupedDiscussionPath;

	// 3. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const prdWorkingPath = buildWorkingGroupedPath(cwd, state.runId, "PRD", projectName);
	const prdWorkingDir = join(runDir, "prd");
	const scoutsDir = join(prdWorkingDir, "scouts");
	const workingCopyPath = prdWorkingPath;

	// 4. Load compact profile metadata if present (Phase 7).
	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

	const stageConfig: StageRunConfig = {
		stage: "drafting-prd",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: PRD_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath,
		workingCopyDir: prdWorkingDir,
		workingCopyPath,
		scoutsDir,
		cwd,
		profileMetadata,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}