/**
 * /velpari-configure-inputs support (FR-11, FR-49, FR-67).
 *
 * Pure + prompt helpers for the one-time project config persisted to
 * .pi/velpari/files.json. The interactive handler (interview + discovery-
 * backed path editing) lives in commands/configure-inputs.ts (L3) because
 * it needs the L2 widgets; this L1 file keeps the reusable pieces:
 * ask(), buildFilesConfig(), and buildPathCategoryItems().
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { FileDiscoveryResult } from "../core/files-discovery.js";
import type { FilesConfig } from "../core/config.js";

export async function ask(ctx: ExtensionCommandContext, prompt: string, required: boolean): Promise<string> {
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
	ctx.ui.notify(`Aborted after ${MAX_ATTEMPTS} empty attempts. Please run the command again with a value.`, "error");
	return "";
}

/** Interview answers that buildFilesConfig merges over the existing config. */
interface ConfigureAnswers {
	/** Legacy single-design projectName. v1.3.0+ accepts EITHER
	 *  `projectName` (single, legacy) or `projectNames` (multi-design).
	 *  Exactly one of the two must be set. */
	projectName: string;
	/** v1.3.0+ multi-design: array of 1+ projectNames. The configure
	 *  input interview accepts a comma-separated string and parses it.
	 *  When set, the resulting config drops `projectName` to "" (per
	 *  `validateFilesConfig` one-of requirement). */
	projectNames?: string[];
	language?: string;
	libraries: string[];
	runtime?: string;
}

/**
 * Pure builder (v4): merge interview answers over the existing config.
 * Path fields carry forward unchanged; the path-editing UI lives in
 * commands/configure-inputs.ts.
 */
export function buildFilesConfig(existing: FilesConfig, answers: ConfigureAnswers): FilesConfig {
	const hasMulti = Array.isArray(answers.projectNames) && answers.projectNames.length > 0;
	const merged: FilesConfig = {
		version: 4,
		projectName: hasMulti ? "" : (answers.projectName ?? ""),
		framework: {
			language: answers.language || existing.framework?.language,
			libraries: answers.libraries,
			runtime: answers.runtime || existing.framework?.runtime,
		},
		codePaths: existing.codePaths ?? [],
		inputDocuments: existing.inputDocuments ?? [],
		testPaths: existing.testPaths ?? [],
		outputPaths: existing.outputPaths ?? {},
		excludedPaths: existing.excludedPaths ?? [],
	};
	if (hasMulti) {
		merged.projectNames = (answers.projectNames ?? []).slice();
	}
	return merged;
}

/** Path categories editable in the configure-inputs path step. */
export type PathCategory = "codePaths" | "inputDocuments" | "testPaths" | "excludedPaths";

/**
 * Plain-data row for one path-category list editor. Structurally a subset
 * of ui/list-editor.ts's ListEditorItem (kind is only "suggestion" |
 * "selected"); kept as a local type because ops/ (L1) may not import ui/ (L2).
 */
export interface PathCategoryItem {
	id: string;
	kind: "suggestion" | "selected";
	label: string;
	description?: string;
	value: string;
}

interface Suggestion {
	path: string;
	reason?: string;
}

/** Discovery suggestions for one category (folders first, then files). */
function suggestionsFor(category: PathCategory, discovery: FileDiscoveryResult): Suggestion[] {
	switch (category) {
		case "codePaths":
			return [
				...discovery.codeFolders.map((f) => ({ path: f.path, reason: f.reason })),
				...discovery.codeFiles.map((p) => ({ path: p })),
			];
		case "inputDocuments":
			return [
				...discovery.documentFolders.map((f) => ({ path: f.path, reason: f.reason })),
				...discovery.documentFiles.map((p) => ({ path: p })),
			];
		case "testPaths":
			return [
				...discovery.testFolders.map((f) => ({ path: f.path, reason: f.reason })),
				...discovery.testFiles.map((p) => ({ path: p })),
			];
		case "excludedPaths":
			return [];
	}
}

/**
 * Local copy of ui/browse-path.ts's isPathConflict. ops/ (L1) cannot import
 * ui/ (L2), and the check is small: equality with a current value, folder-
 * prefix overlap in either direction, or equality with a path already
 * claimed by another category.
 */
function hasPathConflict(candidate: string, current: readonly string[], other: readonly string[]): boolean {
	for (const existing of current) {
		if (existing === candidate) return true;
		if (existing.endsWith("/") && candidate.startsWith(existing)) return true;
		if (candidate.endsWith("/") && existing.startsWith(candidate)) return true;
	}
	for (const existing of other) {
		if (existing === candidate) return true;
	}
	return false;
}

/**
 * Pure builder (Senai buildCategoryItems equivalent): map discovery
 * suggestions for one category into ⬜-suggestion rows and current values
 * into ✅-selected rows. Suggestions that conflict with a current value
 * (equality or folder-prefix overlap either way) or with a path selected
 * in another category (equality, via otherPaths) are filtered out.
 * excludedPaths never yields suggestions.
 */
export function buildPathCategoryItems(
	category: PathCategory,
	current: readonly string[],
	discovery: FileDiscoveryResult,
	otherPaths: readonly string[] = [],
): PathCategoryItem[] {
	const items: PathCategoryItem[] = [];
	for (const suggestion of suggestionsFor(category, discovery)) {
		if (hasPathConflict(suggestion.path, current, otherPaths)) continue;
		const item: PathCategoryItem = {
			id: `suggest:${suggestion.path}`,
			kind: "suggestion",
			label: `⬜ Suggest: ${suggestion.path}`,
			value: suggestion.path,
		};
		if (suggestion.reason) item.description = suggestion.reason;
		items.push(item);
	}
	for (const p of current) {
		items.push({
			id: `selected:${p}`,
			kind: "selected",
			label: `✅ Remove: ${p}`,
			value: p,
		});
	}
	return items;
}
