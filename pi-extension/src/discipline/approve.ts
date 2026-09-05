/**
 * Generic /velpari-approve handler for stages 2-7 (Phase 7 update).
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
 * 4. Read working copy from the grouped working-copy path; if missing,
 *    fall back to the legacy flat working-copy layout.
 * 5. Write to the grouped Doc/ path; if a legacy flat copy exists,
 *    preserve it. Stage transitions and two-file testplan approval
 *    are unchanged.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { advanceStage, appendStageEntry, loadState } from "../core/state.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import {
	buildRunDir,
	GROUPED_CATEGORIES,
} from "../core/paths.js";
import type { Stage } from "../core/constants.js";

/**
 * Map a stage to (working-copy category, published artifact name,
 * additional published artifacts for testplan).
 */
function stageToArtifact(stage: Stage): {
	workingDir: string;
	artifact: string;
	extras?: string[];
} | null {
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
			return {
				workingDir: "tests",
				artifact: "test-plan",
				extras: ["test-cases"],
			};
		default:
			return null;
	}
}

export async function handleApprove(
	ctx: ExtensionCommandContext,
	pi?: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	const state = loadState(cwd);
	if (!state.runId || state.currentStage === "none") {
		ctx.ui.notify("No active run to approve.", "error");
		return;
	}

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

	const config = loadFilesConfig(cwd);
	const projectName = validateFilesConfig(config) && config.projectName
		? config.projectName
		: state.mission || "Project";
	const runDir = buildRunDir(state.runId, cwd);

	// Try the grouped working-copy directory first, then the legacy
	// flat working-copy directory (Phase 7 backwards compatibility).
	const groupedWorkingDir = join(runDir, mapping.workingDir);
	const legacyWorkingDir = join(runDir, mapping.artifact);
	const workingDirPath = existsSync(groupedWorkingDir) ? groupedWorkingDir : legacyWorkingDir;
	if (!existsSync(workingDirPath)) {
		ctx.ui.notify(`Working copy dir not found at ${groupedWorkingDir} or ${legacyWorkingDir}.`, "error");
		return;
	}

	const { readdirSync } = await import("node:fs");
	const files = readdirSync(workingDirPath).filter((f) => f.endsWith(".md"));
	if (files.length === 0) {
		ctx.ui.notify(`No working-copy file found in ${workingDirPath}.`, "error");
		return;
	}

	// Testplan publishes both test-plan and test-cases to the same
	// `tests/` subfolder. Keep the two-file behavior intact.

	for (const file of files) {
		const content = readFileSync(join(workingDirPath, file), "utf8");
		// Pick the category subfolder based on the artifact embedded in
		// the working-copy file name (e.g. "test-cases_TestApp.md"
		// → "tests/test-cases_TestApp.md"). Rename the published file
		// to the configured projectName.
		const fileArtifact = file.replace(/_\w+\.md$/, "").replace(/\.md$/, "");
		let category = GROUPED_CATEGORIES[mapping.artifact] ?? "";
		if (mapping.artifact === "test-plan" && file.startsWith("test-cases_")) {
			category = GROUPED_CATEGORIES["test-cases"] ?? "";
		} else if (fileArtifact && fileArtifact !== mapping.artifact) {
			category = GROUPED_CATEGORIES[fileArtifact] ?? category;
		}
		const outputFile = `${fileArtifact}_${projectName}.md`;
		const groupedRel = category ? `${category}/${outputFile}` : outputFile;
		const groupedAbs = join(cwd, "Doc", groupedRel);
		mkdirSync(dirname(groupedAbs), { recursive: true });
		writeFileSync(groupedAbs, content, "utf8");
		ctx.ui.notify(`Published to ${groupedAbs}`, "info");
	}


	// Transition state via /velpari-approve
	const next = advanceStage(state, "/velpari-approve", cwd, pi);
	if (pi) appendStageEntry(pi, next);
	ctx.ui.notify(`Stage advanced to "${next.currentStage}".`, "info");
}