// ============================================================================
// core/project-type.ts — N26 project-type contract accessor — Layer 0
// ============================================================================
// Phase D consumes Phase B's `projectType` files.json key ("backend" |
// "full-app") WITHOUT touching B-owned core/config.ts (instruction §2.6/G1):
//
//   - read BOTH locations — top-level `projectType` FIRST, then
//     `velpari.projectType` (user decision 2026-09-28);
//   - absent → "backend" (default = no wireframe = backward compatible);
//   - present but not a legal value → throw (same throw-on-invalid idiom as
//     retentionConfig/devLaneConfig — a typo must surface, not silently flip
//     a project's wireframe mode);
//   - the key is NEVER redefined or written here — this module only reads it
//     through a structural `unknown` window, so it compiles whether or not
//     B has already typed the field on FilesConfig.
//
// Also home to the pure N26 helper used by the Stage-5 flow: the
// approve-side pairing message (self-healing — names path + fix).
// (The prompt-path wireframe filter was DELETED in Phase 4 — D-F3: no
// stage prompt ever lists a wireframe path, so the filter was a no-op.)
// ============================================================================

import { loadFilesConfig } from "./config.js";

/** Project kinds N26 distinguishes: only `full-app` carries a wireframe. */
export type ProjectType = "backend" | "full-app";

/** Default for every project until B's key lands (backward compatible). */
export const DEFAULT_PROJECT_TYPE: ProjectType = "backend";

/**
 * Narrow one raw `projectType` value (top-level or `velpari.` nested).
 * @param {unknown} value - The raw config value (may be undefined).
 * @param {string} where - Where it was read from (error context).
 * @returns {ProjectType | undefined} The value when legal, undefined when absent.
 * @throws {Error} When present but not "backend" | "full-app".
 */
function narrowProjectType(value: unknown, where: string): ProjectType | undefined {
	if (value === undefined) return undefined;
	if (value === "backend" || value === "full-app") return value;
	throw new Error(`files.json ${where} is invalid: expected "backend" | "full-app" (got ${JSON.stringify(value)}).`);
}

/**
 * Read B's `projectType` contract key — top-level first, then
 * `velpari.projectType` (decision: both locations, top-level wins).
 * @param {unknown} config - A loaded files.json object (untyped on purpose).
 * @returns {ProjectType} The resolved project type; "backend" when absent.
 * @throws {Error} When a present value is neither "backend" nor "full-app".
 */
export function projectTypeOf(config: unknown): ProjectType {
	if (typeof config !== "object" || config === null || Array.isArray(config)) return DEFAULT_PROJECT_TYPE;
	const record = config as Record<string, unknown>;
	const topLevel = narrowProjectType(record.projectType, "projectType");
	if (topLevel !== undefined) return topLevel;
	const nestedBlock = record.velpari;
	const nested =
		typeof nestedBlock === "object" && nestedBlock !== null && !Array.isArray(nestedBlock)
			? narrowProjectType((nestedBlock as Record<string, unknown>).projectType, "velpari.projectType")
			: undefined;
	return nested ?? DEFAULT_PROJECT_TYPE;
}

/**
 * cwd convenience overload: load files.json and resolve its project type.
 * @param {string} [cwd] - Project root holding files.json.
 * @returns {ProjectType} The resolved project type; "backend" when absent.
 * @throws {Error} When a present value is neither "backend" nor "full-app".
 */
export function projectTypeForCwd(cwd?: string): ProjectType {
	return projectTypeOf(loadFilesConfig(cwd));
}

/**
 * Self-healing gate message for a full-app design publish without its paired
 * wireframe working copy (N26 both-or-neither rule).
 * @param {string} expectedPath - Absolute path of the expected working copy.
 * @returns {string} The blocking message (names path + exact fix).
 */
export function wireframePairingMissingMessage(expectedPath: string): string {
	return (
		`Full-app project: the design publishes only with its paired wireframe — expected ${expectedPath}. ` +
		`Write wireframe_<projectName>.md beside the design working copy (see skills/velpari-architecture-generator.md, ` +
		`section "Wireframe pairing (full-app only)"), then re-run the approve.`
	);
}
