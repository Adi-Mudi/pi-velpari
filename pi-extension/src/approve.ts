/**
 * Generic /velpari-approve handler for stages 2-7.
 *
 * Per CHANGELOG v1.6 (FR-59):
 * - /velpari-approve-discuss handles the discussion stage (separate command).
 * - /velpari-approve handles stages 2-7 (prd, rtm, feasibility, design,
 *   pseudocode, testplan).
 *
 * Flow:
 * 1. Read current state; determine current stage.
 * 2. Refuse if current stage is `discussing` or `discussed` (use
 *    /velpari-approve-discuss for those).
 * 3. Map current stage → working-copy dir name and published artifact name.
 * 4. Read working copy; copy to Doc/.
 * 5. Transition state via advanceStage.
 * 6. NO auto-chain (unlike /velpari-approve-discuss).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { advanceStage, loadState } from "./state.js";
import { buildDiscussionPath, buildOutputPath, buildRunDir, slugify } from "./paths.js";
import type { Stage } from "./constants.js";

/**
 * Map a stage to (working-copy dir name, published artifact name).
 */
function stageToArtifact(stage: Stage): { workingDir: string; artifact: string } | null {
	switch (stage) {
		case "drafting-prd":
		case "drafted-prd":
			return { workingDir: "prd", artifact: "PRD" };
		case "building-rtm":
		case "built-rtm":
			return { workingDir: "rtm", artifact: "RTM" };
		case "analyzing-feasibility":
		case "analyzed-feasibility":
			return { workingDir: "feasibility", artifact: "feasibility-study" };
		case "designing":
		case "designed":
			return { workingDir: "design", artifact: "design" };
		case "writing-pseudocode":
		case "wrote-pseudocode":
			return { workingDir: "pseudocode", artifact: "pseudocode" };
		case "planning-tests":
		case "planned-tests":
			return { workingDir: "testplan", artifact: "test-plan" };
		default:
			return null;
	}
}

export async function handleApprove(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const state = loadState(cwd);
	if (!state.runId || state.currentStage === "none") {
		ctx.ui.notify("No active run to approve.", "error");
		return;
	}

	// Refuse if in discussion stage (use /velpari-approve-discuss instead).
	if (state.currentStage === "discussing" || state.currentStage === "discussed") {
		ctx.ui.notify(
			`Use /velpari-approve-discuss for the discussion stage. ` +
				`Current stage: "${state.currentStage}".`,
			"error",
		);
		return;
	}

	const mapping = stageToArtifact(state.currentStage);
	if (!mapping) {
		ctx.ui.notify(`No artifact mapping for stage "${state.currentStage}".`, "error");
		return;
	}

	// Read working copy from .IDE_Plans/velpari/runs/<run-id>/<workingDir>/
	const runDir = buildRunDir(state.runId, cwd);
	const workingDirPath = join(runDir, mapping.workingDir);
	if (!existsSync(workingDirPath)) {
		ctx.ui.notify(`Working copy dir not found at ${workingDirPath}.`, "error");
		return;
	}

	// Find the working-copy file. Pattern: <artifact>_<projectName>.md
	// For testplan stage, there are two files; we approve both.
	const { readdirSync } = await import("node:fs");
	const files = readdirSync(workingDirPath).filter((f) => f.endsWith(".md"));
	if (files.length === 0) {
		ctx.ui.notify(`No working-copy file found in ${workingDirPath}.`, "error");
		return;
	}

	// Get projectName from state or files.json
	const projectName = state.mission ? slugify(state.mission) : "Project";
	const targetDir = join(cwd, "Doc");
	mkdirSync(targetDir, { recursive: true });

	for (const file of files) {
		const content = readFileSync(join(workingDirPath, file), "utf8");
		const targetPath = join(targetDir, file);
		writeFileSync(targetPath, content, "utf8");
		ctx.ui.notify(`Published to ${targetPath}`, "info");
	}

	void dirname;
	void buildDiscussionPath;
	void buildOutputPath;
	void projectName;

	// Transition state via /velpari-approve
	const next = advanceStage(state, "/velpari-approve", cwd);
	ctx.ui.notify(`Stage advanced to "${next.currentStage}".`, "info");
}
