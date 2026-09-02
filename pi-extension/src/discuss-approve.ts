/**
 * /velpari-approve-discuss handler (v1.6, FR-58, FR-59, NFR-14).
 *
 * Flow:
 * 1. Read working copy from .IDE_Plans/velpari/runs/<run-id>/discuss/discussion-notes.md
 * 2. Compute topic-slug from mission (via paths.ts:slugify)
 * 3. Copy to Doc/discussion-<topic-slug>.md (per FR-69)
 * 4. Transition state: discussing -> discussed -> drafting-prd
 * 5. Auto-invoke handlePrd() to chain (per FR-58)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { advanceStage, loadState } from "./state.js";
import { buildDiscussionPath, buildRunDir, slugify } from "./paths.js";
import { handlePrd } from "./prd.js";

export async function handleApproveDiscuss(
	ctx: ExtensionCommandContext,
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

	// 2. Read working copy
	const runDir = buildRunDir(state.runId, cwd);
	const workingPath = join(runDir, "discuss", "discussion-notes.md");
	if (!existsSync(workingPath)) {
		ctx.ui.notify(`Discussion working copy not found at ${workingPath}.`, "error");
		return;
	}
	const content = readFileSync(workingPath, "utf8");

	// 3. Compute target path (FR-69: append timestamp suffix on re-run).
	const topicSlug = slugify(state.mission);
	let targetPath = join(cwd, buildDiscussionPath(topicSlug));
	if (existsSync(targetPath)) {
		// Generate a YYYYMMDD-HHMMSS suffix from current time.
		const now = new Date();
		const stamp =
			now.getFullYear().toString() +
			String(now.getMonth() + 1).padStart(2, "0") +
			String(now.getDate()).padStart(2, "0") +
			"-" +
			String(now.getHours()).padStart(2, "0") +
			String(now.getMinutes()).padStart(2, "0") +
			String(now.getSeconds()).padStart(2, "0");
		targetPath = join(cwd, buildDiscussionPath(topicSlug, stamp));
	}

	// 4. Write published copy
	mkdirSync(join(cwd, "Doc"), { recursive: true });
	writeFileSync(targetPath, content, "utf8");
	ctx.ui.notify(`Published to ${targetPath}`, "info");

	// 5. Transition state: discussing -> discussed (via /velpari-approve-discuss),
	//    then to drafting-prd (via /velpari-prd which handlePrd will trigger).
	const next = advanceStage(state, "/velpari-approve-discuss", cwd);

	// 6. Chain into PRD
	ctx.ui.notify("Chaining into PRD stage...", "info");
	await handlePrd(ctx, cwd);

	void next; // state already saved by advanceStage
}
