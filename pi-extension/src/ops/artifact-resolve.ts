/**
 * N24-20 — resolve an approved artifact from EITHER a `Doc/` file or the
 * DB-only store.
 *
 * DB-only publish (Phase 11 default) writes store rows + the exported YAML
 * beside the DB and never touches `Doc/`, so `resolveDocArtifact` alone made
 * `/velpari-handoff` impossible on the shipped default. This helper tries the
 * file first (legacy + `markdownWrites` projects keep their exact behaviour)
 * and falls back to the store's exported YAML.
 *
 * Lives in `ops/` rather than `core/` on purpose: L0 `core/paths.ts` must not
 * import `io/store.ts` (layering + cycle). Reuses the `ARTIFACT_TO_KIND` map
 * from `core/upstream.ts` so the artifact→kind table has one owner.
 *
 * D2 open item resolved: `test-plan` and `test-cases` both map to kind
 * `testplan`, whose YAML label is `test-plan`, so BOTH document entries point
 * at the same exported YAML — that is the intended convention, not a bug.
 *
 * Note: the exported YAML is written by the same publish that writes the
 * store rows, so a published kind implies the sidecar exists. We deliberately
 * do not re-stat it here; a missing sidecar is a data-integrity fault the
 * doctor reports, and resolving to it keeps the "no published store head"
 * error message honest.
 */

import { ARTIFACT_TO_KIND } from "../core/upstream.js";
import { buildStoreYamlPath, resolveDocArtifact } from "../core/paths.js";
import { readLatestPublishedRows } from "../io/store.js";
import { KIND_LABELS } from "./export-doc.js";

/** Which source satisfied a resolved artifact (N24-20 marker). */
export type ArtifactSource = "file" | "store";

/** A resolved artifact: where it lives and how it was found. */
export interface ResolvedArtifact {
	/** Absolute on-disk path (grouped/legacy `Doc/` markdown, or the store's exported YAML). */
	path: string;
	/** `"file"` for a `Doc/` markdown, `"store"` for the store's exported YAML. */
	source: ArtifactSource;
}

/**
 * Resolve one artifact from the `Doc/` tree first, then the DB store.
 *
 * @param {string} artifact - REQUIRED_TYPES artifact key (e.g. `PRD`, `test-plan`).
 * @param {string} projectName - Project whose artifacts to resolve.
 * @param {string} [cwd=process.cwd()] - Project root.
 * @returns {ResolvedArtifact | null} Null when neither a `Doc/` file nor a
 * published store head exists for the artifact.
 */
export function resolveArtifactAnywhere(
	artifact: string,
	projectName: string,
	cwd: string = process.cwd(),
): ResolvedArtifact | null {
	const file = resolveDocArtifact(artifact, projectName, cwd);
	if (file) return { path: file.path, source: "file" };

	const kind = ARTIFACT_TO_KIND[artifact.toLowerCase()];
	if (!kind) return null;
	const store = readLatestPublishedRows(cwd, projectName, kind);
	if (!store) return null;

	return { path: buildStoreYamlPath(projectName, KIND_LABELS[kind], cwd), source: "store" };
}
