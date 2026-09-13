/**
 * /velpari-configure-inputs command (L3 composition).
 *
 * Full interactive flow: headless gate → 4-question interview (ask +
 * buildFilesConfig from ops/) → discovery-backed path editing loop
 * (outer simple-picker over code/docs/tests/excluded + per-category
 * list editor, mirroring Senai's /senai-configure-files) → save.
 * Esc out of the outer loop cancels WITHOUT saving.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig, saveFilesConfig, type FilesConfig } from "../core/config.js";
import { discoverProjectFiles, type FileDiscoveryResult } from "../core/files-discovery.js";
import {
	ask,
	buildFilesConfig,
	buildPathCategoryItems,
} from "../ops/configure-inputs.js";
import { runSimplePicker } from "../ui/simple-picker.js";
import { runListEditor } from "../ui/list-editor.js";
import {
	SUGGESTION_PAGE_SIZE,
	browsePath,
	isPathConflict,
	normalizePath,
	type PickerMode,
} from "../ui/browse-path.js";

type EditableCategory = "codePaths" | "inputDocuments" | "testPaths";

export function registerConfigureInputsCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-configure-inputs", {
		description: "Real handler for /velpari-configure-inputs (Phase 7).",
		handler: async (_args, ctx) => {
			await handleConfigureInputs(ctx);
		},
	});
}

async function handleConfigureInputs(ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.hasUI === false) {
		ctx.ui.notify(
			"This command needs an interactive terminal (TUI). It does nothing in headless mode.",
			"warning",
		);
		return;
	}
	const cwd = ctx.cwd;
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

	const config = buildFilesConfig(existing, { projectName, language, libraries, runtime });

	// Discovery scan runs ONCE, against the excluded paths already on disk.
	const discovery = discoverProjectFiles(cwd, existing.excludedPaths);

	let editing = true;
	let finished = false;
	while (editing) {
		const choice = await runSimplePicker(ctx, {
			title: `Project paths — ${config.codePaths.length} code, ${config.inputDocuments.length} docs, ${config.testPaths.length} tests, ${config.excludedPaths.length} excluded`,
			items: [
				{ id: "code", label: "Edit code paths" },
				{ id: "docs", label: "Edit input documents" },
				{ id: "tests", label: "Edit test paths" },
				{ id: "excluded", label: "Edit excluded paths" },
				{ id: "finish", label: "Finish" },
			],
		});

		if (choice === "code" || choice === "docs" || choice === "tests") {
			const category: EditableCategory =
				choice === "code" ? "codePaths" : choice === "docs" ? "inputDocuments" : "testPaths";
			await editCategory(ctx, cwd, config, category, discovery);
		} else if (choice === "excluded") {
			await editExcludedPaths(ctx, cwd, config);
		} else if (choice === "finish") {
			finished = true;
			editing = false;
		} else {
			// Esc / cancel out of the outer loop: nothing is saved.
			editing = false;
		}
	}

	if (!finished) {
		ctx.ui.notify("Cancelled — no configuration changes were saved.", "info");
		return;
	}

	saveFilesConfig(config, cwd);
	ctx.ui.notify(
		`Configuration saved: projectName="${config.projectName}". Next: /velpari-brainstorm <mission>`,
		"info",
	);
}

function getAllSelectedPaths(config: FilesConfig): string[] {
	return [...config.codePaths, ...config.inputDocuments, ...config.testPaths];
}

async function editCategory(
	ctx: ExtensionCommandContext,
	cwd: string,
	config: FilesConfig,
	category: EditableCategory,
	discovery: FileDiscoveryResult,
): Promise<void> {
	let filterQuery = "";
	let editing = true;

	while (editing) {
		const otherPaths = getAllSelectedPaths(config).filter((p) => !config[category].includes(p));
		const action = await runListEditor(ctx, {
			title: `${category} (${config[category].length} selected)`,
			items: buildPathCategoryItems(category, config[category], discovery, otherPaths),
			filterQuery,
			enableFilter: true,
			customActions: [{ id: "add-custom", label: "Add custom path" }],
			pageSize: SUGGESTION_PAGE_SIZE,
		});

		switch (action.kind) {
			case "back":
				editing = false;
				break;
			case "done":
				config[category] = action.paths;
				editing = false;
				break;
			case "filter":
				config[category] = action.paths;
				filterQuery = action.query;
				break;
			case "custom": {
				config[category] = action.paths;
				const mode: PickerMode = category === "inputDocuments" ? "both" : "folder";
				const picked = await browsePath(ctx, cwd, mode, config.excludedPaths);
				if (picked) {
					const normalized = normalizePath(picked);
					if (!isPathConflict(normalized, config[category], otherPaths)) {
						config[category].push(normalized);
					}
				}
				break;
			}
		}
	}
}

async function editExcludedPaths(
	ctx: ExtensionCommandContext,
	cwd: string,
	config: FilesConfig,
): Promise<void> {
	let editing = true;
	while (editing) {
		const action = await runListEditor(ctx, {
			title: `Excluded paths (${config.excludedPaths.length})`,
			items: config.excludedPaths.map((p) => ({
				id: `selected:${p}`,
				kind: "selected" as const,
				label: `✅ Remove: ${p}`,
				value: p,
			})),
			customActions: [{ id: "add-excluded", label: "Add excluded path" }],
		});

		switch (action.kind) {
			case "back":
				editing = false;
				break;
			case "done":
				config.excludedPaths = action.paths;
				editing = false;
				break;
			case "filter":
				config.excludedPaths = action.paths;
				break;
			case "custom": {
				config.excludedPaths = action.paths;
				const picked = await browsePath(ctx, cwd, "folder", config.excludedPaths);
				if (picked) {
					config.excludedPaths.push(normalizePath(picked));
				}
				break;
			}
		}
	}
}
