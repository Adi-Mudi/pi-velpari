/**
 * Agent freshness (generator v2 — C2 doctor section + D5 phase-boundary
 * hints).
 *
 * Joins the generated agents on disk (`.pi/agents/<slug>-<role>.md`)
 * against the freshness manifest (`.pi/velpari/freshness.json`): a
 * generated agent is STALE when any of its phase's published input
 * artifacts was published after the agent file's mtime. Used by:
 *
 *   - the phase-boundary next-hints (D5 — informational only, never a
 *     legality decision; the bundled scouts are the permanent fallback)
 *   - the doctor agent-freshness section (C2 — warning per D6, never a
 *     hard block)
 *
 * Layer 0. Imports node builtins + same-layer core modules only.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { GENERATION_PHASES, phaseForStage, type GenerationPhase } from "./agents-config.js";
import { STAGE_TRANSITIONS, type Stage } from "./constants.js";
import { loadFilesConfig } from "./config.js";
import { loadFreshnessManifest, manifestKey } from "./freshness.js";
import { getProjectSlug } from "./agents-generator.js";
import { slugify } from "./paths.js";
import { loadState } from "./state.js";

interface PhaseAgentFreshness {
	phase: GenerationPhase;
	/** Phase roles with a generated agent on disk. */
	generatedRoles: string[];
	/** Phase roles with NO generated agent on disk. */
	missingRoles: string[];
	/** Generated agents older than the latest publish of a phase input. */
	staleRoles: string[];
	/** Latest publishedAt across the phase's inputs (ISO), null when no
	 *  input carries a freshness stamp yet. */
	latestInputPublish: string | null;
	/** True when every phase role has a generated agent and none is stale. */
	fresh: boolean;
}

/** Absolute path of the generated agent file for a role. */
export function generatedAgentPath(cwd: string, slug: string, role: string): string {
	return join(cwd, ".pi", "agents", `${slug}-${role}.md`);
}

/** Freshness-manifest keys of the phase's published inputs
 *  (`<kind>:<projectName|slug>`). Inputs that cannot be keyed (no
 *  projectName / no mission yet) are skipped — an unkeyable input
 *  simply contributes nothing, same as an unpublished one. */
function phaseInputKeys(cwd: string, phase: GenerationPhase): string[] {
	const inputs = GENERATION_PHASES[phase].inputs;
	if (inputs.length === 0) return [];
	const config = loadFilesConfig(cwd);
	const projectName = config.projectName || config.projectNames?.[0] || "";
	const topicSlug = slugify(loadState(cwd).mission ?? "");
	const keys: string[] = [];
	for (const input of inputs) {
		if (input === "brainstorm") {
			if (topicSlug) keys.push(manifestKey("brainstorm", topicSlug));
		} else if (projectName) {
			keys.push(manifestKey(input.toLowerCase(), projectName));
		}
	}
	return keys;
}

/** Freshness status of one generation phase. Never throws. */
export function phaseAgentFreshness(cwd: string, phase: GenerationPhase): PhaseAgentFreshness {
	const slug = getProjectSlug(cwd);
	const generatedRoles: string[] = [];
	const missingRoles: string[] = [];
	const staleRoles: string[] = [];

	let latestMs = 0;
	let latestIso: string | null = null;
	const manifest = loadFreshnessManifest(cwd);
	for (const key of phaseInputKeys(cwd, phase)) {
		const entry = manifest.artifacts[key];
		if (!entry?.publishedAt) continue;
		const ms = Date.parse(entry.publishedAt);
		if (Number.isFinite(ms) && ms > latestMs) {
			latestMs = ms;
			latestIso = entry.publishedAt;
		}
	}

	for (const role of GENERATION_PHASES[phase].roles) {
		const filePath = generatedAgentPath(cwd, slug, role);
		if (!existsSync(filePath)) {
			missingRoles.push(role);
			continue;
		}
		generatedRoles.push(role);
		if (latestMs > 0) {
			try {
				if (statSync(filePath).mtimeMs < latestMs) staleRoles.push(role);
			} catch {
				// Unreadable file — treat as fresh (doctor's mapping checks
				// report file problems separately).
			}
		}
	}

	return {
		phase,
		generatedRoles,
		missingRoles,
		staleRoles,
		latestInputPublish: latestIso,
		fresh: missingRoles.length === 0 && staleRoles.length === 0,
	};
}

/** Phase entered by a stage transition, or null when the transition stays
 *  inside one phase. Drives the phase-boundary next-hint (D5). */
export function phaseBoundaryCrossed(from: Stage, to: Stage): GenerationPhase | null {
	const entered = phaseForStage(to);
	return entered > phaseForStage(from) ? entered : null;
}

/** When `stage` is the FIRST stage of a new phase (any incoming
 *  transition crosses a boundary), return that phase; else null. Used by
 *  surfaces that only know the current stage (e.g. /velpari-status). */
export function phaseEntryPhase(stage: Stage): GenerationPhase | null {
	for (const t of STAGE_TRANSITIONS) {
		if (t.to !== stage) continue;
		const entered = phaseBoundaryCrossed(t.from, t.to);
		if (entered !== null) return entered;
	}
	return null;
}

/** The D5 hint fragment when the phase lacks fresh generated agents, e.g.
 *  "generate Phase 3 agents (/velpari-generate-sub-agents)". Returns null
 *  when every phase role has a fresh generated agent on disk. */
export function generationHintForPhase(cwd: string, phase: GenerationPhase): string | null {
	if (phaseAgentFreshness(cwd, phase).fresh) return null;
	return `generate Phase ${phase} agents (/velpari-generate-sub-agents)`;
}
