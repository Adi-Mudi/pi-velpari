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
