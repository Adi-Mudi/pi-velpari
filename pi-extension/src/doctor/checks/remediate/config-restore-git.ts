/**
 * `config-restore-git` remediate (Phase C, G3 — Subphase 3.3).
 *
 * Auto-safe restore: for each tracked config file that exists but is
 * JSON-INVALID, restores the last committed version via
 * `config-manifest.ts:restoreFromGitHead` — only when the path is git
 * tracked AND has a HEAD version; otherwise the file is left untouched
 * (`changedFiles: []`). Valid or absent files are never touched.
 *
 * Deliberately narrow: a config that is valid-but-drifted is the
 * HUMAN's call (the interactive `config-baseline` item), never auto-safe.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TRACKED_CONFIGS, restoreFromGitHead } from "../../config-manifest.js";
import type { RemediateFn } from "./index.js";

export const fingerprint = "config-restore-git" as const;

export const remediate: RemediateFn = async (ctx): Promise<{ changedFiles: string[] }> => {
	const changed: string[] = [];
	for (const rel of DEFAULT_TRACKED_CONFIGS) {
		const abs = join(ctx.cwd, rel);
		if (!existsSync(abs)) continue;
		try {
			JSON.parse(readFileSync(abs, "utf8"));
			continue; // valid JSON → not a restore candidate
		} catch {
			/* invalid JSON → restore candidate */
		}
		const result = restoreFromGitHead(ctx.cwd, rel);
		if (result.restored) changed.push(abs);
	}
	return { changedFiles: changed };
};
