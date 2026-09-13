/**
 * Publish gate (RTM traceability upgrade, Phase 5).
 *
 * The doctor's artifact checks run INSIDE /velpari-approve, before
 * anything is written to Doc/. The user never has to remember
 * /velpari-doctor — a broken artifact cannot be published:
 *
 *  - PRD: the working copy must pass validatePsrs (all 20 sections,
 *    status vocabularies, no duplicate ids). Fresh publishes were
 *    unchecked before this gate; only revisions were gated.
 *  - RTM: the working JSON rows are checked against the published PSRS
 *    fingerprints — unknown ids and orphan requirements (NFR-04 full
 *    coverage) block; suspect rows warn (the LLM may legitimately keep
 *    a link after a requirement edit); untracked rows are ignored
 *    because approve stamps fingerprints right after the gate. Rows
 *    whose phase differs from the PRD Phase column also block.
 *
 *  - feasibility-study: the working copy must pass validateFeasibilityDoc
 *    (feasibility v2 — all 13 sections, real verdict word).
 *
 * Other artifacts (design, pseudocode, ...) pass through — their
 * revision rules are already enforced by the Change Log gate.
 */

import { readFileSync } from "node:fs";
import { resolveDocArtifact } from "../core/paths.js";
import { extractRequirementPhases, validatePsrs } from "../core/psrs.js";
import { validateFeasibilityDoc } from "../core/feasibility-doc.js";
import {
	checkRowFingerprints,
	extractRequirementFingerprints,
} from "../core/fingerprints.js";
import type { RtmData } from "../core/rtm-data.js";

export interface PublishGateInput {
	/** Artifact key of the file being published ("PRD", "RTM", ...). */
	artifact: string;
	/** Working-copy content (for RTM: the markdown rendered from the JSON). */
	workingContent: string;
	/** Parsed + validated working RTM JSON, when the sidecar exists. */
	rtmData?: RtmData | null;
	cwd: string;
	projectName: string;
}

export interface PublishGateResult {
	errors: string[];
	warnings: string[];
}

export function runPublishGate(input: PublishGateInput): PublishGateResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (input.artifact === "PRD") {
		const result = validatePsrs(input.workingContent);
		if (!result.ok) {
			for (const issue of result.issues) {
				errors.push(`${issue.code}: ${issue.message}`);
			}
		}
	}

	// Feasibility v2: the study must carry every v2 section and a real
	// verdict word. Same strictness as the PSRS check.
	if (input.artifact === "feasibility-study") {
		const result = validateFeasibilityDoc(input.workingContent);
		for (const issue of result.issues) {
			errors.push(`${issue.code}: ${issue.message}`);
		}
	}

	if (input.artifact === "RTM" && input.rtmData) {
		const psrs = resolveDocArtifact("PRD", input.projectName, input.cwd);
		if (psrs) {
			const psrsText = readFileSync(psrs.path, "utf8");
			const fingerprints = extractRequirementFingerprints(psrsText);
			for (const issue of checkRowFingerprints(input.rtmData.rows, fingerprints)) {
				if (issue.problem === "untracked") continue; // approve stamps next
				if (issue.problem === "suspect") {
					warnings.push(issue.message);
				} else {
					errors.push(issue.message);
				}
			}
			// Phase consistency: the RTM row's phase must match the PRD's
			// Phase column for the same id (MVP/phase traceability).
			const phases = extractRequirementPhases(psrsText);
			for (const row of input.rtmData.rows) {
				const phase = phases.get(row.id);
				if (phase !== undefined && phase !== row.phase) {
					errors.push(
						`${row.id}: RTM phase ${row.phase} does not match the PRD phase ${phase}. ` +
							`Copy the phase from the PRD Phase column (1 = MVP).`,
					);
				}
			}
		}
	}

	return { errors, warnings };
}
