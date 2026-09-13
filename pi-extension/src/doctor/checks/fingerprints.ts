/**
 * Trace-link fingerprint check (RTM traceability upgrade, Phase 3).
 *
 * Compares the fingerprints stored in the published RTM JSON sidecar
 * against fresh fingerprints computed from the published PSRS:
 *  - suspect:    requirement text changed after linking (error);
 *  - orphan:     PSRS requirement with no RTM row (error, NFR-04);
 *  - unknown-id: RTM row id absent from the PSRS (error);
 *  - untracked:  row without a fingerprint (warning — pre-Phase-3 data).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../core/paths.js";
import {
	checkRowFingerprints,
	extractRequirementFingerprints,
} from "../../core/fingerprints.js";
import type { RtmData } from "../../core/rtm-data.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkFingerprintsSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "Fingerprint check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "Trace-link fingerprints", items };
	}

	const psrs = resolveDocArtifact("PRD", projectName, cwd);
	const rtm = resolveDocArtifact("RTM", projectName, cwd);
	const rtmJsonPath = rtm ? rtm.path.replace(/\.md$/, ".json") : null;

	if (!psrs || !rtmJsonPath || !existsSync(rtmJsonPath)) {
		items.push({
			status: "info",
			message: "Fingerprint check skipped — needs both the published PSRS and the RTM JSON sidecar.",
			suggestion: !psrs ? suggestionFor("psrs-missing") : suggestionFor("rtm-json-missing"),
		});
		return { title: "Trace-link fingerprints", items };
	}

	let data: RtmData;
	try {
		data = JSON.parse(readFileSync(rtmJsonPath, "utf8")) as RtmData;
	} catch {
		items.push({
			status: "error",
			message: "RTM JSON sidecar is not readable JSON.",
			suggestion: suggestionFor("rtm-json-invalid"),
		});
		return { title: "Trace-link fingerprints", items };
	}

	const fingerprints = extractRequirementFingerprints(readFileSync(psrs.path, "utf8"));
	const issues = checkRowFingerprints(data.rows, fingerprints);

	for (const issue of issues) {
		items.push({
			status: issue.problem === "untracked" ? "warning" : "error",
			message: issue.message,
			suggestion: suggestionFor(
				issue.problem === "untracked" ? "fingerprint-untracked" : "fingerprint-suspect",
			),
		});
	}
	if (items.length === 0) {
		items.push({
			status: "ok",
			message: `All ${data.rows.length} RTM row(s) match the current PSRS (${fingerprints.size} requirement(s) fingerprinted).`,
		});
	}
	return { title: "Trace-link fingerprints", items };
}
