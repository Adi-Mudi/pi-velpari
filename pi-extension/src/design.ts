/**
 * /velpari-design handler.
 *
 * Flow:
 * 1. Read Doc/feasibility-study_<projectName>.md (gate check)
 * 2. Read projectName
 * 3. Compose prompt with loadStageSkill("designing")
 * 4. Write working copy at .IDE_Plans/velpari/runs/<run-id>/design/design_<projectName>.md
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

export async function handleDesign(
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

	const feasPath = join(cwd, buildOutputPath("feasibility-study", projectName));
	if (!existsSync(feasPath)) {
		ctx.ui.notify(
			`Feasibility study not found at ${feasPath}. Run /velpari-feasibility first.`,
			"error",
		);
		return;
	}

	const runDir = buildRunDir(state.runId, cwd);
	const designDir = join(runDir, "design");
	mkdirSync(designDir, { recursive: true });

	const content = renderDesignStub(projectName);
	const workingPath = join(designDir, `design_${projectName}.md`);
	writeFileSync(workingPath, content, "utf8");

	const targetPath = buildOutputPath("design", projectName);
	const confirmed = await ctx.ui.confirm(
		"Publish design?",
		`Working copy written to ${workingPath}. Publish to ${targetPath}?`,
	);
	if (confirmed) {
		ctx.ui.notify("Design drafted. Run /velpari-approve to publish.", "info");
	}
}

function renderDesignStub(projectName: string): string {
	return [
		`# High-Level Design — ${projectName}`,
		``,
		`## 1. Module Breakdown`,
		``,
		`_Phase C stub. Real modules derive from feasibility + PRD._`,
		``,
		`## 2. Data Model`,
		``,
		`_Phase C stub._`,
		``,
		`## 3. Interface Contracts`,
		``,
		`_Phase C stub._`,
		``,
		`## 4. Data Flow`,
		``,
		`_Phase C stub._`,
		``,
	].join("\n");
}
