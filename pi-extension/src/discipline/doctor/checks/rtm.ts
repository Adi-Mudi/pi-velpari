/**
 * RTM traceability check.
 *
 * Reads the published PSRS and RTM, extracts all FR-N / NFR-N / HF-N
 * ids from each, and verifies that every RTM id is referenced from the
 * PSRS.
 *
 * Phase 1: returns a DiagnosticSection.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDocArtifact } from "../../../core/paths.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkRtmTraceabilitySection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "RTM traceability skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "RTM traceability", items };
	}

	const psrsResolved = resolveDocArtifact("PRD", projectName, cwd);
	const rtmResolved = resolveDocArtifact("RTM", projectName, cwd);

	if (!psrsResolved) {
		items.push({
			status: "info",
			message: "PSRS not found — skipping traceability check.",
			suggestion: suggestionFor("psrs-missing"),
		});
		return { title: "RTM traceability", items };
	}

	if (!rtmResolved) {
		items.push({
			status: "info",
			message: "RTM not found — skipping traceability check.",
			suggestion: suggestionFor("rtm-missing"),
		});
		return { title: "RTM traceability", items };
	}

	const psrsContent = readFileSync(psrsResolved.path, "utf8");
	const rtmContent = readFileSync(rtmResolved.path, "utf8");
	const psrsIds = new Set<string>();
	for (const m of psrsContent.matchAll(/\b(?:FR|NFR)-\d+\b/g)) psrsIds.add(m[0]);
	for (const m of psrsContent.matchAll(/\bHF-\d+\b/g)) psrsIds.add(m[0]);

	const rtmIds = new Set<string>();
	for (const m of rtmContent.matchAll(/\b(?:FR|NFR|HF)-\d+\b/g)) rtmIds.add(m[0]);

	const missing = Array.from(rtmIds).filter((id) => !psrsIds.has(id));
	const truncated = missing.slice(0, 20).join(", ") + (missing.length > 20 ? "..." : "");

	if (missing.length > 0) {
		items.push({
			status: "error",
			message: `RTM references ${missing.length} unknown id(s) not present in the PSRS.`,
			details: [
				`PSRS path: ${psrsResolved.path} (${psrsResolved.layout})`,
				`RTM path: ${rtmResolved.path} (${rtmResolved.layout})`,
				`PSRS ids: ${psrsIds.size} | RTM ids: ${rtmIds.size}`,
				`Unknown ids: ${truncated}`,
			],
			suggestion: suggestionFor("rtm-unknown-id"),
		});
	} else {
		items.push({
			status: "ok",
			message: "All RTM ids resolve in the PSRS.",
			details: [
				`PSRS path: ${psrsResolved.path} (${psrsResolved.layout})`,
				`RTM path: ${rtmResolved.path} (${rtmResolved.layout})`,
				`PSRS ids: ${psrsIds.size} | RTM ids: ${rtmIds.size}`,
			],
		});
	}

	return { title: "RTM traceability", items };
}
