/**
 * /velpari-testplan handler (v2.0 / Phase 4 of all-stages refactor).
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
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../src/config.js";
import { buildOutputPath, buildRunDir } from "../src/paths.js";
import { loadState } from "../src/state.js";
import { runStageWithScouts, type StageRunConfig } from "../src/stage-runner.js";

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

	// 2. Gate check: published pseudocode must exist.
	const inputArtifactPath = join(cwd, buildOutputPath("pseudocode", projectName));

	// 3. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const testplanDir = join(runDir, "testplan");
	const scoutsDir = join(testplanDir, "scouts");
	// Two working copies for this stage.
	const workingCopyPath = join(testplanDir, `test-plan_${projectName}.md`);
	const additionalWorkingCopies = [join(testplanDir, `test-cases_${projectName}.md`)];

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
		workingCopyDir: testplanDir,
		workingCopyPath,
		scoutsDir,
		additionalWorkingCopies,
		cwd,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}