/**
 * RemediateFn registry (Phase 2, Level B).
 *
 * Each entry exports a `RemediateFn` keyed by fingerprint string. The
 * fingerprint MUST also be present in `SAFE_WHITELIST` (cross-checked
 * at runtime by `doctor/remediate.ts:runRemediate`).
 */

import { remediate as frontmatter } from "./frontmatter.js";
import { remediate as fingerprintUntracked } from "./fingerprint-untracked.js";
import { remediate as workingPublishedDrift } from "./working-published-drift.js";

export interface RemediateContext {
	cwd: string;
	projectName: string;
}

export interface RemediateOutcome {
	/** Absolute paths the remediate fn modified (for logging / notify). */
	changedFiles: string[];
}

export type RemediateFn = (ctx: RemediateContext) => Promise<RemediateOutcome>;

/**
 * Map of fingerprint → RemediateFn. The dispatcher in
 * `doctor/fix-dispatch.ts` reads this when handling `kind: "all-safe"`
 * (Phase 2) or `kind: "fix-one"` for an `auto-safe` item.
 */
export const REMEDIATE_FNS: Readonly<Record<string, RemediateFn>> = {
	"frontmatter-missing": frontmatter,
	"fingerprint-untracked": fingerprintUntracked,
	"working-published-drift": workingPublishedDrift,
};
