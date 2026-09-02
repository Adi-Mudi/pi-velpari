/**
 * /velpari-feasibility handler.
 *
 * Flow:
 * 1. Read Doc/RTM_<projectName>.md (gate check)
 * 2. Read projectName from .pi/velpari/files.json
 * 3. Compose prompt with loadStageSkill("analyzing-feasibility") + framework + RTM content
 * 4. Write working copy at .IDE_Plans/velpari/runs/<run-id>/feasibility/feasibility-study_<projectName>.md
 * 5. Preview gate
 *
 * Phase C: stub content. Real LLM call deferred.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig, validateFilesConfig } from "./config.js";
import { buildRunDir, buildOutputPath } from "./paths.js";
import { loadState } from "./state.js";

export async function handleFeasibility(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const config = loadFilesConfig(cwd);
	if (!validateFilesConfig(config)) {
		ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
		return;
	}
	const projectName = config.projectName;

	const state = loadState(cwd);
	if (!state.runId) {
		ctx.ui.notify("No active run. Run /velpari-discuss first.", "error");
		return;
	}

	const rtmPath = join(cwd, buildOutputPath("RTM", projectName));
	if (!existsSync(rtmPath)) {
		ctx.ui.notify(`RTM not found at ${rtmPath}. Run /velpari-rtm first.`, "error");
		return;
	}

	const runDir = buildRunDir(state.runId, cwd);
	const feasDir = join(runDir, "feasibility");
	mkdirSync(feasDir, { recursive: true });

	const content = renderFeasibilityStub(projectName);
	const workingPath = join(feasDir, `feasibility-study_${projectName}.md`);
	writeFileSync(workingPath, content, "utf8");

	const targetPath = buildOutputPath("feasibility-study", projectName);
	const confirmed = await ctx.ui.confirm(
		"Publish feasibility study?",
		`Working copy written to ${workingPath}. Publish to ${targetPath}?`,
	);
	if (confirmed) {
		ctx.ui.notify("Feasibility study drafted. Run /velpari-approve to publish.", "info");
	}
}

function renderFeasibilityStub(projectName: string): string {
	return [
		`# Feasibility Study — ${projectName}`,
		``,
		`## 1. Technical Feasibility`,
		`_Phase C stub. Real rating derives from RTM._`,
		``,
		`## 2. Economic Feasibility`,
		`_Phase C stub._`,
		``,
		`## 3. Legal Feasibility`,
		`_Phase C stub._`,
		``,
		`## 4. Operational Feasibility`,
		`_Phase C stub._`,
		``,
		`## 5. Schedule Feasibility`,
		`_Phase C stub._`,
		``,
		`## 6. Overall Verdict`,
		`_Phase C stub. Pending real analysis._`,
		``,
	].join("\n");
}
