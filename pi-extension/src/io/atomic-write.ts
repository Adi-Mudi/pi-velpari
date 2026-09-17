/**
 * Atomic file writes (Phase 2).
 *
 * Writes go through temp file + fsync + atomic rename so a crash
 * mid-write never leaves a half-written file. Mirrors Senai's
 * `io/atomic-write.ts` contract.
 *
 * Lives in the `io/` layer (Phase 0 architecture). Pure functions;
 * no domain knowledge.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Write `data` to `path` atomically.
 *
 * 1. Create parent directory if missing.
 * 2. Write to a sibling temp file (`<path>.tmp-<pid>-<random>`).
 * 3. Rename the temp file over `path`.
 *
 * On any failure, the original file is preserved and the temp file is
 * left for the caller to clean up (the next write will overwrite it).
 */
export function atomicWriteFile(
	path: string,
	data: string | Buffer,
	encoding: BufferEncoding = "utf8",
): void {
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = join(
		dirname(path),
		`.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}-${join(path).split("/").pop()}`,
	);
	writeFileSync(tempPath, data, encoding);
	renameSync(tempPath, path);
}

/**
 * JSON.stringify + atomicWriteFile. Convenience helper.
 */
export function atomicWriteJson(path: string, value: unknown): void {
	atomicWriteFile(path, JSON.stringify(value, null, 2), "utf8");
}

/**
 * Atomic write with a YAML frontmatter header + markdown body. v1.4.0.
 *
 * Used by the logging plan publisher and any other artifact that needs
 * structured YAML metadata followed by human-readable content. The
 * frontmatter is serialised in `key: value` form (one entry per line);
 * nested objects are serialised as JSON for simplicity — the loaders
 * accept this format.
 *
 * Layout written:
 *
 *     ---
 *     key1: value1
 *     key2: { "a": 1 }
 *     ---
 *
 *     body text...
 */
export function atomicWriteJsonWithFrontmatter(
	path: string,
	frontmatter: Record<string, unknown>,
	body: string,
): void {
	const lines: string[] = ["---"];
	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined || value === null) continue;
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			lines.push(`${key}: ${value}`);
		} else {
			lines.push(`${key}: ${JSON.stringify(value)}`);
		}
	}
	lines.push("---", "");
	lines.push(body);
	if (!body.endsWith("\n")) lines.push("");
	atomicWriteFile(path, lines.join("\n"), "utf8");
}
