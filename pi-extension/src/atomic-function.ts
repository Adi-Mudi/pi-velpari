/**
 * /velpari-atomic-function handler (Phase 7 update).
 *
 * Optional post-pipeline stage. Reads all published artifacts
 * (discussion, PRD, RTM, feasibility, design, pseudocode, test plan
 * + cases) and spawns 4 subagents in parallel to propose atomic
 * function splits.
 *
 * Two-phase flow:
 *   1. Handler: read all published docs (grouped first, legacy
 *      fallback) → concatenate into prompt → build prompt + hand off
 *      via pi.sendUserMessage.
 *   2. Parent LLM (driven by skills/velpari-atomic-function.md): spawn
 *      4 subagents (af-source-rtm, af-source-pseudocode, af-source-prd,
 *      af-source-testcases) in parallel, write
 *      atomic-functions_<projectName>.md, show preview gate.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "./config.js";
import { loadState } from "./state.js";
import {
	buildGroupedDiscussionPath,
	buildGroupedPath,
	buildRunDir,
	buildWorkingGroupedPath,
	resolveDiscussionArtifact,
	resolveDocArtifact,
	slugify,
} from "./paths.js";
import {
	compactProfileMetadata,
	loadRequirementsProfile,
} from "./requirements-profile.js";
import { runStageWithScouts, type StageRunConfig } from "./stage-runner.js";

const ATOMIC_FUNCTION_SCOUTS = [
	{ name: "af-source-rtm" },
	{ name: "af-source-pseudocode" },
	{ name: "af-source-prd" },
	{ name: "af-source-testcases" },
] as const;

/** Artifacts the atomic-function stage reads (all required). */
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

	const topicSlug = slugify(state.mission);
	const discussionResolved = resolveDiscussionArtifact(topicSlug, cwd);
	const discussionFallback = join(cwd, buildGroupedDiscussionPath(topicSlug));
	const discussionPath = discussionResolved?.path ?? discussionFallback;

	const inputPaths: string[] = [];
	const labels: string[] = [];
	if (discussionResolved || existsSync(discussionFallback)) {
		inputPaths.push(discussionResolved?.path ?? discussionFallback);
		labels.push("discussion");
	}

	for (const a of ATOMIC_INPUT_ARTIFACTS) {
		const resolved = resolveDocArtifact(a, projectName, cwd);
		if (resolved) {
			inputPaths.push(resolved.path);
			labels.push(a);
		} else {
			ctx.ui.notify(
				`Cannot run atomic-function: missing ${a} at ${join(cwd, buildGroupedPath(a, projectName))}. ` +
					`All previous stages (prd, rtm, feasibility, design, pseudocode, testplan) must be published.`,
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
	const atomicWorkingDir = join(runDir, "atomic-function");
	const scoutsDir = join(atomicWorkingDir, "scouts");
	const workingCopyPath = buildWorkingGroupedPath(cwd, state.runId, "atomic-functions", projectName);

	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

	const stageConfig: StageRunConfig = {
		// Atomic function is optional post-pipeline — no Stage enum value.
		// Use "ordered-development" as a placeholder so buildStagePrompt succeeds.
		stage: "ordered-development",
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: ATOMIC_FUNCTION_SCOUTS.map((s) => ({
			name: s.name,
			reportPath: join(scoutsDir, `${s.name}-report.json`),
		})),
		inputArtifactPath: inputPaths[0]!,
		inputArtifactContent,
		workingCopyDir: atomicWorkingDir,
		workingCopyPath,
		scoutsDir,
		cwd,
		profileMetadata,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}