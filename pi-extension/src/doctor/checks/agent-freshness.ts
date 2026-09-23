/**
 * Generated agent freshness check (generator v2 — C2).
 *
 * Joins the generated agents on disk (`.pi/agents/<slug>-<role>.md`)
 * against the freshness manifest via `core/agent-freshness.ts`:
 *
 *   - For each generation phase (1–4), a generated agent that is OLDER
 *     than the latest publish of its phase's input artifacts is STALE →
 *     warning "regenerate Phase N" (D6: advisory, never a hard block —
 *     the bundled scouts are the permanent fallback).
 *   - Phase roles with no generated agent → info (bundled fallback
 *     covers them; generation is an enhancement layer, never required).
 *   - Reviewer presence per tier gate: when the tier + overlay +
 *     reviewerMode policy requires the reviewer
 *     (`core/atomic-tier.ts:shouldRunReviewer`), every reviewer role's
 *     resolved agent file must exist → error when absent.
 *
 * Spec: Doc/velpari-sequence/05-sub-agent-generation.md §"Doctor
 * validation at each boundary".
 *
 * Layer 1 (doctor). Imports node builtins, same-layer doctor/stages
 * modules, and L0 `core/` modules only.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import {
	GENERATION_PHASES,
	REVIEWER_ROLES,
	loadAgentConfig,
	resolveAgentName,
	type AgentConfig,
	type GenerationPhase,
} from "../../core/agents-config.js";
import { phaseAgentFreshness } from "../../core/agent-freshness.js";
import { getProjectSlug } from "../../core/agents-generator.js";
import { deriveAtomicProfile, shouldRunReviewer } from "../../core/atomic-tier.js";
import { loadFilesConfig } from "../../core/config.js";
import { overlayRequiresReviewerFor } from "../../stages/registry.js";

const PHASES: readonly GenerationPhase[] = [1, 2, 3, 4];

/** Doctor section "Generated agent freshness". */
export function checkAgentFreshnessSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const slug = getProjectSlug(cwd);

	let generatedTotal = 0;
	let staleTotal = 0;

	for (const phase of PHASES) {
		const freshness = phaseAgentFreshness(cwd, phase);
		const total = GENERATION_PHASES[phase].roles.length;
		generatedTotal += freshness.generatedRoles.length;
		staleTotal += freshness.staleRoles.length;

		for (const role of freshness.staleRoles) {
			items.push({
				status: "warning",
				message:
					`${slug}-${role}.md (Phase ${phase}) is older than its phase inputs ` +
					`(latest publish ${freshness.latestInputPublish}) — regenerate Phase ${phase} agents.`,
				suggestion: `Run /velpari-generate-sub-agents --phase ${phase} to regenerate.`,
			});
		}

		if (freshness.missingRoles.length > 0) {
			items.push({
				status: "info",
				message:
					`Phase ${phase}: ${freshness.missingRoles.length} of ${total} role(s) have no ` +
					`generated agent — the bundled scouts cover them (generation is optional).`,
				details: freshness.missingRoles.map((role) => `- ${role}`),
			});
		}

		if (freshness.fresh) {
			items.push({
				status: "ok",
				message:
					`Phase ${phase}: all ${total} generated agent(s) fresh` +
					(freshness.latestInputPublish
						? ` (latest input publish ${freshness.latestInputPublish}).`
						: " (no published inputs yet)."),
			});
		}
	}

	items.push(...reviewerPresenceItems(cwd));

	const errorCount = items.filter((i) => i.status === "error").length;
	const warningCount = items.filter((i) => i.status === "warning").length;
	items.push({
		status: errorCount === 0 && warningCount === 0 ? "ok" : "info",
		message:
			`Agent freshness summary: ${generatedTotal} generated agent(s) on disk across ` +
			`${PHASES.length} phase(s); ${staleTotal} stale, ${errorCount} error(s), ${warningCount} warning(s).`,
	});

	return { title: "Generated agent freshness", items };
}

/** Reviewer-per-tier presence: error per missing reviewer agent when the
 *  tier + overlay + reviewerMode policy requires the reviewer; a single
 *  info item when the policy skips it. */
function reviewerPresenceItems(cwd: string): DiagnosticItem[] {
	const profile = deriveAtomicProfile(loadFilesConfig(cwd));
	const overlayRequiresReviewer = profile.overlayId ? overlayRequiresReviewerFor(cwd, profile.overlayId) : false;
	const reviewerExpected = shouldRunReviewer({
		profile,
		overlayRequiresReviewer,
		reviewerMode: profile.reviewerMode,
	});

	if (!reviewerExpected) {
		return [
			{
				status: "info",
				message:
					`Reviewer presence not required by tier policy (tier=${profile.tier} / ` +
					`class=${profile.safetyClass} / SIL=${profile.sil}; ` +
					`reviewerMode=${profile.reviewerMode ?? "tier-default"}).`,
			},
		];
	}

	let agentConfig: AgentConfig | null = null;
	try {
		agentConfig = loadAgentConfig(cwd);
	} catch {
		agentConfig = null;
	}

	const policyNote =
		`tier=${profile.tier} / class=${profile.safetyClass} / SIL=${profile.sil}` +
		(overlayRequiresReviewer ? "; overlay requires reviewer" : "") +
		(profile.reviewerMode === "always" ? "; reviewerMode=always" : "");

	const items: DiagnosticItem[] = [];
	for (const role of REVIEWER_ROLES) {
		const resolved = resolveAgentName(agentConfig, role);
		const filePath = join(cwd, ".pi", "agents", `${resolved}.md`);
		if (!existsSync(filePath)) {
			items.push({
				status: "error",
				message:
					`${resolved}.md (reviewer role ${role}) MISSING — tier policy requires ` + `the reviewer (${policyNote}).`,
				suggestion:
					`Run /velpari-generate-sub-agents --phase 3, or re-run a reviewer-gated ` +
					`stage command to auto-bootstrap the bundled reviewer.`,
			});
		} else {
			items.push({
				status: "ok",
				message: `${resolved}.md (reviewer role ${role}) present — reviewer required by tier policy.`,
			});
		}
	}
	return items;
}
