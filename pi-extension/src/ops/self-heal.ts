/**
 * Self-heal module — Phase C (N23 / G8), Doctor v2.
 *
 * Evidence-driven, bookkeeping-only fixes. The THREE actions:
 *
 *   1. `detectBookkeepingDrift` — did a stage publish succeed while the
 *      `currentStage` flag advance was lost (crash window)? Positive
 *      evidence only: the current stage must be the `from` of an
 *      APPROVE transition in `STAGE_TRANSITIONS` AND the published head
 *      for that stage's artifact must belong to THIS runId (store
 *      envelope, or the published brainstorm notes' `run:` frontmatter —
 *      brainstorm is the one file-based stage).
 *   2. `applyBookkeepingAdvance` — `advanceStage()` only: the normal,
 *      audited state path writes the history line (state.json history +
 *      per-run history.jsonl). No hand-rolled state writes.
 *   3. `ensureStandardScaffold` — missing standard dirs + a config
 *      baseline when none exists (delegates to `config-manifest.ts`).
 *      Never creates/edits `files.json`/`agents.json` content (that
 *      stays `/velpari-configure-inputs`'s job).
 *
 * **Publish invariant (N23):** this module imports NO approve/publish
 * machinery — no `ops/approve.ts`, no `stages/stage-publish-tool.ts`,
 * no `doctor/gate.ts` — asserted by test + import scan. Fix flow never
 * calls approve/publish; content actions stay human-gated.
 *
 * Layer 1 (ops). Fail-soft: every exported function catches and returns
 * a structured result — never throws into the doctor/fix dispatcher.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGE_TRANSITIONS, type Stage } from "../core/constants.js";
import { loadFilesConfig } from "../core/config.js";
import { GROUPED_CATEGORIES } from "../core/paths.js";
import { advanceStage, loadState } from "../core/state.js";
import { parseFrontmatterBlock } from "../core/frontmatter.js";
import { readLatestPublishedRows, type ArtifactKind } from "../io/store.js";
import { recordConfigBaseline, loadConfigManifest } from "../doctor/config-manifest.js";

/** One detected lost-advance (bookkeeping only — never content). */
export interface BookkeepingDrift {
	/** Stage the flag currently sits on (the publish transition's `from`). */
	from: Stage;
	/** Stage the flag SHOULD be on (the transition's `to`). */
	to: Stage;
	/** The transition's approve command (the audited actor name). */
	command: string;
	/** Positive evidence that the publish already succeeded this run. */
	evidence: string;
}

/** In-publish-stage → the artifact kind its approve writes to the store. */
const PUBLISH_STAGE_KIND: Partial<Record<Stage, ArtifactKind>> = {
	"drafting-prd": "prd",
	"building-rtm": "rtm",
	"analyzing-feasibility": "feasibility",
	designing: "design",
	"analyzing-atomic-functions": "atomic-functions",
	"writing-pseudocode": "pseudocode",
	"planning-tests": "testplan",
	"ordering-development": "development-order",
	"finalizing-design": "final-design",
};

/**
 * Positive evidence that `currentStage`'s approve already published this run.
 * @param {string} cwd - Project root.
 * @returns {string | null} Evidence line, or `null` when nothing proves a publish.
 */
function publishEvidence(cwd: string): string | null {
	const state = loadState(cwd);
	if (!state || state.runId === "" || state.currentStage === "none") return null;

	// Store-backed stages: published head must belong to this runId.
	const kind = PUBLISH_STAGE_KIND[state.currentStage];
	if (kind !== undefined) {
		try {
			const projectName = loadFilesConfig(cwd).projectName;
			if (!projectName) return null;
			const head = readLatestPublishedRows(cwd, projectName, kind);
			if (head === null) return null;
			if (head.envelope.runId !== state.runId) return null; // another run's publish ≠ evidence
			return `store head ${kind} v${head.envelope.version} belongs to run ${state.runId}`;
		} catch {
			return null; // corrupt config / unreadable store → no evidence, no drift
		}
	}

	// Brainstorm is file-based: published notes stamped with `run: <runId>`.
	if (state.currentStage === "brainstorming") {
		try {
			const dir = join(cwd, "Doc", "brainstorm");
			if (!existsSync(dir)) return null;
			for (const name of readdirSync(dir)) {
				if (!name.endsWith(".md")) continue;
				try {
					const fm = parseFrontmatterBlock(readFileSync(join(dir, name), "utf8"));
					if (fm !== null && fm.fields["artifact"] === "brainstorm" && fm.fields["run"] === state.runId) {
						return `published notes ${join("Doc", "brainstorm", name)} stamped run ${state.runId}`;
					}
				} catch {
					/* unreadable note — skip */
				}
			}
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Detect lost stage-flag advances (positive evidence only).
 * @param {string} cwd - Project root.
 * @returns {BookkeepingDrift[]} Zero or more drifts (fail-soft — errors yield `[]`).
 */
export function detectBookkeepingDrift(cwd: string): BookkeepingDrift[] {
	const out: BookkeepingDrift[] = [];
	try {
		const state = loadState(cwd);
		if (!state || state.runId === "" || state.currentStage === "none") return out;
		// Only APPROVE transitions represent a publish (rule 1: iterate
		// STAGE_TRANSITIONS read-only; stage-start commands are excluded —
		// handoff and `/velpari-<stage>` starts are never auto-advanced).
		const candidates = STAGE_TRANSITIONS.filter(
			(t) => t.from === state.currentStage && t.command.includes("approve"),
		);
		if (candidates.length === 0) return out;
		const evidence = publishEvidence(cwd);
		if (evidence === null) return out;
		for (const t of candidates) {
			out.push({ from: t.from, to: t.to, command: t.command, evidence });
		}
	} catch {
		return [];
	}
	return out;
}

/**
 * Apply one bookkeeping advance through the normal audited path.
 * @param {string} cwd - Project root.
 * @param {BookkeepingDrift} drift - The drift to close (from `detectBookkeepingDrift`).
 * @returns {{ ok: boolean; message: string }} `ok=true` when the stage advanced and history was written.
 */
export function applyBookkeepingAdvance(cwd: string, drift: BookkeepingDrift): { ok: boolean; message: string } {
	try {
		const state = loadState(cwd);
		if (!state) return { ok: false, message: "no run state — nothing to advance" };
		if (state.currentStage !== drift.from) {
			return { ok: false, message: `stage already moved to ${state.currentStage} — nothing to advance` };
		}
		const next = advanceStage(state, drift.command, cwd);
		return {
			ok: true,
			message: `${drift.from} → ${next.currentStage} via ${drift.command} (history line written)`,
		};
	} catch (err) {
		return { ok: false, message: (err as Error)?.message ?? String(err) };
	}
}

/**
 * The expected standard scaffold as repo-relative paths (read-only view —
 * single source of truth shared with `ensureStandardScaffold`).
 * @param {string} cwd - Project root (unused, kept for signature symmetry).
 * @returns {string[]} Expected relative paths: run dirs + Doc categories + config baseline.
 */
function standardScaffoldPaths(cwd: string): string[] {
	void cwd;
	const rels = [".IDE_Plans/velpari", ".IDE_Plans/velpari/runs"];
	for (const cat of [...new Set(Object.values(GROUPED_CATEGORIES))]) rels.push(join("Doc", cat));
	rels.push(".pi/velpari/config-manifest.json");
	return rels;
}

/**
 * Read-only: which standard scaffold paths are currently missing — the
 * preflight row 8 probe (non-blocking `info` finding, fixable via
 * `scaffold-missing` in the confirm-gated batch). Never creates anything.
 * @param {string} cwd - Project root.
 * @returns {string[]} Repo-relative missing paths (empty = scaffold complete).
 */
export function scaffoldMissingPaths(cwd: string): string[] {
	try {
		return standardScaffoldPaths(cwd).filter((rel) => !existsSync(join(cwd, rel)));
	} catch {
		return []; // fail-soft — a probe error never blocks the preflight
	}
}

/**
 * Create the missing standard scaffold (dirs + config baseline when absent).
 * Never writes `files.json`/`agents.json` content — record-only for the
 * baseline (confirm-gated by the fix flow before this is ever called).
 * @param {string} cwd - Project root.
 * @returns {{ created: string[]; message: string }} Paths created this call (empty = already healthy).
 */
export function ensureStandardScaffold(cwd: string): { created: string[]; message: string } {
	const created: string[] = [];
	try {
		// Run-state dirs + Doc/ category dirs (shared path list above).
		for (const rel of standardScaffoldPaths(cwd)) {
			if (rel.endsWith(".json")) continue; // the baseline is handled below (a file, not a dir)
			const abs = join(cwd, rel);
			if (!existsSync(abs)) {
				mkdirSync(abs, { recursive: true });
				created.push(rel);
			}
		}
		// Config baseline — only when none exists (delegates to THE writer).
		if (loadConfigManifest(cwd) === null) {
			recordConfigBaseline(cwd);
			if (loadConfigManifest(cwd) !== null) created.push(".pi/velpari/config-manifest.json");
		}
	} catch (err) {
		return {
			created,
			message: `scaffold partially created (${created.length} path(s)), then failed: ${(err as Error)?.message ?? String(err)}`,
		};
	}
	return {
		created,
		message: created.length === 0
			? "standard scaffold already present"
			: `created ${created.length} path(s): ${created.join(", ")}`,
	};
}
