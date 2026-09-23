/**
 * RemediateFn for `working-published-drift` (Phase 2, Level B).
 *
 * Deterministic transformation: copy the latest working copy in
 * `.IDE_Plans/velpari/runs/<runId>/<category>/` over the published
 * copy in `Doc/`. Skips categories with no working copy (the working
 * copy is regenerated each stage publish, so absence is normal).
 *
 * Idempotent: if working copy equals published copy (post-publish), the
 * files match and nothing changes. The byte-for-byte equality check is
 * intentionally strict — we don't write unless content actually
 * differs, so atomic write mtimes stay stable.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../../core/paths.js";
import { buildWorkingGroupedPath, categoryFor } from "../../../core/paths.js";
import { loadState } from "../../../core/state.js";
import { atomicWriteFile } from "../../../io/atomic-write.js";
import type { RemediateFn, RemediateOutcome } from "./index.js";

export const fingerprint = "working-published-drift" as const;

/** Every artifact that has both a working and a published copy. */
const ARTIFACTS: readonly string[] = [
	"PRD",
	"RTM",
	"feasibility-study",
	"design",
	"pseudocode",
	"test-plan",
	"test-cases",
	"atomic-functions",
	"development-order",
];

export const remediate: RemediateFn = async (ctx): Promise<RemediateOutcome> => {
	const state = loadState(ctx.cwd);
	if (!state) return { changedFiles: [] };

	const changedFiles: string[] = [];
	for (const artifact of ARTIFACTS) {
		const category = categoryFor(artifact);
		if (!category) continue;
		const workingPath = buildWorkingGroupedPath(ctx.cwd, state.runId, artifact, ctx.projectName);
		if (!existsSync(workingPath)) continue;

		const pub = resolveDocArtifact(artifact, ctx.projectName, ctx.cwd);
		if (!pub) continue;

		const workingContent = readFileSync(workingPath, "utf8");
		let pubContent: string;
		try {
			pubContent = readFileSync(pub.path, "utf8");
		} catch {
			continue;
		}

		if (workingContent !== pubContent) {
			atomicWriteFile(pub.path, workingContent, "utf8");
			changedFiles.push(pub.path);
		}
	}
	return { changedFiles };
};
