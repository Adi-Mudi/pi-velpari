/**
 * Interactive path browser (L2).
 *
 * Port of the picker helpers from Senai's `commands/_shared.ts`
 * (browsePath, normalizePath, isPathConflict, SUGGESTION_PAGE_SIZE,
 * isFolderLike, PickerMode). Nothing else from `_shared.ts` is ported.
 * Directory reads go through the L0 helpers in `core/files-discovery.ts`
 * (safeReadDir / isExcluded); rows are rendered with `./simple-picker.js`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { safeReadDir, isExcluded } from "../core/files-discovery.js";
import { runSimplePicker } from "./simple-picker.js";

export const SUGGESTION_PAGE_SIZE = 10;

export type PickerMode = "folder" | "file" | "both";

export function normalizePath(input: string): string {
	return input.replace(/\\/g, "/");
}

export function isFolderLike(dir: string, entry: fs.Dirent): boolean {
	if (entry.isDirectory()) return true;
	if (entry.isSymbolicLink()) {
		try {
			return fs.statSync(path.join(dir, entry.name)).isDirectory();
		} catch {
			return false;
		}
	}
	return false;
}

export async function browsePath(
	ctx: ExtensionContext,
	cwd: string,
	mode: PickerMode,
	excludedPaths: string[],
): Promise<string | null> {
	const root = path.resolve(cwd);
	let currentDir = root;

	while (true) {
		const relativeDir = path.relative(root, currentDir).replace(/\\/g, "/") || "";
		const prefix = relativeDir ? `${relativeDir}/` : "";
		const entries = safeReadDir(currentDir)
			.filter((e) => {
				if (e.name.startsWith(".") && e.name !== ".github") return false;
				const rel = `${prefix}${e.name}${isFolderLike(currentDir, e) ? "/" : ""}`;
				return !isExcluded(rel, excludedPaths);
			})
			.sort((a, b) => {
				if (isFolderLike(currentDir, a) && !isFolderLike(currentDir, b)) return -1;
				if (!isFolderLike(currentDir, a) && isFolderLike(currentDir, b)) return 1;
				return a.name.localeCompare(b.name);
			});

		const pickerItems: { id: string; label: string }[] = [];
		if (relativeDir && mode !== "file") {
			pickerItems.push({ id: "select-current", label: `📁 Select this folder (${relativeDir}/)` });
		}
		for (const entry of entries) {
			if (isFolderLike(currentDir, entry)) {
				pickerItems.push({ id: `dir:${entry.name}`, label: `📂 ${entry.name}/` });
			} else if (mode !== "folder") {
				pickerItems.push({ id: `file:${entry.name}`, label: `📄 ${entry.name}` });
			}
		}
		if (currentDir !== root) {
			pickerItems.push({ id: "up", label: "⬆️ ../" });
		}
		pickerItems.push({ id: "cancel", label: "❌ Cancel" });

		const title = relativeDir ? `Browsing ${relativeDir}/` : "Browsing project root";
		const choice = await runSimplePicker(ctx, { title, items: pickerItems });

		if (choice === "cancel") return null;
		if (choice === undefined) continue;
		if (choice === "up") {
			currentDir = path.dirname(currentDir);
			continue;
		}
		if (choice === "select-current") {
			return `${relativeDir}/`;
		}
		if (choice.startsWith("dir:")) {
			currentDir = path.join(currentDir, choice.slice(4));
			continue;
		}
		if (choice.startsWith("file:")) {
			const name = choice.slice(5);
			return relativeDir ? `${relativeDir}/${name}` : name;
		}
	}
}

export function isPathConflict(path: string, current: string[], other: string[]): boolean {
	for (const existing of current) {
		if (existing === path) return true;
		if (existing.endsWith("/")) {
			if (path.startsWith(existing)) return true;
		}
		if (path.endsWith("/")) {
			if (existing.startsWith(path)) return true;
		}
	}
	for (const existing of other) {
		if (existing === path) return true;
	}
	return false;
}
