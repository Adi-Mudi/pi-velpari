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

import { readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../../core/paths.js";
import {
	extractRequirementFingerprints,
	stampFingerprints,
} from "../../../core/fingerprints.js";
import {
	renderRtmMarkdown,
	resolveRtmSidecar,
	type RtmData,
} from "../../../core/rtm-data.js";
import { readYamlFile, writeYamlFile } from "../../../core/yaml-data.js";
import { atomicWriteFile } from "../../../io/atomic-write.js";
import type { RemediateFn, RemediateOutcome } from "./index.js";

export const fingerprint = "fingerprint-untracked" as const;

export const remediate: RemediateFn = async (ctx): Promise<RemediateOutcome> => {
	const rtm = resolveDocArtifact("RTM", ctx.projectName, ctx.cwd);
	if (!rtm) return { changedFiles: [] };
	const psrs = resolveDocArtifact("PRD", ctx.projectName, ctx.cwd);
	if (!psrs) return { changedFiles: [] };
	// B3/D4: read .yaml or legacy .json; writes are always .yaml (the
	// legacy .json is left in place — dual-read prefers the .yaml).
	const sidecar = resolveRtmSidecar(rtm.path);
	if (!sidecar) return { changedFiles: [] };

	const data = readYamlFile(sidecar.path) as RtmData | null;
	if (!data || !Array.isArray(data.rows)) return { changedFiles: [] };

	const psrsContent = readFileSync(psrs.path, "utf8");
	const fingerprints = extractRequirementFingerprints(psrsContent);
	const newRows = stampFingerprints(data.rows, fingerprints);

	const anyChanged = newRows.some((r, i) => r.fingerprint !== data.rows[i]?.fingerprint);
	if (!anyChanged) return { changedFiles: [] };

	const newData: RtmData = { ...data, rows: newRows };
	const yamlPath = rtm.path.replace(/\.md$/, ".yaml");
	writeYamlFile(yamlPath, newData);
	atomicWriteFile(rtm.path, renderRtmMarkdown(newData), "utf8");

	return { changedFiles: [yamlPath, rtm.path] };
};
