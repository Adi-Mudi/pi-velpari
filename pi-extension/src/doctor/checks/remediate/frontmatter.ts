/**
 * RemediateFn for `frontmatter-missing` (Phase 2, Level B).
 *
 * Deterministic transformation: restamp the canonical frontmatter
 * block on every published artifact under `Doc/`. Each artifact is
 * rewritten in place via `atomicWriteFile`. No LLM in the loop.
 *
 * Idempotent: running on a project with all frontmatter already
 * intact touches nothing.
 */

import { readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../../core/paths.js";
import {
	missingFrontmatterFields,
	withArtifactFrontmatter,
} from "../../../core/frontmatter.js";
import { atomicWriteFile } from "../../../io/atomic-write.js";
import type { RemediateFn, RemediateOutcome } from "./index.js";

export const fingerprint = "frontmatter-missing" as const;

/**
 * Every artifact the doctor audits for frontmatter. Keep in sync with
 * the artifact set enumerated in `doctor/checks/frontmatter.ts`.
 */
const ARTIFACT_KEYS: readonly string[] = [
	"PRD",
	"RTM",
	"brainstorm",
	"feasibility-study",
	"design",
	"pseudocode",
	"test-plan",
	"test-cases",
	"atomic-functions",
	"development-order",
];

export const remediate: RemediateFn = async (ctx): Promise<RemediateOutcome> => {
	const changedFiles: string[] = [];
	for (const artifact of ARTIFACT_KEYS) {
		const found = resolveDocArtifact(artifact, ctx.projectName, ctx.cwd);
		if (!found) continue;
		const existing = readFileSync(found.path, "utf8");
		// Gate on actual missing REQUIRED fields — `withArtifactFrontmatter`
		// always rewrites the `updated` timestamp, so an unconditional write
		// would break idempotency on the second run. And it only emits
		// `supersedes` / `sunset` / `deprecatedAt` when the input provides
		// them, so the canonical-fields list conflates required + optional;
		// we filter the optional trio out so we don't stamp them just to
		// "fill" them with empty values.
		const optional = new Set(["supersedes", "sunset", "deprecatedAt"]);
		const missing = missingFrontmatterFields(existing).filter(
			(f) => !optional.has(f),
		);
		if (missing.length === 0) continue;
		const stamped = withArtifactFrontmatter(existing, {
			artifact,
			project: ctx.projectName,
			stage: artifact,
			run: "auto-remediate",
		});
		atomicWriteFile(found.path, stamped, "utf8");
		changedFiles.push(found.path);
	}
	return { changedFiles };
};
