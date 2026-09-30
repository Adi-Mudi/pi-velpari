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

import { existsSync, readFileSync } from "node:fs";
import { buildStoreDbPath, resolveDocArtifact, slugify } from "../core/paths.js";
import { openStoreDbReadOnly } from "../io/db.js";
import type { DatabaseSync } from "node:sqlite";
import { extractRequirementPhases, validatePsrs } from "../core/psrs.js";
import { validateFeasibilityDoc } from "../core/feasibility-doc.js";
import { checkRowFingerprints, extractRequirementFingerprints } from "../core/fingerprints.js";
import { loadFreshnessManifest, manifestKey, resolveDeclaredInputs } from "../core/freshness.js";
import { checkDownstreamCoverage } from "../core/id-coverage.js";
import { loadState } from "../core/state.js";
import { STAGE_REGISTRY } from "../stages/registry.js";
import { gateArchSubCycle } from "./checks/arch-sub-cycle.js";
import { gateStandardsProfile } from "./checks/standards-profile.js";
import { gateADR } from "./checks/adr.js";
import { gateDesignReadiness } from "./checks/design-readiness.js";
import { gateStoreEnforcement } from "./checks/soft-lock.js"; // Phase B (soft-lock)
import { loadReviewerVerdictForStage, verifierSpecForArtifact } from "./checks/reviewer-verdict.js";
import { deriveAtomicProfile } from "../core/atomic-tier.js";
import { loadFilesConfig, devLaneConfig } from "../core/config.js";
import { verifyLaneProposal, type DevLanesGateData } from "../core/dev-lanes.js";
import type { RtmData } from "../core/rtm-data.js";

interface PublishGateInput {
	/** Artifact key of the file being published ("PRD", "RTM", ...). */
	artifact: string;
	/** Working-copy content (for RTM: the markdown rendered from the JSON). */
	workingContent: string;
	/** Parsed + validated working RTM JSON, when the sidecar exists. */
	rtmData?: RtmData | null;
	/** Phase 7 / N16: finalized Stage 9 lane rows (approve-time finalization). */
	devLanes?: DevLanesGateData | null;
	cwd: string;
	projectName: string;
}

interface PublishGateResult {
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

	// Phase 7 / N16: development-order lanes are finalized at approve time
	// (ops/approve.ts:finalizeDevLanes) and re-asserted here — a cheap pure
	// verifyLaneProposal over the payload rows, no store. Mirrors the RTM
	// rtmData precedent above; legacy payloads without steps pass null and
	// skip. Every problem is a hard error (cycle, coverage, cap, name-match,
	// bad-boundary all block the publish).
	if (input.artifact === "development-order" && input.devLanes) {
		let maxLanes: number;
		try {
			maxLanes = devLaneConfig(input.cwd).maxLanes;
		} catch (err) {
			errors.push(err instanceof Error ? err.message : String(err));
			maxLanes = 4;
		}
		const problems = verifyLaneProposal(input.devLanes.proposal, input.devLanes.steps, input.devLanes.deps, {
			maxLanes,
			projectSlug: input.projectName,
			xdeps: input.devLanes.xdeps,
		});
		for (const p of problems) {
			errors.push(`${p.code}: ${p.message}`);
		}
	}

	// Reviewer-verdict gates (Plan A + Plan D; C3 — map-driven). The
	// reviewer sub-agent is the single source of truth for stage-specific
	// tier checks. Doctor surfaces the verdict but does NOT re-derive any
	// rule. The stage→verifier map (REVIEWER_STAGE_SPECS in
	// checks/reviewer-verdict.ts) decides which verdict — if any — this
	// artifact's publish consumes. Tier + overlay gate
	// (core/atomic-tier.ts:shouldRunReviewer) decides whether the reviewer
	// was spawned at all; each spec's missingVerdict policy decides what a
	// missing verdict file means.
	const verifierSpec = verifierSpecForArtifact(input.artifact);
	if (verifierSpec) {
		const config = loadFilesConfig(input.cwd);
		const profile = deriveAtomicProfile(config);
		const tierContext = `tier ${profile.tier} / class ${profile.safetyClass} / SIL ${profile.sil}`;
		const section = loadReviewerVerdictForStage(input.cwd, verifierSpec, tierContext, profile);
		for (const item of section.items) {
			if (item.status === "error") errors.push(item.message);
			else if (item.status === "warning") warnings.push(item.message);
		}
	}

	// Freshness (B4/A3) — the last checkpoint before Doc/ is written.
	//  1. Refuse to publish when a declared input of the stage is missing
	//     (it vanished between the stage run and the publish).
	//  2. Informational: downstream artifacts that consume this artifact
	//     become stale the moment it is (re)published — the post-publish
	//     doctor audit reports the resulting stale set as errors (D7),
	//     so the user sees the cascade immediately after publish.
	{
		const spec = Object.values(STAGE_REGISTRY).find(
			(s) => s.workingCopyArtifact === input.artifact || s.additionalWorkingCopies?.includes(input.artifact),
		);
		if (spec) {
			const state = loadState(input.cwd);
			const declared = resolveDeclaredInputs(input.cwd, spec.inputs, {
				projectName: input.projectName,
				topicSlug: slugify(state.mission),
			});
			for (const d of declared) {
				if (d.status === "missing" && !d.optional) {
					errors.push(
						`freshness-input-missing: declared input ${d.id} is missing — ` +
							`restore it or republish the upstream stage before publishing.`,
					);
				}
			}
			const ownKey = manifestKey(input.artifact, input.projectName);
			const manifest = loadFreshnessManifest(input.cwd);
			for (const [key, entry] of Object.entries(manifest.artifacts)) {
				if (key === ownKey || !entry.inputs) continue;
				if (ownKey in entry.inputs) {
					warnings.push(
						`freshness-downstream: publishing ${ownKey} makes ${key} stale — ` +
							`republish it next (the post-publish audit will flag it).`,
					);
				}
			}
		}
	}

	// Layer-2 ID coverage (A4): when publishing artifact X, run the rules
	// where X is the downstream — the working copy is checked against the
	// published upstreams. missing → error (blocks, D1); not-checkable →
	// warning (legacy pre-A4 doc, publish continues); duplicates → warning
	// (D2). A rule whose upstream artifact is absent is skipped.
	for (const result of checkDownstreamCoverage(input.cwd, input.artifact, input.workingContent, input.projectName)) {
		if (result.status === "missing") {
			errors.push(
				`id-coverage:${result.rule.id}: missing ${result.missingIds.join(", ")} — ` +
					`revise the ${result.rule.downstream} working copy to reference them ` +
					`(${result.rule.downstreamRefHint}).`,
			);
		} else if (result.status === "not-checkable") {
			warnings.push(
				`id-coverage:${result.rule.id}: not machine-checkable — no parseable references ` +
					`(${result.rule.downstreamRefHint}); regenerate the stage to gain ID traceability.`,
			);
		}
		if (result.duplicateIds.length > 0) {
			warnings.push(
				`id-coverage:${result.rule.id}: duplicate ids ${result.duplicateIds.join(", ")} — ` +
					`each upstream id should appear exactly once.`,
			);
		}
	}

	// Store integrity in the gate (E#5 — G4 adopted at publish). Before this,
	// the gate never opened the store, so a non-store or corrupt DB reached
	// the publish chain undetected (the pre-write doctor's standalone branch
	// cannot stamp either). Pre-store (no file) passes silently — the first
	// publish creates the store. Read-only open: the gate never migrates or
	// creates. Both G4 PRAGMAs, doctor parity; failure = errors.push (block).
	{
		const dbPath = buildStoreDbPath(input.projectName, input.cwd);
		if (existsSync(dbPath)) {
			let problem: string | null = null;
			let db: DatabaseSync | undefined;
			try {
				db = openStoreDbReadOnly(dbPath);
			} catch (err) {
				problem = `cannot open store DB — ${err instanceof Error ? err.message : String(err)}`;
			}
			if (db !== undefined) {
				try {
					const quick = db.prepare("PRAGMA quick_check").get() as { quick_check: string } | undefined;
					if (!quick || quick.quick_check !== "ok") {
						problem = `PRAGMA quick_check failed — ${quick ? quick.quick_check : "no row"}`;
					} else {
						const full = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
						if (!full || full.integrity_check !== "ok") {
							problem = `PRAGMA integrity_check failed — ${full ? full.integrity_check : "no row"}`;
						}
					}
				} catch (err) {
					problem = `integrity PRAGMA failed — ${err instanceof Error ? err.message : String(err)}`;
				} finally {
					db.close();
				}
			}
			if (problem !== null) {
				errors.push(
					`store-integrity: ${problem} — restore or rebuild the store (skills/db-store-merge-runbook.md) before publishing.`,
				);
			}
		}
	}

	// ===== PHASE B REGISTRY BLOCK — soft-lock + store enforcement (N19/N20/N21) =====
	// Phase B added this block; `doctor/` is Phase C's territory (shared-file
	// rule, recorded in the plan's integration requests). KEEP IT LAST so it
	// sees the final error list: detection + marking only run when every
	// other gate check has passed (D8). Do not merge other edits into here.
	{
		const specB = Object.values(STAGE_REGISTRY).find(
			(s) => s.workingCopyArtifact === input.artifact || s.additionalWorkingCopies?.includes(input.artifact),
		);
		if (specB) {
			const stateB = loadState(input.cwd);
			const declaredB = resolveDeclaredInputs(input.cwd, specB.inputs, {
				projectName: input.projectName,
				topicSlug: slugify(stateB.mission),
			});
			const coverageB = checkDownstreamCoverage(input.cwd, input.artifact, input.workingContent, input.projectName);
			const enforcement = gateStoreEnforcement({
				artifact: input.artifact,
				cwd: input.cwd,
				projectName: input.projectName,
				declaredInputIds: declaredB.filter((d) => d.status === "found").map((d) => d.id),
				coverageUpstreamKeys: coverageB
					.filter((r) => r.status !== "not-checkable")
					.flatMap((r) => r.rule.upstreams.map((u) => manifestKey(u.artifact, input.projectName))),
				gateErrorsSoFar: errors.length,
			});
			for (const e of enforcement.errors) errors.push(e);
			for (const w of enforcement.warnings) warnings.push(w);
		}
	}
	// ===== END PHASE B REGISTRY BLOCK =====
	return { errors, warnings };
}
