/**
 * Multiplexer detection check (doctor layer — L1).
 *
 * Detection logic was promoted to `core/multiplexer.ts` (L0) so L1
 * handlers can gate on it without breaking the layer rule. This module
 * re-exports the detector to keep the doctor API stable, and keeps the
 * package-version probe here because it touches the filesystem (a layer-1
 * neighbor concern).
 *
 * Required for `/velpari-brainstorm v2.1` because the parent LLM spawns
 * visible subagents in multiplexer panes. The brainstorm handler now
 * hard-gates on `detectMultiplexer` so an orphan run can't be created
 * outside a multiplexer.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Re-export from L0. The doctor API is unchanged.
export {
	detectMultiplexer,
	isSupportedMux,
	multiplexerRequiredMessage,
	SUPPORTED_MULTIPLEXERS,
	type MultiplexerKind,
	type MultiplexerInfo,
} from "../../core/multiplexer.js";

/**
 * Candidate install **roots** (directories) for the
 * `pi-interactive-subagents` package, most-preferred first.
 *
 * Single source of truth for every probe that needs the plugin on disk
 * (its version for the min-version gate, its files for the herdr-backend
 * capability probe in `checks/herdr.ts`). Extracted from the previously
 * inlined list inside `detectInteractiveSubagentsVersion` — the order and
 * the paths are unchanged, so the version lookup behaves identically.
 *
 * @param {string} [cwd] - Project root (the bundled-location anchor).
 * @returns {string[]} Absolute candidate directories, best guess first.
 */
export function interactiveSubagentsCandidates(cwd: string = process.cwd()): string[] {
	return [
		// Bundled inside pi-velpari after pi install (new install model)
		join(cwd, "node_modules", "pi-interactive-subagents"),
		join(cwd, "..", "node_modules", "pi-interactive-subagents"),
		join(cwd, "..", "..", "node_modules", "pi-interactive-subagents"),
		// Legacy peer-dep install locations (still valid for older installs and dev symlinks)
		join(homedir(), ".pi", "agent", "extensions", "pi-interactive-subagents"),
		join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-interactive-subagents"),
		join(homedir(), ".pi", "agent", "git", "github.com", "HazAT", "pi-interactive-subagents"),
	];
}

/**
 * Resolve the first install root that actually holds a `package.json`.
 * Used by the herdr capability probe, which walks the package on disk.
 * Read-only; never throws.
 *
 * @param {string} [cwd] - Project root.
 * @returns {string | null} Absolute plugin directory, or `null` when absent.
 */
export function resolveInteractiveSubagentsRoot(cwd: string = process.cwd()): string | null {
	for (const root of interactiveSubagentsCandidates(cwd)) {
		try {
			if (existsSync(join(root, "package.json"))) return root;
		} catch {
			// ignore probe errors
		}
	}
	return null;
}

/**
 * Best-effort lookup for the pi-interactive-subagents package version.
 * Searches the most common install locations.
 */
export function detectInteractiveSubagentsVersion(cwd: string = process.cwd()): string | undefined {
	for (const root of interactiveSubagentsCandidates(cwd)) {
		try {
			const candidate = join(root, "package.json");
			if (existsSync(candidate)) {
				const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
				if (pkg.version) return pkg.version;
			}
		} catch {
			// ignore parse errors
		}
	}
	return undefined;
}
