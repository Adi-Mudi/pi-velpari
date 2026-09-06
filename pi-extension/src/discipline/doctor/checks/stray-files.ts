/**
 * Stray files check (Phase 4b).
 *
 * Walks the project root and `.IDE_Plans/velpari/runs/` for leftover
 * `tmp_*.sh` / `tmp_*.ts` helper scripts. These are debris from
 * sub-agent heredoc workarounds — they should be reviewed and deleted.
 *
 * Mirrors Senai's checks-environment.checkStrayFiles.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";

const STRAY_PATTERN = /^tmp_.*\.(sh|ts)$/;
const MAX_DEPTH = 4;

export function checkStrayFiles(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const stray: string[] = [];

	// Project root — single-level scan.
	try {
		for (const entry of readdirSync(cwd)) {
			if (STRAY_PATTERN.test(entry)) stray.push(entry);
		}
	} catch {
		// Unreadable root — nothing to report.
	}

	// .IDE_Plans/velpari/runs/ — recursive scan up to MAX_DEPTH.
	const runsRoot = join(cwd, ".IDE_Plans", "velpari", "runs");
	walk(runsRoot, "", 0, stray);

	if (stray.length === 0) {
		items.push({
			status: "ok",
			message: "No stray tmp_* helper files in project root or runs/.",
		});
		return { title: "Stray files", items };
	}

	for (const rel of stray) {
		items.push({
			status: "warning",
			message: `Stray tmp_* helper file: ${rel}`,
			details: [
				"Leftover from a sub-agent heredoc workaround. Review and delete.",
			],
		});
	}
	items.push({
		status: "warning",
		message: `${stray.length} stray tmp_* helper file(s) found in total.`,
	});

	return { title: "Stray files", items };
}

function walk(dir: string, rel: string, depth: number, out: string[]): void {
	if (depth > MAX_DEPTH) return;
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
	} catch {
		return;
	}
	for (const entry of entries) {
		const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			walk(join(dir, entry.name), entryRel, depth + 1, out);
		} else if (STRAY_PATTERN.test(entry.name)) {
			const full = rel
				? join(".IDE_Plans", "velpari", "runs", entryRel).replace(/\\/g, "/")
				: entry.name;
			out.push(full);
		}
	}
}
