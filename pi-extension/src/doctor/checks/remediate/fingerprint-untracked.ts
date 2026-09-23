/**
 * RemediateFn for `fingerprint-untracked` (Phase 2, Level B) — now
 * READ-ONLY for DB-backed RTMs (Phase 7, OQ2: locked decision 2).
 *
 * DB path (store has published RTM rows): NO write. Fingerprints on
 * DB-backed RTMs are stamped by the publish chain (`rtm_row.target_sha256`,
 * written by runDbPublish), and `/velpari-reconfirm` is the sanctioned
 * re-stamp path after input changes. A second write path here would
 * violate D2's single-writer discipline and dirty the committed DB.
 * Returns an outcome that points at the sanctioned flows.
 *
 * Legacy path (no store rows — pre-store project): the exact Phase 2
 * behavior (sidecar re-stamp + re-render), since a legacy project has
 * no DB write path to protect.
 */

import { readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../../core/paths.js";
import { extractRequirementFingerprints, stampFingerprints } from "../../../core/fingerprints.js";
import { renderRtmMarkdown, resolveRtmSidecar, type RtmData } from "../../../core/rtm-data.js";
import { readLatestPublishedRows } from "../../../io/store.js";
import { readYamlFile, writeYamlFile } from "../../../core/yaml-data.js";
import { atomicWriteFile } from "../../../io/atomic-write.js";
import type { RemediateFn, RemediateOutcome } from "./index.js";

export const fingerprint = "fingerprint-untracked" as const;

export const remediate: RemediateFn = async (ctx): Promise<RemediateOutcome> => {
	// DB-backed RTM: read-only — the publish chain + /velpari-reconfirm
	// own the write path (OQ2). Report no changed files; the suggestion
	// text in fix-suggestions.ts carries the pointer.
	const fromDb = readLatestPublishedRows(ctx.cwd, ctx.projectName, "rtm");
	if (fromDb) {
		return { changedFiles: [] };
	}

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
