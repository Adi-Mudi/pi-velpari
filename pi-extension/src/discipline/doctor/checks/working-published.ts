/**
 * Working vs published separation check.
 *
 * Counts markdown files in the working-copy tree
 * (`<runDir>/<category>/`) and the published tree (`Doc/`),
 * then prints a single summary line per project.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GROUPED_CATEGORIES } from "../../../core/paths.js";

export function checkWorkingPublishedSeparation(cwd: string, projectName: string, lines: string[]): void {
	const docsDir = join(cwd, "Doc");
	const workingRoot = join(cwd, ".IDE_Plans", "velpari", "runs");
	lines.push("### Working / published separation");
	if (!existsSync(workingRoot)) {
		lines.push("- No working runs present.");
		lines.push("");
		return;
	}
	let workingCount = 0;
	let publishedCount = 0;
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
	lines.push(`- Working copies under .IDE_Plans/velpari/runs/: ${workingCount}`);
	lines.push(`- Published docs under Doc/: ${publishedCount}`);
	const groupedKeys = Object.keys(GROUPED_CATEGORIES);
	const groupedCats = Object.values(new Set(Object.values(GROUPED_CATEGORIES))).join(", ");
	lines.push(`- Grouped categories: ${groupedKeys.length} -> ${groupedCats}`);
	lines.push(`- Project under audit: ${projectName || "(none - projectName missing)"}`);
	lines.push("");
}
