/**
 * Working vs published separation check.
 *
 * Counts markdown files in the working-copy tree
 * (`<runDir>/<category>/`) and the published tree (`Doc/`).
 *
 * Phase 1: returns a DiagnosticSection.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GROUPED_CATEGORIES } from "../../../core/paths.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";

export function checkWorkingPublishedSeparationSection(
	cwd: string,
	projectName: string,
): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const docsDir = join(cwd, "Doc");
	const workingRoot = join(cwd, ".IDE_Plans", "velpari", "runs");

	if (!existsSync(workingRoot)) {
		items.push({
			status: "info",
			message: "No working runs present under `.IDE_Plans/velpari/runs/`.",
		});
		return { title: "Working / published separation", items };
	}

	let workingCount = 0;
	for (const entry of readdirSync(workingRoot)) {
		const runDir = join(workingRoot, entry);
		for (const cat of Object.values(GROUPED_CATEGORIES)) {
			const wcDir = join(runDir, cat);
			if (existsSync(wcDir)) {
				const files = readdirSync(wcDir).filter((f) => f.endsWith(".md"));
				workingCount += files.length;
			}
		}
	}

	let publishedCount = 0;
	if (existsSync(docsDir)) {
		const recurse = (dir: string): number => {
			let n = 0;
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				if (e.isDirectory()) n += recurse(join(dir, e.name));
				else if (e.name.endsWith(".md")) n += 1;
			}
			return n;
		};
		publishedCount = recurse(docsDir);
	}

	const groupedKeys = Object.keys(GROUPED_CATEGORIES);
	const groupedCats = Object.values(new Set(Object.values(GROUPED_CATEGORIES))).join(", ");
	items.push({
		status: "ok",
		message: `Working copies: ${workingCount} | Published docs: ${publishedCount}`,
		details: [
			`Grouped categories (${groupedKeys.length}): ${groupedCats}`,
			`Project under audit: ${projectName || "(none — projectName missing)"}`,
		],
	});

	return { title: "Working / published separation", items };
}
