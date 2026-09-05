/**
 * RTM traceability check.
 *
 * Reads the published PSRS and RTM, extracts all FR-N / NFR-N / HF-N
 * ids from each, and verifies that every RTM id is referenced from the
 * PSRS. Results are pushed into `lines`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDocArtifact } from "../../../core/paths.js";

export function checkRtmTraceability(cwd: string, projectName: string, lines: string[]): void {
	const psrsResolved = resolveDocArtifact("PRD", projectName, cwd);
	const rtmResolved = resolveDocArtifact("RTM", projectName, cwd);
	if (!psrsResolved) {
		lines.push("### RTM traceability");
		lines.push("- PSRS not found — skipping traceability check.");
		lines.push("");
		return;
	}
	if (!rtmResolved) {
		lines.push("### RTM traceability");
		lines.push("- RTM not found — skipping traceability check.");
		lines.push("");
		return;
	}
	const psrsContent = readFileSync(psrsResolved.path, "utf8");
	const rtmContent = readFileSync(rtmResolved.path, "utf8");
	const psrsIds = new Set<string>();
	for (const m of psrsContent.matchAll(/\b(?:FR|NFR)-\d+\b/g)) psrsIds.add(m[0]);
	for (const m of psrsContent.matchAll(/\bHF-\d+\b/g)) psrsIds.add(m[0]);

	const rtmIds = new Set<string>();
	for (const m of rtmContent.matchAll(/\b(?:FR|NFR|HF)-\d+\b/g)) rtmIds.add(m[0]);

	const missing = Array.from(rtmIds).filter((id) => !psrsIds.has(id));
	lines.push("### RTM traceability");
	lines.push(`- PSRS path: ${psrsResolved.path} (${psrsResolved.layout})`);
	lines.push(`- RTM path: ${rtmResolved.path} (${rtmResolved.layout})`);
	lines.push(`- PSRS ids: ${psrsIds.size} | RTM ids: ${rtmIds.size}`);
	if (missing.length > 0) {
		lines.push(`- ✗ RTM references ${missing.length} unknown id(s): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "..." : ""}`);
	} else {
		lines.push(`- ✓ All RTM ids resolve in the PSRS.`);
	}
	lines.push("");
	void join;
}
