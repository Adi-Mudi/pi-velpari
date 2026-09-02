/**
 * Scout runner — reads a scout skill markdown and runs the scout function.
 * Per FR-54, NFR-13: same 30-second timeout, same JSON envelope.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScoutFn, ScoutId, ScoutInput, ScoutOutput } from "./contracts.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Wrap a promise with a timeout. Rejects with a clear error if the timeout
 * elapses.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number = DEFAULT_TIMEOUT_MS): Promise<T> {
	return await new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Scout timed out after ${ms}ms`));
		}, ms);
		promise
			.then((value) => {
				clearTimeout(timer);
				resolve(value);
			})
			.catch((err) => {
				clearTimeout(timer);
				reject(err);
			});
	});
}

/**
 * Read a scout skill markdown file. Returns an empty string if missing.
 */
export function readScoutSkill(scoutId: ScoutId, cwd: string = process.cwd()): string {
	const skillPath = join(cwd, "skills", "discuss-subagents", `${scoutId}.md`);
	if (!existsSync(skillPath)) return "";
	return readFileSync(skillPath, "utf8");
}

/**
 * Run a scout function with the standard 30-second timeout.
 * Returns the scout's output. If the scout throws or times out, returns
 * an empty output (so the main handler continues).
 */
export async function runScout<T>(
	scoutId: ScoutId,
	scoutFn: ScoutFn<T>,
	input: ScoutInput,
): Promise<ScoutOutput<T>> {
	try {
		return await withTimeout(scoutFn(input), DEFAULT_TIMEOUT_MS);
	} catch (err) {
		// Phase B: defensive — never let one scout failure crash the discussion.
		void err;
		return {
			proposals: [],
			source: scoutId,
			timestamp: new Date().toISOString(),
		};
	}
}
