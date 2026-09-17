/**
 * Generated-manifest persistence (Phase 2 of /velpari-generate-sub-agents).
 *
 * Tracks the sha256 hash of every agent file the generator wrote so
 * `/velpari-generate-sub-agents` can safely regenerate in place without
 * overwriting user-edited files.
 *
 * Lives at `<cwd>/.pi/velpari/generated-manifest.json`. Same shape as
 * Senai's `.pi/architect/generated-manifest.json`:
 *
 *   { version: 1, files: { "<relpath>": "<sha256>", ... } }
 *
 * Merge semantics: `addToGeneratedManifest` never wipes existing entries.
 *
 * Layer 0. Imports only `node:*` and `../io/atomic-write.js` (peer).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { atomicWriteJson } from "../io/atomic-write.js";

export const GENERATED_MANIFEST_FILE = "generated-manifest.json";
export const GENERATED_MANIFEST_DIR_SUBDIR = join(".pi", "velpari");

export interface GeneratedManifest {
	version: 1;
	files: Record<string, string>;
}

export function emptyManifest(): GeneratedManifest {
	return { version: 1, files: {} };
}

export function getGeneratedManifestPath(cwd: string): string {
	return join(cwd, GENERATED_MANIFEST_DIR_SUBDIR, GENERATED_MANIFEST_FILE);
}

/** Load the manifest from disk. Returns an empty default when:
 *  - the file does not exist
 *  - the file exists but is corrupt (not parseable as JSON)
 *  - the file has the wrong shape (version !== 1, files not an object)
 *  Never throws — the generator must work on a fresh project. */
export function loadGeneratedManifest(cwd: string): GeneratedManifest {
	const p = getGeneratedManifestPath(cwd);
	if (!existsSync(p)) return emptyManifest();
	try {
		const raw = readFileSync(p, "utf8");
		const parsed = JSON.parse(raw) as Partial<GeneratedManifest>;
		if (
			parsed.version === 1 &&
			typeof parsed.files === "object" &&
			parsed.files !== null &&
			!Array.isArray(parsed.files)
		) {
			return { version: 1, files: { ...parsed.files } };
		}
	} catch {
		// fall through to empty
	}
	return emptyManifest();
}

/** Save the manifest to disk atomically (temp file + rename). */
export function saveGeneratedManifest(cwd: string, manifest: GeneratedManifest): void {
	const p = getGeneratedManifestPath(cwd);
	atomicWriteJson(p, manifest);
}

/** Hash each path in `fileAbsPaths` and merge into the manifest under its
 *  project-relative key. Existing entries are preserved (merge, not wipe).
 *  Returns the merged manifest. Unreadable files are skipped. */
export function addToGeneratedManifest(
	cwd: string,
	fileAbsPaths: readonly string[],
): GeneratedManifest {
	const manifest = loadGeneratedManifest(cwd);
	for (const abs of fileAbsPaths) {
		const rel = relative(cwd, abs);
		try {
			const hash = createHash("sha256").update(readFileSync(abs)).digest("hex");
			manifest.files[rel] = hash;
		} catch {
			// Skip unreadable files.
		}
	}
	saveGeneratedManifest(cwd, manifest);
	return manifest;
}
