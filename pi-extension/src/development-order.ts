/**
 * /velpari-development-order handler (Phase 7 update).
 *
 * Optional post-pipeline stage. Reads the design, RTM, feasibility,
 * PRD, and test plan; spawns 4 subagents in parallel to produce 4
 * rankings (topology, risk, test-coverage, value); merges into a
 * single final order.
 *
 * Two-phase flow:
 *   1. Handler: read + concatenate 5 published docs (grouped first,
 *      legacy fallback) → build prompt + hand off via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-development-order.md): spawn
 *      4 subagents (do-topology, do-risk, do-test, do-value) in parallel,
 *      merge rankings, write development-order_<projectName>.md, show
 *      preview gate.
 */

import { readFileSync } from "node:fs";
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

const DO_SCOUTS = [
	{ name: "do-topology" },
	{ name: "do-risk" },
	{ name: "do-test" },
	{ name: "do-value" },
] as const;

const DO_INPUT_ARTIFACTS = ["design", "RTM", "feasibility-study", "PRD", "test-plan"] as const;

export async function handleDevelopmentOrder(
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

	const inputPaths: string[] = [];
	const labels: string[] = [];
	for (const a of DO_INPUT_ARTIFACTS) {
		const resolved = resolveDocArtifact(a, projectName, cwd);
		if (resolved) {
			inputPaths.push(resolved.path);
			labels.push(a);
		} else {
			ctx.ui.notify(
				`Cannot run development-order: missing ${a}. ` +
					`All previous stages (prd, rtm, feasibility, design, testplan) must be published.`,
				"error",
			);
			return;
		}
	}

	const sections: string[] = [];
	for (let i = 0; i < inputPaths.length; i++) {
		const p = inputPaths[i]!;
		const content = readFileSync(p, "utf8");
		sections.push(`## ${labels[i]}\n\n${content}`);
	}
	const inputArtifactContent = sections.join("\n\n---\n\n");

	const runDir = buildRunDir(state.runId, cwd);
	const devOrderWorkingDir = join(runDir, "development-order");
	const scoutsDir = join(devOrderWorkingDir, "scouts");
	const workingCopyPath = buildWorkingGroupedPath(cwd, state.runId, "development-order", projectName);

	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

	const stageConfig: StageRunConfig = {
		stage: "ordered-development",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: DO_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath: inputPaths[0]!,
		inputArtifactContent,
		workingCopyDir: devOrderWorkingDir,
		workingCopyPath,
		scoutsDir,
		cwd,
		profileMetadata,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}