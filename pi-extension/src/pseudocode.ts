/**
 * /velpari-pseudocode handler.
 *
 * Flow:
 * 1. Read Doc/design_<projectName>.md (gate check)
 * 2. Read projectName
 * 3. Compose prompt with loadStageSkill("writing-pseudocode")
 * 4. Write working copy at .IDE_Plans/velpari/runs/<run-id>/pseudocode/pseudocode_<projectName>.md
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

export async function handlePseudocode(
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

	const designPath = join(cwd, buildOutputPath("design", projectName));
	if (!existsSync(designPath)) {
		ctx.ui.notify(`Design not found at ${designPath}. Run /velpari-design first.`, "error");
		return;
	}

	const runDir = buildRunDir(state.runId, cwd);
	const pseudoDir = join(runDir, "pseudocode");
	mkdirSync(pseudoDir, { recursive: true });

	const content = renderPseudocodeStub(projectName);
	const workingPath = join(pseudoDir, `pseudocode_${projectName}.md`);
	writeFileSync(workingPath, content, "utf8");

	const targetPath = buildOutputPath("pseudocode", projectName);
	const confirmed = await ctx.ui.confirm(
		"Publish pseudocode?",
		`Working copy written to ${workingPath}. Publish to ${targetPath}?`,
	);
	if (confirmed) {
		ctx.ui.notify("Pseudocode drafted. Run /velpari-approve to publish.", "info");
	}
}

function renderPseudocodeStub(projectName: string): string {
	return [
		`# Pseudocode — ${projectName}`,
		``,
		`## Module: <name>`,
		``,
		`### Function: <function-name>`,
		``,
		"```pseudo",
		`FUNCTION <name>(inputs):`,
		`  preconditions: <list>`,
		`  postconditions: <list>`,
		``,
		`  step 1`,
		`  step 2`,
		`  RETURN <output>`,
		"```",
		``,
		`_Phase C stub. Real function blocks derive from design._`,
		``,
	].join("\n");
}
