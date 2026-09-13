/**
 * Phase consistency check (MVP/phase traceability upgrade, Phase 3).
 *
 * Compares the published PRD's Phase column against the published RTM
 * JSON sidecar: every RTM row's phase must equal the PRD phase for the
 * same id. A mismatch means one document was revised without the other —
 * an error. The publish gate blocks new mismatches; this section catches
 * drift in already-published artifacts.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../core/paths.js";
import { extractRequirementPhases } from "../../core/psrs.js";
import type { RtmData } from "../../core/rtm-data.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkPhaseConsistencySection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const title = "Phase consistency (PRD ↔ RTM)";

	if (!projectName) {
		items.push({
			status: "info",
			message: "Phase consistency check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title, items };
	}

	const psrs = resolveDocArtifact("PRD", projectName, cwd);
	const rtm = resolveDocArtifact("RTM", projectName, cwd);
	const rtmJsonPath = rtm ? rtm.path.replace(/\.md$/, ".json") : null;

	if (!psrs || !rtmJsonPath || !existsSync(rtmJsonPath)) {
		items.push({
			status: "info",
			message: "Phase consistency check skipped — needs both the published PSRS and the RTM JSON sidecar.",
			suggestion: !psrs ? suggestionFor("psrs-missing") : suggestionFor("rtm-json-missing"),
		});
		return { title, items };
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
		return { title, items };
	}

	const phases = extractRequirementPhases(readFileSync(psrs.path, "utf8"));
	let checked = 0;
	for (const row of data.rows) {
		const phase = phases.get(row.id);
		if (phase === undefined) continue; // unknown-id is the fingerprint check's job
		checked++;
		if (phase !== row.phase) {
			items.push({
				status: "error",
				message: `${row.id}: RTM phase ${row.phase} ≠ PRD phase ${phase}.`,
				suggestion: suggestionFor("phase-mismatch"),
			});
		}
	}

	if (items.length === 0) {
		items.push({
			status: "ok",
			message: `All ${checked} RTM row(s) match the PRD Phase column.`,
		});
	}
	return { title, items };
}
