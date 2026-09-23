/**
 * Multi-design projectNames registry (v1.3.0).
 *
 * Single source of truth for "what design subjects live in this CWD".
 * A workspace can carry one design (legacy `projectName: string`) or
 * several (new `projectNames: string[]` for a federation of services).
 * The `getEffectiveProjectNames` helper returns the canonical list that
 * every other module (paths, doctor, status, prelude) consumes.
 *
 * No IO. Pure data + small helpers.
 */

import type { FilesConfig } from "./config.js";

/**
 * Return the canonical list of projectNames for a config. Length 1
 * for the legacy single-design path; length ≥ 1 for the new multi-design
 * path. Throws if neither or both are set (caller catches and surfaces
 * a config error).
 */
export function getEffectiveProjectNames(cfg: FilesConfig): string[] {
	const single = (cfg as unknown as { projectName?: string }).projectName;
	const multi = (cfg as unknown as { projectNames?: string[] }).projectNames;

	const hasSingle = typeof single === "string" && single.length > 0;
	const hasMulti = Array.isArray(multi) && multi.length > 0;

	if (hasSingle && hasMulti) {
		throw new Error("files.json sets both `projectName` and `projectNames` — exactly one is required.");
	}
	if (!hasSingle && !hasMulti) {
		throw new Error("files.json must set either `projectName` (single design) or `projectNames` (multi-design).");
	}
	if (hasMulti) {
		// De-duplicate while preserving order. Throw on empty strings.
		const seen = new Set<string>();
		const out: string[] = [];
		for (const n of multi as string[]) {
			if (typeof n !== "string" || n.length === 0) {
				throw new Error("`projectNames` entries must be non-empty strings.");
			}
			if (!seen.has(n)) {
				seen.add(n);
				out.push(n);
			}
		}
		if (out.length === 0) {
			throw new Error("`projectNames` must contain at least one entry.");
		}
		return out;
	}
	return [single as string];
}

/**
 * True when the config declares multiple distinct designs.
 */
export function isMultiProject(cfg: FilesConfig): boolean {
	return getEffectiveProjectNames(cfg).length > 1;
}
