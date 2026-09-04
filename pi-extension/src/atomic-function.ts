/**
 * /velpari-atomic-function handler (v2.0 / Phase 5 of all-stages refactor).
 *
 * Optional post-pipeline stage (FR-35, FR-31). Reads all published
 * artifacts (discussion, PRD, RTM, feasibility, design, pseudocode, test
 * plan + cases) and spawns 4 subagents in parallel to propose atomic
 * function splits.
 *
 * Two-phase flow:
 *   1. Handler: read all published docs → concatenate into prompt →
 *      build prompt + hand off via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-atomic-function.md): spawn 4
 *      subagents (af-source-rtm, af-source-pseudocode, af-source-prd,
 *      af-source-testcases) in parallel, write
 *      atomic-functions_<projectName>.md, show preview gate.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../src/config.js";
import { buildOutputPath, buildRunDir, slugify } from "../src/paths.js";
import { loadState } from "../src/state.js";
import { runStageWithScouts, type StageRunConfig } from "../src/stage-runner.js";

const ATOMIC_FUNCTION_SCOUTS = [
	{ name: "af-source-rtm" },
	{ name: "af-source-pseudocode" },
	{ name: "af-source-prd" },
	{ name: "af-source-testcases" },
] as const;

/** List of Doc/ artifacts the atomic-function stage reads. */
const ATOMIC_INPUT_ARTIFACTS = [
	"PRD",
	"RTM",
	"feasibility-study",
	"design",
	"pseudocode",
	"test-plan",
	"test-cases",
] as const;

export async function handleAtomicFunction(
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

	// 2. Gate check: all 7 published artifacts must exist.
	const topicSlug = slugify(state.mission);
	const inputPaths = [
		join(cwd, "Doc", `discussion-${topicSlug}.md`),
		...ATOMIC_INPUT_ARTIFACTS.map((a) => join(cwd, buildOutputPath(a, projectName))),
	];
	const missing: string[] = [];
	for (const p of inputPaths) {
		if (!existsSyncSafe(p)) missing.push(p);
	}
	if (missing.length > 0) {
		ctx.ui.notify(
			`Cannot run atomic-function: missing artifacts: ${missing.join(", ")}. ` +
				`All previous stages (prd, rtm, feasibility, design, pseudocode, testplan) must be published.`,
			"error",
		);
		return;
	}

	// 3. Read + concatenate all 7 artifacts into the inputArtifactContent.
	const sections: string[] = [];
	for (let i = 0; i < inputPaths.length; i++) {
		const p = inputPaths[i]!;
		const content = readFileSync(p, "utf8");
		const label = i === 0 ? "discussion" : ATOMIC_INPUT_ARTIFACTS[i - 1];
		sections.push(`## ${label}\n\n${content}`);
	}
	const inputArtifactContent = sections.join("\n\n---\n\n");

	// 4. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const atomicDir = join(runDir, "atomic-function");
	const scoutsDir = join(atomicDir, "scouts");
	const workingCopyPath = join(atomicDir, `atomic-functions_${projectName}.md`);

	const stageConfig: StageRunConfig = {
		// Atomic function is an optional post-pipeline stage — no Stage enum value.
		// Use "ordered-development" as a placeholder so buildStagePrompt succeeds;
		// the LLM does not need an accurate stage field for this stage.
		stage: "ordered-development",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: ATOMIC_FUNCTION_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath: inputPaths[0]!, // primary input (not used since we pass content)
		inputArtifactContent,
		workingCopyDir: atomicDir,
		workingCopyPath,
		scoutsDir,
		cwd,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}

import { existsSync } from "node:fs";
function existsSyncSafe(p: string): boolean {
	try {
		return existsSync(p);
	} catch {
		return false;
	}
}