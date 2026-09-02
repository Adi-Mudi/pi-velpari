/**
 * /velpari-show-* handlers.
 *
 * 7 read-only commands that print a published Doc/ artifact to the TUI.
 * Never modifies state. Never writes files.
 *
 * Map:
 *   show-discussion -> Doc/discussion-<topic-slug>.md
 *   show-prd        -> Doc/PRD_<projectName>.md
 *   show-rtm        -> Doc/RTM_<projectName>.md
 *   show-feasibility -> Doc/feasibility-study_<projectName>.md
 *   show-design     -> Doc/design_<projectName>.md
 *   show-pseudocode -> Doc/pseudocode_<projectName>.md
 *   show-testplan   -> Doc/test-plan_<projectName>.md + Doc/test-cases_<projectName>.md
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig, validateFilesConfig } from "./config.js";
import { loadState } from "./state.js";
import { buildDiscussionPath, buildOutputPath, slugify } from "./paths.js";

const MAX_NOTIFY_LENGTH = 8000;

function emit(ctx: ExtensionCommandContext, content: string, fallback: string): void {
	if (content.length <= MAX_NOTIFY_LENGTH) {
		ctx.ui.notify(content, "info");
	} else {
		const truncated = content.slice(0, MAX_NOTIFY_LENGTH) + "\n... [truncated]";
		ctx.ui.notify(truncated, "info");
	}
	void fallback;
}

function getProjectName(ctx: ExtensionCommandContext, cwd: string): string | null {
	const config = loadFilesConfig(cwd);
	if (!validateFilesConfig(config) || !config.projectName) {
		ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
		return null;
	}
	return config.projectName;
}

function readAndPrint(ctx: ExtensionCommandContext, absPath: string, label: string): void {
	if (!existsSync(absPath)) {
		ctx.ui.notify(`${label} not found at ${absPath}.`, "error");
		return;
	}
	const content = readFileSync(absPath, "utf8");
	emit(ctx, content, label);
}

export async function showDiscussion(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const state = loadState(cwd);
	if (!state.runId || state.currentStage === "none") {
		ctx.ui.notify("No active run. Run /velpari-discuss first.", "error");
		return;
	}
	const topicSlug = slugify(state.mission);
	const absPath = join(cwd, buildDiscussionPath(topicSlug));
	readAndPrint(ctx, absPath, `Discussion (${topicSlug})`);
}

export async function showPrd(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const absPath = join(cwd, buildOutputPath("PRD", projectName));
	readAndPrint(ctx, absPath, `PRD (${projectName})`);
}

export async function showRtm(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const absPath = join(cwd, buildOutputPath("RTM", projectName));
	readAndPrint(ctx, absPath, `RTM (${projectName})`);
}

export async function showFeasibility(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const absPath = join(cwd, buildOutputPath("feasibility-study", projectName));
	readAndPrint(ctx, absPath, `Feasibility study (${projectName})`);
}

export async function showDesign(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const absPath = join(cwd, buildOutputPath("design", projectName));
	readAndPrint(ctx, absPath, `Design (${projectName})`);
}

export async function showPseudocode(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const absPath = join(cwd, buildOutputPath("pseudocode", projectName));
	readAndPrint(ctx, absPath, `Pseudocode (${projectName})`);
}

export async function showTestplan(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const planPath = join(cwd, buildOutputPath("test-plan", projectName));
	const casesPath = join(cwd, buildOutputPath("test-cases", projectName));

	const planExists = existsSync(planPath);
	const casesExists = existsSync(casesPath);

	if (!planExists && !casesExists) {
		ctx.ui.notify(
			`Neither test-plan nor test-cases found for ${projectName}. ` +
				`Run /velpari-testplan first.`,
			"error",
		);
		return;
	}

	const parts: string[] = [];
	if (planExists) {
		parts.push(`# Test Plan\n${readFileSync(planPath, "utf8")}`);
	} else {
		parts.push(`# Test Plan (missing at ${planPath})`);
	}
	if (casesExists) {
		parts.push(`# Test Cases\n${readFileSync(casesPath, "utf8")}`);
	} else {
		parts.push(`# Test Cases (missing at ${casesPath})`);
	}

	const combined = parts.join("\n\n---\n\n");
	emit(ctx, combined, "Test plan + cases");
}
