/**
 * /velpari-testplan handler (Phase 7 update).
 *
 * Two-phase flow:
 *   1. Handler: gate check + bootstrap agents + build prompt + hand off via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-testplan.md): spawn 4 subagents
 *      (testplan-strategy-designer, testplan-unit-test-generator,
 *      testplan-integration-test-generator, testplan-coverage-tracer) in
 *      parallel, write BOTH test-plan_<project>.md and test-cases_<project>.md,
 *      show preview gate.
 *
 * Note: This stage produces TWO working copies (test-plan + test-cases).
 * The handler passes both paths to stage-runner via `additionalWorkingCopies`.
 * The working-copy category folder is renamed from `testplan` to `tests`
 * to match the grouped Doc/ layout (Phase 7).
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

const TESTPLAN_SCOUTS = [
	{ name: "testplan-strategy-designer" },
	{ name: "testplan-unit-test-generator" },
	{ name: "testplan-integration-test-generator" },
	{ name: "testplan-coverage-tracer" },
] as const;

export async function handleTestplan(
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

	// 2. Gate check: published pseudocode must exist (grouped first, legacy fallback).
	const resolved = resolveDocArtifact("pseudocode", projectName, cwd);
	if (!resolved) {
		ctx.ui.notify(
			`Cannot read pseudocode for ${projectName}: not found at Doc/pseudocode/pseudocode_${projectName}.md or Doc/pseudocode_${projectName}.md. ` +
				`Run /velpari-pseudocode and /velpari-approve first.`,
			"error",
		);
		return;
	}
	const inputArtifactPath = resolved.path;

	// 3. Build artifact paths. The working-copy category is "tests"
	//    (matches the grouped Doc/ subfolder).
	const runDir = buildRunDir(state.runId, cwd);
	const testplanWorkingDir = join(runDir, "tests");
	const scoutsDir = join(testplanWorkingDir, "scouts");
	const workingCopyPath = buildWorkingGroupedPath(cwd, state.runId, "test-plan", projectName);
	const additionalWorkingCopies = [buildWorkingGroupedPath(cwd, state.runId, "test-cases", projectName)];

	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

	const stageConfig: StageRunConfig = {
		stage: "planning-tests",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: TESTPLAN_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath,
		workingCopyDir: testplanWorkingDir,
		workingCopyPath,
		scoutsDir,
		additionalWorkingCopies,
		cwd,
		profileMetadata,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}