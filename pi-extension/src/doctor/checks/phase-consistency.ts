/**
 * Phase consistency check (MVP/phase traceability upgrade, Phase 3).
 *
 * Compares the published PRD's Phase column against the published RTM
 * JSON sidecar: every RTM row's phase must equal the PRD phase for the
 * same id. A mismatch means one document was revised without the other —
 * an error. The publish gate blocks new mismatches; this section catches
 * drift in already-published artifacts.
 */

import { readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../core/paths.js";
import { extractRequirementPhases } from "../../core/psrs.js";
import { resolveRtmSidecar, type RtmData } from "../../core/rtm-data.js";
import { readLatestPublishedRows } from "../../io/store.js";
import { readYamlFile } from "../../core/yaml-data.js";
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

	// Phase 7 (OQ3a) — DB-first: RTM phases from the store's rtm_row rows
	// (id + phase are stored 1:1); PSRS side stays the published PRD file
	// (the G8-mirrored human view, same input the publish gate checks).
	const fromDb = readLatestPublishedRows(cwd, projectName, "rtm");
	if (fromDb) {
		const rtmRows = (fromDb.rows.rtmRow as Array<Record<string, unknown>> | undefined) ?? [];
		const psrs = resolveDocArtifact("PRD", projectName, cwd);
		if (!psrs) {
			items.push({
				status: "info",
				message: "Phase consistency check skipped — the published PRD view is missing.",
				suggestion: suggestionFor("psrs-missing"),
			});
			return { title, items };
		}
		const phases = extractRequirementPhases(readFileSync(psrs.path, "utf8"));
		let checked = 0;
		for (const row of rtmRows) {
			const id = String(row.id);
			const phase = phases.get(id);
			if (phase === undefined) continue; // unknown-id is the fingerprint check's job
			checked++;
			const rtmPhase = Number(row.phase);
			if (phase !== rtmPhase) {
				items.push({
					status: "error",
					message: `${id}: RTM phase ${rtmPhase} ≠ PRD phase ${phase}.`,
					suggestion: suggestionFor("phase-mismatch"),
				});
			}
		}
		if (items.length === 0) {
			items.push({
				status: "ok",
				message: `All ${checked} RTM store row(s) match the PRD Phase column.`,
				details: [`Store: Doc/store/${projectName}/index.db (run ${fromDb.envelope.runId} v${fromDb.envelope.version})`],
			});
		}
		return { title, items };
	}

	const psrs = resolveDocArtifact("PRD", projectName, cwd);
	const rtm = resolveDocArtifact("RTM", projectName, cwd);
	// B3/D4: dual-read — .yaml preferred, legacy .json fallback.
	const sidecar = rtm ? resolveRtmSidecar(rtm.path) : null;

	if (!psrs || !sidecar) {
		items.push({
			status: "info",
			message: "Phase consistency check skipped — needs both the published PSRS and the RTM sidecar.",
			suggestion: !psrs ? suggestionFor("psrs-missing") : suggestionFor("rtm-json-missing"),
		});
		return { title, items };
	}

	let data: RtmData;
	try {
		data = readYamlFile(sidecar.path) as RtmData;
		if (!data || !Array.isArray(data.rows)) throw new Error("invalid");
	} catch {
		items.push({
			status: "error",
			message: `RTM sidecar (${sidecar.format}) is not readable.`,
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
