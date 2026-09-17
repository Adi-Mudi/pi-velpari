/**
 * Publish gate (RTM traceability upgrade, Phase 5; sub-life cycle Phase 2).
 *
 * The doctor's artifact checks run INSIDE publish, before
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
 *  - design (Phase 2): the developer must have confirmed the loaded
 *    project context in the sub-life cycle prelude. Block until
 *    `state.json:archSubCycle.developerConfirmed === true`.
 *
 * Other artifacts (pseudocode, ...) pass through — their
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
import { loadState } from "../core/state.js";
import { gateArchSubCycle } from "./checks/arch-sub-cycle.js";
import { gateStandardsProfile } from "./checks/standards-profile.js";
import { gateADR } from "./checks/adr.js";
import { gateDesignReadiness } from "./checks/design-readiness.js";
import { loadReviewerVerdict } from "./checks/atomic-tier.js";
import { loadPseudocodeReviewerVerdict } from "./checks/pseudocode-reviewer.js";
import { loadTestplanReviewerVerdict } from "./checks/testplan-reviewer.js";
import { loadDesignReviewerVerdict } from "./checks/design-reviewer.js";
import { deriveAtomicProfile } from "../core/atomic-tier.js";
import { loadFilesConfig } from "../core/config.js";
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

	// Design (Phase 2): the sub-life cycle must have run and the developer
	// must have confirmed. This is the read → confirm → write gate.
	if (input.artifact === "design") {
		const state = loadState(input.cwd);
		for (const e of gateArchSubCycle(state)) {
			errors.push(`${e.code}: ${e.message}`);
		}
		// Phase 4: the working copy must carry a valid Architecture Decisions
		// section (or a single ADR-000 'no conflicts' ADR).
		for (const e of gateADR(input.workingContent)) {
			errors.push(`${e.code}: ${e.message}`);
		}
		// Phase 1 (upgrade plan): §0 + §0.4 + §5 QA-scenarios must be valid.
		for (const e of gateDesignReadiness(input.workingContent)) {
			errors.push(`${e.code}: ${e.message}`);
		}
	}

	// Standards profile (Phase 3): every published artifact must reference a
	// valid overlay (or have no profile = implicit "none"). Catches stale
	// references after a community overlay is removed.
	{
		const state = loadState(input.cwd);
		for (const e of gateStandardsProfile(state, input.cwd)) {
			errors.push(`${e.code}: ${e.message}`);
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

	// Reviewer-verdict gates (Plan A + Plan D). The reviewer sub-agent is
	// the single source of truth for stage-specific tier checks. Doctor
	// surfaces the verdict but does NOT re-derive any rule. Each stage
	// has its own reviewer + verdict path; see REVIEWER_STAGE_SPECS in
	// checks/reviewer-verdict.ts. Tier + overlay gate (core/atomic-tier.ts:
	// shouldRunReviewer) decides whether the reviewer was spawned at all;
	// if it was skipped, the gate emits a clear error.
	const reviewerArtifactKeys: Record<string, () => void> = {
		"atomic-functions": () => {
			const config = loadFilesConfig(input.cwd);
			const profile = deriveAtomicProfile(config);
			const section = loadReviewerVerdict(input.cwd, profile);
			for (const item of section.items) {
				if (item.status === "error") errors.push(item.message);
				else if (item.status === "warning") warnings.push(item.message);
			}
		},
		pseudocode: () => {
			const config = loadFilesConfig(input.cwd);
			const profile = deriveAtomicProfile(config);
			const section = loadPseudocodeReviewerVerdict(input.cwd, profile);
			for (const item of section.items) {
				if (item.status === "error") errors.push(item.message);
				else if (item.status === "warning") warnings.push(item.message);
			}
		},
		"test-plan": () => {
			const config = loadFilesConfig(input.cwd);
			const profile = deriveAtomicProfile(config);
			const section = loadTestplanReviewerVerdict(input.cwd, profile);
			for (const item of section.items) {
				if (item.status === "error") errors.push(item.message);
				else if (item.status === "warning") warnings.push(item.message);
			}
		},
		"test-cases": () => {
			const config = loadFilesConfig(input.cwd);
			const profile = deriveAtomicProfile(config);
			const section = loadTestplanReviewerVerdict(input.cwd, profile);
			for (const item of section.items) {
				if (item.status === "error") errors.push(item.message);
				else if (item.status === "warning") warnings.push(item.message);
			}
		},
		design: () => {
			const config = loadFilesConfig(input.cwd);
			const profile = deriveAtomicProfile(config);
			const section = loadDesignReviewerVerdict(input.cwd, profile);
			for (const item of section.items) {
				if (item.status === "error") errors.push(item.message);
				else if (item.status === "warning") warnings.push(item.message);
			}
		},
	};
	const reviewerHandler = reviewerArtifactKeys[input.artifact];
	if (reviewerHandler) reviewerHandler();

	return { errors, warnings };
}
