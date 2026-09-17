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
 * Best-effort lookup for the pi-interactive-subagents package version.
 * Searches the most common install locations.
 */
export function detectInteractiveSubagentsVersion(cwd: string = process.cwd()): string | undefined {
	const candidates = [
		// Bundled inside pi-velpari after pi install (new install model)
		join(cwd, "node_modules", "pi-interactive-subagents", "package.json"),
		join(cwd, "..", "node_modules", "pi-interactive-subagents", "package.json"),
		join(cwd, "..", "..", "node_modules", "pi-interactive-subagents", "package.json"),
		// Legacy peer-dep install locations (still valid for older installs and dev symlinks)
		join(homedir(), ".pi", "agent", "extensions", "pi-interactive-subagents", "package.json"),
		join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-interactive-subagents", "package.json"),
		join(homedir(), ".pi", "agent", "git", "github.com", "HazAT", "pi-interactive-subagents", "package.json"),
	];
	for (const candidate of candidates) {
		try {
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
