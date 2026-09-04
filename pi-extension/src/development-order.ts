/**
 * /velpari-development-order handler (v2.0 / Phase 5 of all-stages refactor).
 *
 * Optional post-pipeline stage (FR-36, FR-32). Reads the design, RTM,
 * feasibility, PRD, and test plan; spawns 4 subagents in parallel to
 * produce 4 rankings (topology, risk, test-coverage, value); merges into
 * a single final order.
 *
 * Two-phase flow:
 *   1. Handler: read + concatenate 5 published docs → build prompt + hand
 *      off via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-development-order.md): spawn 4
 *      subagents (do-topology, do-risk, do-test, do-value) in parallel,
 *      merge rankings, write development-order_<projectName>.md, show preview gate.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../src/config.js";
import { buildOutputPath, buildRunDir } from "../src/paths.js";
import { loadState } from "../src/state.js";
import { runStageWithScouts, type StageRunConfig } from "../src/stage-runner.js";

const DO_SCOUTS = [
	{ name: "do-topology" },
	{ name: "do-risk" },
	{ name: "do-test" },
	{ name: "do-value" },
] as const;

/** List of Doc/ artifacts the development-order stage reads. */
const DO_INPUT_ARTIFACTS = ["design", "RTM", "feasibility-study", "PRD", "test-plan"] as const;

export async function handleDevelopmentOrder(
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

	// 2. Gate check: all 5 published artifacts must exist.
	const inputPaths = DO_INPUT_ARTIFACTS.map((a) => join(cwd, buildOutputPath(a, projectName)));
	const missing: string[] = [];
	for (const p of inputPaths) {
		if (!existsSync(p)) missing.push(p);
	}
	if (missing.length > 0) {
		ctx.ui.notify(
			`Cannot run development-order: missing artifacts: ${missing.join(", ")}. ` +
				`All previous stages (prd, rtm, feasibility, design, testplan) must be published.`,
			"error",
		);
		return;
	}

	// 3. Read + concatenate all 5 artifacts into the inputArtifactContent.
	const sections: string[] = [];
	for (let i = 0; i < inputPaths.length; i++) {
		const p = inputPaths[i]!;
		const content = readFileSync(p, "utf8");
		sections.push(`## ${DO_INPUT_ARTIFACTS[i]}\n\n${content}`);
	}
	const inputArtifactContent = sections.join("\n\n---\n\n");

	// 4. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const devOrderDir = join(runDir, "development-order");
	const scoutsDir = join(devOrderDir, "scouts");
	const workingCopyPath = join(devOrderDir, `development-order_${projectName}.md`);

	const stageConfig: StageRunConfig = {
		// Development order is optional post-pipeline — no Stage enum value.
		// Use "ordered-development" as a placeholder so buildStagePrompt succeeds;
		// the LLM does not need an accurate stage field for this stage.
		stage: "ordered-development",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: DO_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath: inputPaths[0]!, // primary input (not used since we pass content)
		inputArtifactContent,
		workingCopyDir: devOrderDir,
		workingCopyPath,
		scoutsDir,
		cwd,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}