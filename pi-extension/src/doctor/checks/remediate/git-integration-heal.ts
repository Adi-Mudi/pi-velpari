/**
 * `git-integration-heal` remediate (Doctor upgrade Phase 2 — U3).
 *
 * Auto-safe heal for the `Git integration` warnings (`git-attr-missing`,
 * `git-ignore-missing`): appends the missing store-DB binary attribute
 * and WAL sidecar ignore patterns to the USER repo's `.gitattributes` /
 * `.gitignore` via `ops/git-attributes.ts:ensureStoreGitIntegration` —
 * the exact same call the publish chain already makes (so the manual
 * warning and the auto-heal can never drift).
 *
 * Idempotent and low-blast-radius: `ensureStoreGitIntegration` only
 * appends lines that are absent (never rewrites/removes), and returns
 * the files it touched. L1 (doctor) imports L1 (ops) — same-layer, legal.
 */

import { ensureStoreGitIntegration } from "../../../ops/git-attributes.js";
import type { RemediateFn } from "./index.js";

export const fingerprint = "git-integration-heal" as const;

export const remediate: RemediateFn = async (ctx): Promise<{ changedFiles: string[] }> => {
	const result = ensureStoreGitIntegration(ctx.cwd);
	return { changedFiles: result.changedPaths };
};
