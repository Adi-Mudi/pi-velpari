/**
 * /velpari-testplan handler.
 *
 * Flow:
 * 1. Read Doc/pseudocode_<projectName>.md (gate check)
 * 2. Read projectName
 * 3. Compose prompt with loadStageSkill("planning-tests")
 * 4. Write TWO working copies:
 *    - test-plan_<projectName>.md
 *    - test-cases_<projectName>.md
 * 5. Preview gate
 *
 * Phase C: stub content for both.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig, validateFilesConfig } from "./config.js";
import { buildRunDir, buildOutputPath } from "./paths.js";
import { loadState } from "./state.js";

export async function handleTestplan(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const config = loadFilesConfig(cwd);
	if (!validateFilesConfig(config)) {
		ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
		return;
	}
	const projectName = config.projectName;

	const state = loadState(cwd);
	if (!state.runId) {
		ctx.ui.notify("No active run. Run /velpari-discuss first.", "error");
		return;
	}

	const pseudoPath = join(cwd, buildOutputPath("pseudocode", projectName));
	if (!existsSync(pseudoPath)) {
		ctx.ui.notify(
			`Pseudocode not found at ${pseudoPath}. Run /velpari-pseudocode first.`,
			"error",
		);
		return;
	}

	const runDir = buildRunDir(state.runId, cwd);
	const testplanDir = join(runDir, "testplan");
	mkdirSync(testplanDir, { recursive: true });

	// Write two working copies
	const planContent = renderTestPlanStub(projectName);
	const casesContent = renderTestCasesStub(projectName);

	const planWorkingPath = join(testplanDir, `test-plan_${projectName}.md`);
	const casesWorkingPath = join(testplanDir, `test-cases_${projectName}.md`);
	writeFileSync(planWorkingPath, planContent, "utf8");
	writeFileSync(casesWorkingPath, casesContent, "utf8");

	const planTarget = buildOutputPath("test-plan", projectName);
	const casesTarget = buildOutputPath("test-cases", projectName);
	const confirmed = await ctx.ui.confirm(
		"Publish test plan + cases?",
		`Working copies written to ${planWorkingPath} and ${casesWorkingPath}. Publish to ${planTarget} and ${casesTarget}?`,
	);
	if (confirmed) {
		ctx.ui.notify("Test plan drafted. Run /velpari-approve to publish.", "info");
	}
}

function renderTestPlanStub(projectName: string): string {
	return [
		`# Test Plan — ${projectName}`,
		``,
		`## 1. Test Strategy`,
		`_Phase C stub._`,
		``,
		`## 2. Test Types`,
		`| Type | Scope | Tools | Owner |`,
		`| --- | --- | --- | --- |`,
		`| Unit | _stub_ | _stub_ | _stub_ |`,
		``,
		`## 3. Coverage Targets`,
		`_Phase C stub._`,
		``,
	].join("\n");
}

function renderTestCasesStub(projectName: string): string {
	return [
		`# Test Cases — ${projectName}`,
		``,
		`| TC ID | Name | FR Ref | Steps | Expected |`,
		`| --- | --- | --- | --- | --- |`,
		`| TC-001 | _stub_ | FR-NN | _stub_ | _stub_ |`,
		``,
		`_Phase C stub. Real test cases derive from pseudocode._`,
		``,
	].join("\n");
}
