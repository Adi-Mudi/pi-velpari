/**
 * /velpari-approve-discuss handler (Phase 7 update; FR-58, FR-59, NFR-14).
 *
 * Flow:
 * 1. Read working copy from `.IDE_Plans/velpari/runs/<run-id>/discuss/discussion-notes.md`.
 *    If only the legacy flat working-copy layout exists, read from there.
 * 2. Compute topic-slug from mission (via paths.ts:slugify).
 * 3. Publish to Doc/discussion/discussion-<topic-slug>.md (grouped).
 *    If a legacy flat file already exists, preserve it.
 * 4. Transition state: discussing -> discussed -> drafting-prd.
 * 5. Auto-invoke handlePrd() to chain (per FR-58).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { advanceStage, loadState } from "./state.js";
import {
	buildDiscussionPath,
	buildGroupedDiscussionPath,
	buildRunDir,
	slugify,
} from "./paths.js";
import { handlePrd } from "./prd.js";

export async function handleApproveDiscuss(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	// 1. Load state
	const state = loadState(cwd);
	if (!state.runId || state.currentStage === "none") {
		ctx.ui.notify("No active discussion to approve.", "error");
		return;
	}
	if (state.currentStage !== "discussing") {
		ctx.ui.notify(
			`Cannot approve discussion: current stage is "${state.currentStage}". ` +
				`Expected "discussing".`,
			"error",
		);
		return;
	}

	// 2. Read working copy from grouped working-copy dir first, then legacy.
	const runDir = buildRunDir(state.runId, cwd);
	const groupedWorkingPath = join(runDir, "discuss", "discussion-notes.md");
	const legacyWorkingPath = join(runDir, "discussion-notes.md");
	const workingPath = existsSync(groupedWorkingPath)
		? groupedWorkingPath
		: legacyWorkingPath;
	if (!existsSync(workingPath)) {
		ctx.ui.notify(`Discussion working copy not found at ${workingPath}.`, "error");
		return;
	}
	const content = readFileSync(workingPath, "utf8");

	// 3. Compute target path (grouped layout). Append timestamp suffix
	//    on re-runs so existing files are preserved (FR-69).
	const topicSlug = slugify(state.mission);
	let groupedTarget = join(cwd, buildGroupedDiscussionPath(topicSlug));
	if (existsSync(groupedTarget)) {
		const now = new Date();
		const stamp =
			now.getFullYear().toString() +
			String(now.getMonth() + 1).padStart(2, "0") +
			String(now.getDate()).padStart(2, "0") +
			"-" +
			String(now.getHours()).padStart(2, "0") +
			String(now.getMinutes()).padStart(2, "0") +
			String(now.getSeconds()).padStart(2, "0");
		groupedTarget = join(cwd, buildGroupedDiscussionPath(topicSlug, stamp));
	}

	// 4. Write published copy (grouped).
	mkdirSync(dirname(groupedTarget), { recursive: true });
	writeFileSync(groupedTarget, content, "utf8");
	ctx.ui.notify(`Published to ${groupedTarget}`, "info");

	// 5. Transition state: discussing -> discussed (via /velpari-approve-discuss),
	//    then to drafting-prd (via /velpari-prd which handlePrd will trigger).
	const next = advanceStage(state, "/velpari-approve-discuss", cwd);

	// 6. Chain into PRD
	ctx.ui.notify("Chaining into PRD stage...", "info");
	await handlePrd(ctx, pi, cwd);

	void buildDiscussionPath;
	void next; // state already saved by advanceStage
}