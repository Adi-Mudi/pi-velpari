/**
 * Stage registry — single source of truth for the 8 stage handlers
 * (prd, rtm, feasibility, design, atomic-function, pseudocode, testplan,
 * development-order, final-design).
 *
 * Each `StageSpec` captures every per-stage data item that previously lived
 * inline in each handler file: which Stage enum value drives the current
 * transition, which scout subagents run, where the working copy is written,
 * which inputs to read first (single or multi), and any output extras
 * (testplan writes both test-plan and test-cases).
 *
 * Adding a new stage in the future = one new entry in STAGE_REGISTRY plus
 * one new handler file that does `await runStage("<key>", ctx, pi, cwd)`.
 * No edits to commands.ts, no edits to other handlers, no edits to
 * stage-runner.ts.
 *
 * Why brainstorm + brainstorm-approve are NOT in this registry: brainstorm
 * runs the lifecycle v2 flow (conversational UNDERSTAND loop, scan gate,
 * decision ledger — see stages/brainstorm/ and skills/velpari-brainstorm.md),
 * and brainstorm-approve chains directly into the prd handler after
 * publishing. They are honest bespoke handlers, kept
 * out of the registry by design (see /velpari-brainstorm and /velpari-approve-brainstorm).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Stage } from "../core/constants.js";
import { loadFilesConfig } from "../core/config.js";
import {
	computeStaleSet,
	manifestKey,
	resolveDeclaredInputs,
	type StaleItem,
} from "../core/freshness.js";
import {
	computeLegalCommands,
	type StageLockSpec,
} from "./transition-lock.js";
import { loadOverlay } from "../core/standards-overlay.js";
import { bootstrapOverlayScouts } from "../io/agents-install.js";
import {
	buildGroupedPath as _buildGroupedPath,
	buildOutputPath,
	buildRunDir,
	buildWorkingGroupedPath,
	resolveBrainstormArtifact,
	resolveDocArtifact,
	slugify,
} from "../core/paths.js";
import { loadState } from "../core/state.js";
import {
	loadAgentConfig,
	resolveAgentName,
	type VelpariRole,
} from "../core/agents-config.js";
import type { ScoutSlot } from "../core/prompt.js";
import { findPackageRoot } from "../core/paths.js";
import {
	deriveAtomicProfile,
	shouldRunReviewer,
	type AtomicProfile,
} from "../core/atomic-tier.js";
import {
	compactProfileMetadata,
	loadRequirementsProfile,
} from "../core/profile.js";
import { runStageWithScouts, type StageRunConfig } from "../core/stage-runner.js";
import { ensureStageAgents } from "../io/agents-install.js";

/** Stages that route through the registry. (Brainstorm is bespoke.) */
export type StageKey =
	| "prd"
	| "rtm"
	| "feasibility"
	| "architecture-generator"
	| "pseudocode"
	| "testplan"
	| "atomic-function"
	| "development-order"
	| "final-design";

export const STAGE_KEYS = [
	"prd",
	"rtm",
	"feasibility",
	"architecture-generator",
	"pseudocode",
	"testplan",
	"atomic-function",
	"development-order",
	"final-design",
] as const satisfies readonly StageKey[];

/**
 * Hard stage gate (Senai `ensureStage` port): the Stage enum values from
 * which each stage command may start. Each entry lists (a) the completed
 * upstream stage that the command transitions FROM, and (b) the stage's
 * own in-progress value so re-running a stage already in flight (redraft
 * of the working copy) stays allowed. Anything else is a sequence break
 * and is rejected with the correct command named.
 *
 * THE sequence lock — before this map existed, runStage never checked
 * currentStage and any stage command could run at any time.
 */
export const STAGE_GATE: Record<StageKey, readonly Stage[]> = {
	prd: ["brainstormed", "drafting-prd"],
	rtm: ["drafted-prd", "building-rtm"],
	feasibility: ["built-rtm", "analyzing-feasibility"],
	"architecture-generator": ["analyzed-feasibility", "designing"],
	// Stage 6 — runs after Design (Stage 5) is approved; or while own draft is open (redraft).
	"atomic-function": ["designed", "analyzing-atomic-functions"],
	// Stage 7 — runs after Atomic Functions (Stage 6) is approved; or while own draft is open.
	pseudocode: ["analyzed-atomic-functions", "writing-pseudocode"],
	// Stage 8 — runs after Pseudocode (Stage 7) is approved; or while own draft is open.
	testplan: ["wrote-pseudocode", "planning-tests"],
	// Stage 9 — runs after Test Plan (Stage 8) is approved; or while own draft is open.
	"development-order": ["planned-tests", "ordering-development"],
	// Stage 10 — runs after Development Order (Stage 9) is approved; or while own draft is open.
	"final-design": ["ordered-development", "finalizing-design"],
};

/** A single input artifact for a stage. */
export interface StageInputDoc {
	/** `"doc"` resolves via projectName; `"brainstorm"` resolves via topicSlug. */
	kind: "doc" | "brainstorm";
	/** Doc artifact key for `resolveDocArtifact` (kind="doc"). */
	artifact?: string;
	/** Display label used when concatenating multi-input stages. */
	label: string;
	/** When true, missing input does NOT abort the stage (atomic-function's brainstorm). */
	optional?: boolean;
}

/** Per-stage not-found message. Preserves the pre-Phase-B byte-for-byte copy. */
type MissingInputMessageFormatter = (deps: {
	cwd: string;
	projectName: string;
	mission: string;
	topicSlug: string;
}) => string;

export interface StageSpec {
	/** Stable identifier used by handlers (e.g. STAGE_REGISTRY.prd). */
	key: StageKey;
	/** The Stage enum value passed to runStageWithScouts. */
	stageEnum: Stage;
	/** Skill-file basename for loadStageSkill (e.g. "prd", "rtm"). */
	skillName: string;
	/** 4 scout subagents per stage (per AGENTS.md principle 4). */
	scouts: readonly string[];
	/**
	 * Optional conditional agents (feasibility v2): bootstrapped alongside
	 * the wave scouts but NOT part of the parallel wave — the parent LLM
	 * spawns them only when the skill's conditions are met (reuse scan
	 * after web consent; spikes on the build-from-scratch path). Their
	 * resolved names are rendered into the prompt's conditional block.
	 */
	conditionalAgents?: readonly string[];
	/**
	 * Optional post-reviewers (Phase 7 of the custom-role upgrade).
	 * Spawned by the parent LLM AFTER the working copy is written and
	 * BEFORE the user-facing preview gate. They validate the working
	 * copy (e.g. pseudocode-reviewer checks tier compliance). Empty
	 * array = no post-reviewers (default for every stage).
	 *
	 * The reviewer agents are custom roles (defined in
	 * `.pi/velpari/custom-roles.json`); when the project's `.pi/agents/`
	 * does not have the reviewer file yet, the parent LLM skips the
	 * spawn with a friendly notice and the stage proceeds normally.
	 */
	postReviewers?: readonly string[];
	/** Working-copy category subfolder under <runDir>/ (e.g. "prd", "tests"). */
	workingCopyCategory: string;
	/** Working-copy artifact name (passed to buildWorkingGroupedPath). */
	workingCopyArtifact: string;
	/** Optional extras like testplan's test-cases. */
	additionalWorkingCopies?: readonly string[];
	/** Single- or multi-input list (length === 1 = single input). */
	inputs: readonly StageInputDoc[];
	/**
	 * Format the "cannot read X" / "cannot read brainstorm" error message when a
	 * required input is missing. Each stage has its own copy so the message
	 * keeps the pre-Phase-B wording byte-for-byte (test gate + UX).
	 */
	formatMissingError: MissingInputMessageFormatter;
}

// ---------------------------------------------------------------------------
// Pre-Phase-B error message templates. Kept byte-for-byte so the existing
// test gate stays green and the UX string the user sees is unchanged.
// ---------------------------------------------------------------------------

const grouped = (cwd: string, category: string, file: string) =>
	join(cwd, "Doc", category, file);

const prdMissingError: MissingInputMessageFormatter = ({ cwd, mission }) => {
	// Preserve the pre-refactor wording: prd used to fall through to
	// runStageWithScouts with the constructed grouped path, and the stage-runner
	// emitted "Cannot read input artifact at <path>: ENOENT...". Reproduce that
	// same shape here so the existing test gate stays green.
	const topicSlug = slugify(mission);
	const groupedPath = grouped(cwd, "brainstorm", `brainstorm-${topicSlug}.md`);
	return `Cannot read input artifact at ${groupedPath}: ENOENT, no such file or directory. Run /velpari-brainstorm and /velpari-approve-brainstorm first.`;
};

const docMissingError = (
	humanName: string,
	artifact: string,
	projectName: string,
	cwd: string,
	previousCommand: string,
): string => {
	const groupedPath = _buildGroupedPath(artifact, projectName);
	return `Cannot read ${humanName} for ${projectName}: not found at ${cwd}/${groupedPath} or ${cwd}/${buildOutputPath(artifact, projectName)}. Run ${previousCommand} and the publish tool first.`;
};

export const STAGE_REGISTRY: Record<StageKey, StageSpec> = {
	prd: {
		key: "prd",
		stageEnum: "drafting-prd",
		skillName: "prd",
		scouts: ["fr-extractor", "nfr-checker", "helper-detector", "consolidator"],
		workingCopyCategory: "prd",
		workingCopyArtifact: "PRD",
		inputs: [{ kind: "brainstorm", label: "brainstorm" }],
		formatMissingError: prdMissingError,
	},

	rtm: {
		key: "rtm",
		stageEnum: "building-rtm",
		skillName: "rtm",
		scouts: [
			"rtm-requirement-tracer",
			"rtm-test-case-linker",
			"rtm-coverage-analyzer",
			"rtm-consolidator",
		],
		workingCopyCategory: "rtm",
		workingCopyArtifact: "RTM",
		inputs: [{ kind: "doc", artifact: "PRD", label: "PRD" }],
		formatMissingError: ({ cwd, projectName }) =>
			docMissingError("PSRS", "PRD", projectName, cwd, "/velpari-prd"),
	},

	feasibility: {
		key: "feasibility",
		stageEnum: "analyzing-feasibility",
		skillName: "feasibility",
		scouts: [
			"feasibility-tech",
			"feasibility-schedule",
			"feasibility-cost",
			"feasibility-risk",
		],
		conditionalAgents: ["feasibility-reuse-scout", "feasibility-spike"],
		workingCopyCategory: "feasibility",
		workingCopyArtifact: "feasibility-study",
		inputs: [{ kind: "doc", artifact: "RTM", label: "RTM" }],
		formatMissingError: ({ cwd, projectName }) =>
			docMissingError("RTM", "RTM", projectName, cwd, "/velpari-rtm"),
	},

	"architecture-generator": {
		key: "architecture-generator",
		stageEnum: "designing",
		skillName: "architecture-generator",
		scouts: [
			"design-style-selector",
			"design-module-decomposer",
			"design-contract-definer",
			"design-data-flow-mapper",
			"design-error-definer",
			// Plan D — adversarial reviewer (tier + overlay gated).
			"design-reviewer",
		],
		workingCopyCategory: "design",
		workingCopyArtifact: "design",
		inputs: [{ kind: "doc", artifact: "feasibility-study", label: "feasibility-study" }],
		formatMissingError: ({ cwd, projectName }) =>
			docMissingError(
				"feasibility-study",
				"feasibility-study",
				projectName,
				cwd,
				"/velpari-feasibility",
			),
	},

	"atomic-function": {
		key: "atomic-function",
		// Stage 6 — required post-design. Runs from `designed` (upstream) or `analyzing-atomic-functions` (own redraft).
		stageEnum: "analyzing-atomic-functions",
		skillName: "atomic-function",
		scouts: [
			"af-source-rtm",
			"af-source-design",
			"af-source-prd",
			"af-source-feas",
			// Phase 3 of reviewer plan — adversarial reviewer is the 5th scout.
			// Spawned by the parent LLM after the 4 source scouts + draft merge,
			// before the preview gate. Tier + overlay gate is applied by the
			// filterReviewerSlot helper inside runStage (see below) — the slot
			// is removed when shouldRunReviewer returns false.
			"reviewer",
		],
		workingCopyCategory: "atomic-function",
		workingCopyArtifact: "atomic-functions",
		inputs: [
			{ kind: "brainstorm", label: "brainstorm", optional: true },
			{ kind: "doc", artifact: "PRD", label: "PRD" },
			{ kind: "doc", artifact: "RTM", label: "RTM" },
			{ kind: "doc", artifact: "feasibility-study", label: "feasibility-study" },
			{ kind: "doc", artifact: "design", label: "design" },
		],
		formatMissingError: ({ cwd, projectName }) =>
			atomicMissingError(projectName, cwd),
	},

	pseudocode: {
		key: "pseudocode",
		// Stage 7 — runs after Atomic Functions (Stage 6) is approved; or while own draft is open.
		stageEnum: "writing-pseudocode",
		skillName: "pseudocode",
		scouts: [
			"pseudo-algorithm-extractor",
			"pseudo-edge-case-handler",
			"pseudo-complexity-analyzer",
			"pseudo-consolidator",
			// Plan D — adversarial reviewer (tier + overlay gated).
			"pseudocode-reviewer",
		],
		// Custom-role upgrade (Phase 7): the pseudocode-reviewer sub-agent
		// validates the working copy against the tier rubric before the
		// user-facing preview. Generated via `/velpari-generate-sub-agents
		// --custom`. Missing reviewer file = skipped with a friendly notice.
		postReviewers: ["pseudocode-reviewer"],
		workingCopyCategory: "pseudocode",
		workingCopyArtifact: "pseudocode",
		inputs: [
			{ kind: "doc", artifact: "design", label: "design" },
			{ kind: "doc", artifact: "atomic-functions", label: "atomic-functions" },
		],
		formatMissingError: ({ cwd, projectName }) =>
			docMissingError("atomic-functions", "atomic-functions", projectName, cwd, "/velpari-atomic-function"),
	},

	testplan: {
		key: "testplan",
		// Stage 8 — runs after Pseudocode (Stage 7) is approved; or while own draft is open.
		stageEnum: "planning-tests",
		skillName: "testplan",
		scouts: [
			"testplan-strategy-designer",
			"testplan-unit-test-generator",
			"testplan-integration-test-generator",
			"testplan-coverage-tracer",
			// Plan D — adversarial reviewer (tier + overlay gated).
			"testplan-reviewer",
		],
		workingCopyCategory: "tests",
		workingCopyArtifact: "test-plan",
		additionalWorkingCopies: ["test-cases"],
		inputs: [
			{ kind: "doc", artifact: "pseudocode", label: "pseudocode" },
			{ kind: "doc", artifact: "atomic-functions", label: "atomic-functions" },
		],
		formatMissingError: ({ cwd, projectName }) =>
			docMissingError("pseudocode", "pseudocode", projectName, cwd, "/velpari-pseudocode"),
	},

	"development-order": {
		key: "development-order",
		// Stage 9 — runs after Test Plan (Stage 8) is approved; or while own draft is open.
		stageEnum: "ordering-development",
		skillName: "development-order",
		scouts: ["do-topology", "do-risk", "do-test", "do-value"],
		workingCopyCategory: "development-order",
		workingCopyArtifact: "development-order",
		inputs: [
			{ kind: "doc", artifact: "design", label: "design" },
			{ kind: "doc", artifact: "PRD", label: "PRD" },
			{ kind: "doc", artifact: "RTM", label: "RTM" },
			{ kind: "doc", artifact: "feasibility-study", label: "feasibility-study" },
			{ kind: "doc", artifact: "atomic-functions", label: "atomic-functions" },
			{ kind: "doc", artifact: "pseudocode", label: "pseudocode" },
			{ kind: "doc", artifact: "test-plan", label: "test-plan" },
			{ kind: "doc", artifact: "test-cases", label: "test-cases" },
		],
		formatMissingError: ({ cwd, projectName }) =>
			devOrderMissingError(projectName, cwd),
	},

	"final-design": {
		key: "final-design",
		// Stage 10 — runs after Development Order (Stage 9) is approved; or while own draft is open.
		stageEnum: "finalizing-design",
		skillName: "design",
		scouts: [
			"design-consistency-checker",
			"design-coverage-checker",
			"design-contract-checker",
			"design-finalizer",
		],
		workingCopyCategory: "final-design",
		workingCopyArtifact: "final-design",
		inputs: [
			{ kind: "doc", artifact: "design", label: "design" },
			{ kind: "doc", artifact: "atomic-functions", label: "atomic-functions" },
			{ kind: "doc", artifact: "pseudocode", label: "pseudocode" },
			{ kind: "doc", artifact: "test-plan", label: "test-plan" },
			{ kind: "doc", artifact: "test-cases", label: "test-cases" },
			{ kind: "doc", artifact: "development-order", label: "development-order" },
		],
		formatMissingError: ({ cwd, projectName }) =>
			finalDesignMissingError(projectName, cwd),
	},
};

/**
 * Lock specs for the transition lock (A1), in PIPELINE EXECUTION ORDER —
 * design → atomic-function → pseudocode → testplan (STAGE_KEYS is legacy
 * declaration order and must NOT be used for earliest-stale routing).
 * Derived from STAGE_GATE + STAGE_REGISTRY so stage data keeps exactly
 * one home; consumed by runStage, the publish tool, ops/approve, the
 * status surfaces, and the before_agent_start hook.
 */
export const STAGE_LOCK_SPECS: readonly StageLockSpec[] = (
	[
		"prd",
		"rtm",
		"feasibility",
		"architecture-generator",
		"atomic-function",
		"pseudocode",
		"testplan",
		"development-order",
		"final-design",
	] as const satisfies readonly StageKey[]
).map((key) => ({
	key,
	command: `/velpari-${key}`,
	gate: STAGE_GATE[key],
	workingCopyArtifact: STAGE_REGISTRY[key].workingCopyArtifact,
	inputs: STAGE_REGISTRY[key].inputs,
}));

// ---------------------------------------------------------------------------
// Atomic-function, development-order, final-design error messages. The
// "first failing input" is picked by walking the required list in order;
// that mirrors the pre-refactor handler, which emitted the same message for
// whichever artifact came first.
// ---------------------------------------------------------------------------

const AF_REQUIRED_ORDER = [
	"PRD",
	"RTM",
	"feasibility-study",
	"design",
] as const;

const DO_REQUIRED_ORDER = [
	"design",
	"PRD",
	"RTM",
	"feasibility-study",
	"atomic-functions",
	"pseudocode",
	"test-plan",
	"test-cases",
] as const;

const FINAL_DESIGN_REQUIRED_ORDER = [
	"design",
	"atomic-functions",
	"pseudocode",
	"test-plan",
	"test-cases",
	"development-order",
] as const;

function firstMissingArtifact(
	projectName: string,
	cwd: string,
	order: readonly string[],
): string {
	// Mirror `resolveDocArtifact` semantics: an artifact is "missing" only when
	// BOTH the grouped path AND the legacy flat path are absent. If either path
	// exists, the artifact is considered present (matching pre-Phase-B behaviour).
	for (const artifact of order) {
		const groupedFull = join(cwd, _buildGroupedPath(artifact, projectName));
		const legacyFull = join(cwd, buildOutputPath(artifact, projectName));
		if (existsSync(groupedFull)) continue;
		if (existsSync(legacyFull)) continue;
		return artifact;
	}
	return order[0]!;
}

function atomicMissingError(projectName: string, cwd: string): string {
	const artifact = firstMissingArtifact(projectName, cwd, AF_REQUIRED_ORDER);
	const groupedPath = _buildGroupedPath(artifact, projectName);
	return `Cannot run atomic-function: missing ${artifact} at ${cwd}/${groupedPath}. All previous stages (prd, rtm, feasibility, design) must be published.`;
}

function devOrderMissingError(projectName: string, cwd: string): string {
	const artifact = firstMissingArtifact(projectName, cwd, DO_REQUIRED_ORDER);
	const groupedPath = _buildGroupedPath(artifact, projectName);
	return `Cannot run development-order: missing ${artifact}. All previous stages (prd, rtm, feasibility, design, atomic-function, pseudocode, testplan) must be published. Path tried: ${cwd}/${groupedPath}.`;
}

function finalDesignMissingError(projectName: string, cwd: string): string {
	const artifact = firstMissingArtifact(projectName, cwd, FINAL_DESIGN_REQUIRED_ORDER);
	const groupedPath = _buildGroupedPath(artifact, projectName);
	return `Cannot run final-design: missing ${artifact}. All previous stages (prd, rtm, feasibility, design, atomic-function, pseudocode, testplan, development-order) must be published before final-design runs. Path tried: ${cwd}/${groupedPath}.`;
}

interface ResolveInputsDeps {
	cwd: string;
	projectName: string;
	mission: string;
}

export type ResolveInputsResult =
	| {
			ok: true;
			/** First resolved input path (used as StageRunConfig.inputArtifactPath for single-input stages). */
			inputArtifactPath: string;
			/** Concatenated contents of all resolved inputs; undefined for single-input stages (caller reads from disk). */
			inputArtifactContent?: string;
	  }
	| { ok: false; error: string };

/**
 * Resolve every input declared by `spec.inputs`. Returns the first resolved
 * path (single-input stages) or all paths concatenated into one string
 * (multi-input stages where StageRunConfig expects inputArtifactContent).
 *
 * Required inputs that are missing return `{ ok: false, error }`. Optional
 * inputs that are missing are skipped.
 */
export function resolveStageInputs(
	spec: StageSpec,
	deps: ResolveInputsDeps,
): ResolveInputsResult {
	const paths: string[] = [];
	const labels: string[] = [];

	for (const input of spec.inputs) {
		const resolved = resolveOne(input, deps);
		if (!resolved) {
			if (input.optional) continue;
			const topicSlug = slugify(deps.mission);
			return {
				ok: false,
				error: spec.formatMissingError({
					cwd: deps.cwd,
					projectName: deps.projectName,
					mission: deps.mission,
					topicSlug,
				}),
			};
		}
		paths.push(resolved.path);
		labels.push(resolved.label);
	}

	if (paths.length === 0) {
		return { ok: false, error: `No inputs resolved for /velpari-${spec.key}.` };
	}

	if (paths.length === 1) {
		return { ok: true, inputArtifactPath: paths[0]! };
	}

	// Multi-input stage: read each file and concatenate.
	const sections: string[] = [];
	for (let i = 0; i < paths.length; i++) {
		const p = paths[i]!;
		const content = readFileSync(p, "utf8");
		sections.push(`## ${labels[i]}\n\n${content}`);
	}
	return {
		ok: true,
		inputArtifactPath: paths[0]!,
		inputArtifactContent: sections.join("\n\n---\n\n"),
	};
}

function resolveOne(
	input: StageInputDoc,
	deps: ResolveInputsDeps,
): { path: string; label: string } | null {
	if (input.kind === "brainstorm") {
		const topicSlug = slugify(deps.mission);
		const grouped = join(deps.cwd, "Doc", "brainstorm", `brainstorm-${topicSlug}.md`);
		const legacy = join(deps.cwd, `Doc/brainstorm-${topicSlug}.md`);
		if (existsSync(grouped)) return { path: grouped, label: input.label };
		if (existsSync(legacy)) return { path: legacy, label: input.label };
		const resolved = resolveBrainstormArtifact(topicSlug, deps.cwd);
		if (resolved) return { path: resolved.path, label: input.label };
		return null;
	}
	if (input.kind === "doc" && input.artifact) {
		const resolved = resolveDocArtifact(input.artifact, deps.projectName, deps.cwd);
		if (resolved) return { path: resolved.path, label: input.label };
		return null;
	}
	return null;
}

/**
 * Build the ScoutSlot list for a stage. Slots keep the ROLE id in `name`
 * and the role-keyed report path; `agentName` carries the resolved spawn
 * name from `.pi/velpari/agents.json` (identity when no mapping exists).
 */
export function buildScoutSlots(
	spec: StageSpec,
	scoutsDir: string,
	cwd: string,
): ScoutSlot[] {
	const agentConfig = loadAgentConfig(cwd);
	return spec.scouts.map((role) => ({
		name: role,
		reportPath: join(scoutsDir, `${role}-report.json`),
		agentName: resolveAgentName(agentConfig, role as VelpariRole),
	}));
}

/**
 * Map a stage to its reviewer role id. `undefined` for stages that have
 * no reviewer (Plan D — generalization to atomic-function / pseudocode /
 * testplan / design; the other stages pass through unchanged).
 *
 *   atomic-function           → "reviewer"
 *   pseudocode                → "pseudocode-reviewer"
 *   testplan                  → "testplan-reviewer"
 *   architecture-generator    → "design-reviewer"
 *   everything else           → undefined (no reviewer)
 */
const REVIEWER_BY_STAGE: Readonly<Record<StageKey, string | undefined>> = {
	"atomic-function": "reviewer",
	pseudocode: "pseudocode-reviewer",
	testplan: "testplan-reviewer",
	"architecture-generator": "design-reviewer",
	prd: undefined,
	rtm: undefined,
	feasibility: undefined,
	"development-order": undefined,
	"final-design": undefined,
};

/**
 * Filter the reviewer scout slot out when the tier + overlay gate says
 * the reviewer should not run for this stage iteration.
 *
 * Plan D — generalized to all 4 reviewer stages. Each stage has a
 * specific reviewer role (see REVIEWER_BY_STAGE); other stages pass
 * through unchanged. The gate logic is identical for every reviewer
 * stage (delegated to core/atomic-tier.ts:shouldRunReviewer).
 *
 * Decision logic (delegated to core/atomic-tier.ts:shouldRunReviewer):
 *   - reviewerMode = "never"       → reviewer slot removed (overrides all)
 *   - reviewerMode = "always"      → reviewer slot kept
 *   - overlay.requiresReviewer     → reviewer slot kept (overrides tier)
 *   - tier ∈ {intermediate, advanced} → reviewer slot kept (tier default)
 *   - tier ∈ {entry, basic}         → reviewer slot removed
 */
export function filterReviewerSlot(
	scouts: readonly ScoutSlot[],
	stageKey: StageKey,
	profile: AtomicProfile,
	overlayRequiresReviewer: boolean,
): ScoutSlot[] {
	const reviewerRole = REVIEWER_BY_STAGE[stageKey];
	if (!reviewerRole) return [...scouts];
	if (!scouts.some((s) => s.name === reviewerRole)) return [...scouts];
	const runReviewer = shouldRunReviewer({
		profile,
		overlayRequiresReviewer,
		reviewerMode: profile.reviewerMode,
	});
	if (runReviewer) return [...scouts];
	return scouts.filter((s) => s.name !== reviewerRole);
}

/**
 * Look up the `requiresReviewer` flag from the standards catalogue for the
 * given overlay id. Reads `skills/standards/catalogue.json` directly
 * (avoids a layering dependency on the higher-level catalogue loader).
 * Returns false on any parse error or unknown overlay.
 */
export function overlayRequiresReviewerFor(
	_cwd: string,
	overlayId: string,
): boolean {
	try {
		const path = join(
			findPackageRoot(fileURLToPath(import.meta.url)),
			"skills",
			"standards",
			"catalogue.json",
		);
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as {
			overlays?: Array<{ id: string; requiresReviewer?: boolean }>;
		};
		const entry = parsed.overlays?.find((o) => o.id === overlayId);
		return entry?.requiresReviewer === true;
	} catch {
		return false;
	}
}

/**
 * Generic stage runner used by every DRYed handler under stages/.
 *
 * Steps mirror the pre-refactor per-stage handlers exactly, so behaviour is
 * unchanged.
 */
export async function runStage(
	stageKey: StageKey,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	const spec = STAGE_REGISTRY[stageKey];

	// 1. Load state + config.
	const state = loadState(cwd);
	if (!state.runId) {
		ctx.ui.notify("No active run. Run /velpari-brainstorm first.", "error");
		return;
	}

	// 1b. Hard stage gate — the sequence can never be broken. ALL legality
	//     decisions delegate to the transition lock (A1): the STAGE_GATE
	//     redraft self-loops, the conditional feasibility skip, the
	//     brainstorm-open collapse (two doors), the stale declared-input
	//     hard-block, and the self-healing routing named in the reason.
	const lock = computeLegalCommands(cwd, STAGE_LOCK_SPECS);
	const gateReason = lock.reasonFor(`/velpari-${stageKey}`);
	if (gateReason) {
		ctx.ui.notify(gateReason, "error");
		return;
	}

	const config = loadFilesConfig(cwd);
	if (!config.projectName) {
		ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
		return;
	}
	const projectName = config.projectName;

	// 2. Resolve inputs.
	const inputs = resolveStageInputs(spec, { cwd, projectName, mission: state.mission });
	if (!inputs.ok) {
		ctx.ui.notify(inputs.error, "error");
		return;
	}

	// 2b. Stage-start freshness WARNINGS (A3 + A1). The hard block (declared
	//     input stale with reason input-changed / input-missing) already
	//     fired at 1b via the transition lock — reaching here means no
	//     actionable stale input remains. What stays: a legacy no-stamp
	//     declared input warns and continues (D7), and the stage's OWN
	//     previously-published output being stale only warns — this run is
	//     the remedy (update mode revises it).
	const staleSet = computeStaleSet(cwd);
	if (staleSet.length > 0) {
		const staleByKey = new Map(staleSet.map((s) => [s.key, s]));
		const declared = resolveDeclaredInputs(cwd, spec.inputs, {
			projectName,
			topicSlug: slugify(state.mission),
		});
		const legacyInputs: StaleItem[] = [];
		for (const input of declared) {
			const item = staleByKey.get(input.id);
			if (!item) continue;
			if (item.reason === "no-stamp") legacyInputs.push(item);
		}
		if (legacyInputs.length > 0) {
			ctx.ui.notify(
				`Freshness note: ${legacyInputs.map((i) => i.key).join(", ")} ` +
					`has no freshness stamp (pre-B4 publish) — republish to stamp. Continuing.`,
				"warning",
			);
		}
		const ownStale = staleByKey.get(manifestKey(spec.workingCopyArtifact, projectName));
		if (ownStale && ownStale.reason !== "no-stamp") {
			ctx.ui.notify(
				`Freshness note: published ${spec.workingCopyArtifact} is stale vs its inputs ` +
					`(${ownStale.changedInputs.join(", ")}) — this run revises it.`,
				"warning",
			);
		}
	}

	// 3. Build artifact paths.
	const runDir = buildRunDir(state.runId, cwd);
	const workingCopyDir = join(runDir, spec.workingCopyCategory);
	const scoutsDir = join(workingCopyDir, "scouts");
	const workingCopyPath = buildWorkingGroupedPath(
		cwd,
		state.runId,
		spec.workingCopyArtifact,
		projectName,
	);
	const additionalWorkingCopies = spec.additionalWorkingCopies?.map((a) =>
		buildWorkingGroupedPath(cwd, state.runId, a, projectName),
	);

	// 3b. Update-mode detection (living documents): when the published
	// artifact for this stage already exists, this run REVISES it. The
	// baseline is injected into the prompt as a read-only reference.
	let updateMode: StageRunConfig["updateMode"];
	const baseline = resolveDocArtifact(spec.workingCopyArtifact, projectName, cwd);
	if (baseline) {
		updateMode = {
			baselinePath: baseline.path,
			baselineContent: readFileSync(baseline.path, "utf8"),
		};
		ctx.ui.notify(
			`Update mode: published ${spec.workingCopyArtifact} found at ${baseline.path}. This run revises it.`,
			"info",
		);
	}

	// 4. Load profile metadata.
	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

	// 4a. Load atomic-function tier profile (ISO/IEC 29110 + IEC 61508/IEC 62304).
	// Tier-driven schema: the same atomic-function stage serves Entry / Basic /
	// Intermediate / Advanced projects; the prompt declares which fields are
	// required at the selected tier. Defaults when absent — backward compatible.
	const atomicProfile: AtomicProfile =
		stageKey === "atomic-function"
			? deriveAtomicProfile(config)
			: { tier: "basic", safetyClass: "A", sil: "none", overlayId: null };

	// 4b. Bootstrap + resolve conditional agents (feasibility v2): installed
	// like wave scouts, but spawned only when the skill's conditions are met.
	let conditionalAgents: StageRunConfig["conditionalAgents"];
	if (spec.conditionalAgents?.length) {
		const agentConfig = loadAgentConfig(cwd);
		ensureStageAgents([...spec.conditionalAgents], cwd, agentConfig);
		conditionalAgents = spec.conditionalAgents.map((role) => ({
			role,
			agentName: resolveAgentName(agentConfig, role as VelpariRole),
		}));
	}

	// 4c. Phase 5: overlay conditional scouts. When the active standards
	// overlay declares `extraScouts`, append them to the spawn list and
	// resolve their agent names via agents.json (overlay-* roles fall back
	// to the role name itself). The parent LLM sees them in the prompt's
	// conditional block and spawns them alongside the 4 base scouts.
	let overlayRequiresReviewer = false;
	if (state.standardsProfile) {
		const overlay = loadOverlay(cwd, state.standardsProfile.id);
		if (overlay && overlay.extraScouts.length > 0) {
			const overlayRoles = overlay.extraScouts.map((s) => s.role);
			// Overlay scouts are not bundled agents — bootstrap by copying
			// the overlay's scout markdown files into the project agents dir.
			bootstrapOverlayScouts(state.standardsProfile.id, overlayRoles, cwd);
		}
		// Phase 3 of reviewer plan: read requiresReviewer flag from the
		// catalogue.json entry for the active overlay (medical / industrial
		// / financial / cloud all set this true). Drives the reviewer tier
		// gate: if true, the reviewer slot is kept regardless of tier.
		overlayRequiresReviewer = overlayRequiresReviewerFor(cwd, state.standardsProfile.id);
	}

	// 4d. Phase 3 of reviewer plan: apply the tier + overlay gate to the
	// scout slot list. For atomic-function only, remove the `reviewer` slot
	// when shouldRunReviewer returns false. Other stages pass through.
	const allScouts = buildScoutSlots(spec, scoutsDir, cwd);
	const gatedScouts = filterReviewerSlot(
		allScouts,
		stageKey,
		atomicProfile,
		overlayRequiresReviewer,
	);

	// 5. Compose StageRunConfig and hand off.
	const stageConfig: StageRunConfig = {
		stage: spec.stageEnum,
		stageCommand: spec.key,
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: gatedScouts,
		inputArtifactPath: inputs.inputArtifactPath,
		inputArtifactContent: inputs.inputArtifactContent,
		workingCopyDir,
		workingCopyPath,
		scoutsDir,
		additionalWorkingCopies,
		conditionalAgents,
		cwd,
		profileMetadata,
		updateMode,
		atomicProfile,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}
