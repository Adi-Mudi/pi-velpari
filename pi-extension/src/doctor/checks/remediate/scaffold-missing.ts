/**
 * `scaffold-missing` remediate (Phase C, N23 — Subphase 3.3).
 *
 * Auto-safe scaffold: creates the missing standard dirs (`.IDE_Plans/
 * velpari/` + `runs/`, `Doc/` category folders) and records the config
 * baseline only when none exists — all through `ops/self-heal.ts`. Never
 * creates/edits `files.json`/`agents.json` content (that stays
 * `/velpari-configure-inputs`'s job). Idempotent: second run reports no
 * changes.
 *
 * `changedFiles` = the paths created this call (absolutes).
 */

import { join } from "node:path";
import { ensureStandardScaffold } from "../../../ops/self-heal.js";
import type { RemediateFn } from "./index.js";

export const fingerprint = "scaffold-missing" as const;

export const remediate: RemediateFn = async (ctx): Promise<{ changedFiles: string[] }> => {
	const result = ensureStandardScaffold(ctx.cwd);
	return { changedFiles: result.created.map((rel) => join(ctx.cwd, rel)) };
};
