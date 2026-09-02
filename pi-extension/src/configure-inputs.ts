/**
 * /velpari-configure-inputs handler (FR-11, FR-49, FR-67).
 *
 * Captures one-time project config and persists to .pi/velpari/files.json.
 * Prompts for: projectName (required), framework language (optional),
 * libraries (optional, comma-separated), runtime (optional).
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig, saveFilesConfig, type FilesConfig } from "./config.js";

async function ask(
	ctx: ExtensionCommandContext,
	prompt: string,
	required: boolean,
): Promise<string> {
	const MAX_ATTEMPTS = 3;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const answer = await ctx.ui.input(prompt);
		if (answer === undefined) return "";
		const trimmed = answer.trim();
		if (!required || trimmed.length > 0) {
			return trimmed;
		}
		ctx.ui.notify("This field is required. Please provide a value.", "error");
	}
	// Exceeded MAX_ATTEMPTS — abort gracefully
	ctx.ui.notify(
		`Aborted after ${MAX_ATTEMPTS} empty attempts. Please run the command again with a value.`,
		"error",
	);
	return "";
}

export async function handleConfigureInputs(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const existing = loadFilesConfig(cwd);

	// Project name (required, non-empty)
	const projectName = await ask(
		ctx,
		`Project name${existing.projectName ? ` (current: ${existing.projectName})` : ""}:`,
		true,
	);
	if (!projectName) {
		ctx.ui.notify("Project name is required. Aborting.", "error");
		return;
	}

	// Framework language (optional)
	const language = await ask(
		ctx,
		`Framework language (e.g., TypeScript, Python)${existing.framework?.language ? ` (current: ${existing.framework.language})` : ""}:`,
		false,
	);

	// Libraries (optional, comma-separated)
	const librariesRaw = await ask(
		ctx,
		`Libraries (comma-separated, optional)${existing.framework?.libraries?.length ? ` (current: ${existing.framework.libraries.join(", ")})` : ""}:`,
		false,
	);
	const libraries = librariesRaw
		? librariesRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
		: (existing.framework?.libraries ?? []);

	// Runtime (optional)
	const runtime = await ask(
		ctx,
		`Runtime (e.g., Node 20+, Python 3.11)${existing.framework?.runtime ? ` (current: ${existing.framework.runtime})` : ""}:`,
		false,
	);

	const config: FilesConfig = {
		version: 3,
		projectName,
		framework: {
			language: language || existing.framework?.language,
			libraries,
			runtime: runtime || existing.framework?.runtime,
		},
		inputDocuments: existing.inputDocuments ?? [],
		outputPaths: existing.outputPaths ?? {},
		excludedPaths: existing.excludedPaths ?? [],
	};

	saveFilesConfig(config, cwd);
	ctx.ui.notify(`Configuration saved: projectName="${projectName}".`, "info");
}
