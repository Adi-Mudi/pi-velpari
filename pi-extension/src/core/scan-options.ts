/**
 * Config-driven available-scan detection (v2.1 lifecycle upgrade).
 *
 * Layer 0 — imports nothing else from src/. Pure logic + filesystem
 * existsSync probes. Tells the SCAN-gate picker (ui/scan-gate.ts) what
 * scans are valid for the current project shape:
 *
 *   - Code project     (has codePaths)        → code available
 *   - Doc-only project (has inputDocuments)   → doc available
 *   - Any project                              → community always available
 *
 * The picker uses `getAvailableScanTypes` to hide options that don't
 * apply, so a doc-only project doesn't get a confusing "Run code scan"
 * choice.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FilesConfig } from "./config.js";
import type { ScanType } from "./state.js";

/**
 * Per-scan availability + a human-readable reason when a scan is OFF.
 * `reasons` is non-empty only for unavailable scans.
 */
export interface AvailableScans {
	code: boolean;
	doc: boolean;
	community: boolean;
	reasons: { code?: string; doc?: string };
}

/**
 * Probe `config` + the filesystem to decide which scans are usable.
 *
 * A scan is "available" when:
 *   - the config has at least one path for that category, AND
 *   - at least one of those paths exists on disk under `cwd`.
 *
 * Community is always available (no filesystem dependency) but the
 * SCAN-gate picker still asks for explicit consent (FR-52).
 */
export function getAvailableScanTypes(
	config: FilesConfig,
	cwd: string = process.cwd(),
): AvailableScans {
	const codePaths = config.codePaths ?? [];
	const docPaths = config.inputDocuments ?? [];
	const code =
		codePaths.length > 0 && codePaths.some((p) => existsPath(join(cwd, p)));
	const doc =
		docPaths.length > 0 && docPaths.some((p) => existsPath(join(cwd, p)));
	return {
		code,
		doc,
		community: true,
		reasons: {
			code: code
				? undefined
				: codePaths.length === 0
					? "no codePaths configured in files.json"
					: "no configured codePath exists on disk",
			doc: doc
				? undefined
				: docPaths.length === 0
					? "no inputDocuments configured in files.json"
					: "no configured inputDocument path exists on disk",
		},
	};
}

/**
 * Convert AvailableScans → ordered ScanType[] (only the available ones).
 * Order: code, doc, community. Stable across calls.
 */
export function availableScanList(available: AvailableScans): ScanType[] {
	const out: ScanType[] = [];
	if (available.code) out.push("code");
	if (available.doc) out.push("doc");
	if (available.community) out.push("community");
	return out;
}

/**
 * True when the given ScanType is available for the current project.
 * Convenience wrapper used by callers that already have a ScanType in
 * hand (e.g. the dispatcher validating a scout request).
 */
export function isScanAvailable(
	scan: ScanType,
	available: AvailableScans,
): boolean {
	if (scan === "code") return available.code;
	if (scan === "doc") return available.doc;
	if (scan === "community") return available.community;
	return false;
}

/**
 * Resolve filesystem existence without throwing. existsSync returns
 * false for missing paths, but wrapped here so callers don't need to
 * know the node:fs detail.
 */
function existsPath(absPath: string): boolean {
	try {
		return existsSync(absPath);
	} catch {
		return false;
	}
}