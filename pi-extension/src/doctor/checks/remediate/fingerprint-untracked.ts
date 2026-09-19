/**
 * RemediateFn for `fingerprint-untracked` (Phase 2, Level B).
 *
 * Deterministic transformation: stamp SHA-256 fingerprints on every
 * RTM row that doesn't have one, using the fingerprints derived from
 * the published PSRS. Then re-render the published RTM markdown from
 * the JSON sidecar. No LLM in the loop.
 *
 * Idempotent: if every row already carries a fingerprint, the file is
 * not touched.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../../core/paths.js";
import {
	extractRequirementFingerprints,
	stampFingerprints,
} from "../../../core/fingerprints.js";
import { renderRtmMarkdown, type RtmData } from "../../../core/rtm-data.js";
import { atomicWriteFile } from "../../../io/atomic-write.js";
import type { RemediateFn, RemediateOutcome } from "./index.js";

export const fingerprint = "fingerprint-untracked" as const;

export const remediate: RemediateFn = async (ctx): Promise<RemediateOutcome> => {
	const rtm = resolveDocArtifact("RTM", ctx.projectName, ctx.cwd);
	if (!rtm) return { changedFiles: [] };
	const psrs = resolveDocArtifact("PRD", ctx.projectName, ctx.cwd);
	if (!psrs) return { changedFiles: [] };
	const jsonPath = rtm.path.replace(/\.md$/, ".json");
	if (!existsSync(jsonPath)) return { changedFiles: [] };

	let data: RtmData;
	try {
		data = JSON.parse(readFileSync(jsonPath, "utf8")) as RtmData;
	} catch {
		return { changedFiles: [] };
	}
	if (!Array.isArray(data.rows)) return { changedFiles: [] };

	const psrsContent = readFileSync(psrs.path, "utf8");
	const fingerprints = extractRequirementFingerprints(psrsContent);
	const newRows = stampFingerprints(data.rows, fingerprints);

	const anyChanged = newRows.some((r, i) => r.fingerprint !== data.rows[i]?.fingerprint);
	if (!anyChanged) return { changedFiles: [] };

	const newData: RtmData = { ...data, rows: newRows };
	atomicWriteFile(jsonPath, JSON.stringify(newData, null, 2), "utf8");
	atomicWriteFile(rtm.path, renderRtmMarkdown(newData), "utf8");

	return { changedFiles: [jsonPath, rtm.path] };
};
