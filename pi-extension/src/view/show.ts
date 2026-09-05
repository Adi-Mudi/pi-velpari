/**
 * /velpari-show-* handlers (Phase 7 update).
 *
 * 7 read-only commands that print a published Doc/ artifact to the TUI.
 * Never modifies state. Never writes files.
 *
 * Map (grouped layout; legacy flat Doc/ layout used as fallback):
 *   show-discussion  -> Doc/discussion/discussion-<topic-slug>.md
 *   show-prd         -> Doc/requirements/PRD_<projectName>.md
 *   show-rtm         -> Doc/requirements/RTM_<projectName>.md
 *   show-feasibility -> Doc/feasibility/feasibility-study_<projectName>.md
 *   show-design      -> Doc/design/design_<projectName>.md
 *   show-pseudocode  -> Doc/pseudocode/pseudocode_<projectName>.md
 *   show-testplan    -> Doc/tests/test-plan_<projectName>.md + Doc/tests/test-cases_<projectName>.md
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { loadState } from "../core/state.js";
import {
	buildGroupedDiscussionPath,
	buildGroupedPath,
	resolveDiscussionArtifact,
	resolveDocArtifact,
	slugify,
} from "../core/paths.js";

const MAX_NOTIFY_LENGTH = 8000;

function emit(ctx: ExtensionCommandContext, content: string): void {
	if (content.length <= MAX_NOTIFY_LENGTH) {
		ctx.ui.notify(content, "info");
	} else {
		const TRUNCATION_MARKER = "\n... [truncated]";
		const truncated = content.slice(0, MAX_NOTIFY_LENGTH - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
		ctx.ui.notify(truncated, "info");
	}
}

function getProjectName(ctx: ExtensionCommandContext, cwd: string): string | null {
	const config = loadFilesConfig(cwd);
	if (!validateFilesConfig(config) || !config.projectName) {
		ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
		return null;
	}
	return config.projectName;
}

function readAndPrint(
	ctx: ExtensionCommandContext,
	resolved: { path: string; layout: "grouped" | "legacy" } | null,
	label: string,
): void {
	if (!resolved) {
		ctx.ui.notify(`${label} not found (checked grouped + legacy Doc/ layouts).`, "error");
		return;
	}
	const content = readFileSync(resolved.path, "utf8");
	const suffix = resolved.layout === "legacy" ? " (legacy flat path)" : "";
	emit(ctx, content);
	if (resolved.layout === "legacy") {
		ctx.ui.notify(`Note: ${label} found at legacy flat path ${resolved.path}${suffix}.`, "info");
	}
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
	const resolved = resolveDiscussionArtifact(topicSlug, cwd);
	const grouped = join(cwd, buildGroupedDiscussionPath(topicSlug));
	void grouped;
	readAndPrint(ctx, resolved, `Discussion (${topicSlug})`);
}

export async function showPrd(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const resolved = resolveDocArtifact("PRD", projectName, cwd);
	readAndPrint(ctx, resolved, `PRD (${projectName})`);
}

export async function showRtm(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const resolved = resolveDocArtifact("RTM", projectName, cwd);
	readAndPrint(ctx, resolved, `RTM (${projectName})`);
}

export async function showFeasibility(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const resolved = resolveDocArtifact("feasibility-study", projectName, cwd);
	readAndPrint(ctx, resolved, `Feasibility study (${projectName})`);
}

export async function showDesign(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const resolved = resolveDocArtifact("design", projectName, cwd);
	readAndPrint(ctx, resolved, `Design (${projectName})`);
}

export async function showPseudocode(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const resolved = resolveDocArtifact("pseudocode", projectName, cwd);
	readAndPrint(ctx, resolved, `Pseudocode (${projectName})`);
}

export async function showTestplan(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const projectName = getProjectName(ctx, cwd);
	if (!projectName) return;
	const planPath = resolveDocArtifact("test-plan", projectName, cwd);
	const casesPath = resolveDocArtifact("test-cases", projectName, cwd);

	if (!planPath && !casesPath) {
		ctx.ui.notify(
			`Neither test-plan nor test-cases found for ${projectName}. ` +
				`Run /velpari-testplan first.`,
			"error",
		);
		return;
	}

	const parts: string[] = [];
	if (planPath) {
		parts.push(`# Test Plan\n${readFileSync(planPath.path, "utf8")}`);
	} else {
		parts.push(`# Test Plan (missing; expected at ${join(cwd, buildGroupedPath("test-plan", projectName))})`);
	}
	if (casesPath) {
		parts.push(`# Test Cases\n${readFileSync(casesPath.path, "utf8")}`);
	} else {
		parts.push(`# Test Cases (missing; expected at ${join(cwd, buildGroupedPath("test-cases", projectName))})`);
	}

	const combined = parts.join("\n\n---\n\n");
	emit(ctx, combined);
}