/**
 * Stage registry — single source of truth for the 8 stage handlers
 * (prd, rtm, feasibility, design, pseudocode, testplan, atomic-function,
 * development-order).
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
 * Why discuss + discuss-approve are NOT in this registry: discuss has a
 * 6-question native UI interview + web-search consent + branches into prd,
 * which would require either data-flow state in the registry or splitting
 * the handler into many tiny functions. discuss-approve chains directly into
 * the prd handler after publishing. They are honest bespoke handlers, kept
 * out of the registry by design (see /velpari-discuss and /velpari-approve-discuss).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Stage } from "../core/constants.js";
import { loadFilesConfig } from "../core/config.js";
import {
	buildGroupedPath as _buildGroupedPath,
	buildOutputPath,
	buildRunDir,
	buildWorkingGroupedPath,
	resolveDiscussionArtifact,
	resolveDocArtifact,
	slugify,
} from "../core/paths.js";
import { loadState } from "../core/state.js";
import {
	compactProfileMetadata,
	loadRequirementsProfile,
} from "../core/requirements-profile.js";
import { runStageWithScouts, type StageRunConfig } from "../core/stage-runner.js";

/** Stages that route through the registry. (Discuss is bespoke.) */
export type StageKey =
	| "prd"
	| "rtm"
	| "feasibility"
	| "design"
	| "pseudocode"
	| "testplan"
	| "atomic-function"
	| "development-order";

export const STAGE_KEYS = [
	"prd",
	"rtm",
	"feasibility",
	"design",
	"pseudocode",
	"testplan",
	"atomic-function",
	"development-order",
] as const satisfies readonly StageKey[];

/** A single input artifact for a stage. */
export interface StageInputDoc {
	/** `"doc"` resolves via projectName; `"discussion"` resolves via topicSlug. */
	kind: "doc" | "discussion";
	/** Doc artifact key for `resolveDocArtifact` (kind="doc"). */
	artifact?: string;
	/** Display label used when concatenating multi-input stages. */
	label: string;
	/** When true, missing input does NOT abort the stage (atomic-function's discussion). */
	optional?: boolean;
}

/** Per-stage not-found message. Preserves the pre-Phase-B byte-for-byte copy. */
export type MissingInputMessageFormatter = (deps: {
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
	/** Working-copy category subfolder under <runDir>/ (e.g. "prd", "tests"). */
	workingCopyCategory: string;
	/** Working-copy artifact name (passed to buildWorkingGroupedPath). */
	workingCopyArtifact: string;
	/** Optional extras like testplan's test-cases. */
	additionalWorkingCopies?: readonly string[];
	/** Single- or multi-input list (length === 1 = single input). */
	inputs: readonly StageInputDoc[];
	/**
	 * Format the "cannot read X" / "cannot read discussion" error message when a
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
const legacy = (cwd: string, file: string) => join(cwd, "Doc", file);

const prdMissingError: MissingInputMessageFormatter = ({ cwd, mission }) => {
	// Preserve the pre-refactor wording: prd used to fall through to
	// runStageWithScouts with the constructed grouped path, and the stage-runner
	// emitted "Cannot read input artifact at <path>: ENOENT...". Reproduce that
	// same shape here so the existing test gate stays green.
	const topicSlug = slugify(mission);
	const groupedPath = grouped(cwd, "discussion", `discussion-${topicSlug}.md`);
	return `Cannot read input artifact at ${groupedPath}: ENOENT, no such file or directory. Run /velpari-discuss and /velpari-approve-discuss first.`;
};

const docMissingError = (
	humanName: string,
	artifact: string,
	projectName: string,
	cwd: string,
	previousCommand: string,
): string => {
	const groupedPath = _buildGroupedPath(artifact, projectName);
	return `Cannot read ${humanName} for ${projectName}: not found at ${cwd}/${groupedPath} or ${cwd}/${buildOutputPath(artifact, projectName)}. Run ${previousCommand} and /velpari-approve first.`;
};

export const STAGE_REGISTRY: Record<StageKey, StageSpec> = {
	prd: {
		key: "prd",
		stageEnum: "drafting-prd",
		skillName: "prd",
		scouts: ["fr-extractor", "nfr-checker", "helper-detector", "consolidator"],
		workingCopyCategory: "prd",
		workingCopyArtifact: "PRD",
		inputs: [{ kind: "discussion", label: "discussion" }],
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
		workingCopyCategory: "feasibility",
		workingCopyArtifact: "feasibility-study",
		inputs: [{ kind: "doc", artifact: "RTM", label: "RTM" }],
		formatMissingError: ({ cwd, projectName }) =>
			docMissingError("RTM", "RTM", projectName, cwd, "/velpari-rtm"),
	},

	design: {
		key: "design",
		stageEnum: "designing",
		skillName: "design",
		scouts: [
			"design-module-decomposer",
			"design-contract-definer",
			"design-data-flow-mapper",
			"design-error-definer",
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

	pseudocode: {
		key: "pseudocode",
		stageEnum: "writing-pseudocode",
		skillName: "pseudocode",
		scouts: [
			"pseudo-algorithm-extractor",
			"pseudo-edge-case-handler",
			"pseudo-complexity-analyzer",
			"pseudo-consolidator",
		],
		workingCopyCategory: "pseudocode",
		workingCopyArtifact: "pseudocode",
		inputs: [{ kind: "doc", artifact: "design", label: "design" }],
		formatMissingError: ({ cwd, projectName }) =>
			docMissingError("design", "design", projectName, cwd, "/velpari-design"),
	},

	testplan: {
		key: "testplan",
		stageEnum: "planning-tests",
		skillName: "testplan",
		scouts: [
			"testplan-strategy-designer",
			"testplan-unit-test-generator",
			"testplan-integration-test-generator",
			"testplan-coverage-tracer",
		],
		workingCopyCategory: "tests",
		workingCopyArtifact: "test-plan",
		additionalWorkingCopies: ["test-cases"],
		inputs: [{ kind: "doc", artifact: "pseudocode", label: "pseudocode" }],
		formatMissingError: ({ cwd, projectName }) =>
			docMissingError("pseudocode", "pseudocode", projectName, cwd, "/velpari-pseudocode"),
	},

	"atomic-function": {
		key: "atomic-function",
		// Atomic-function is optional post-pipeline — no Stage enum value.
		// Use "ordered-development" as a placeholder so buildStagePrompt succeeds.
		// (kept identical to the pre-refactor atomic-function.ts behaviour)
		stageEnum: "ordered-development",
		skillName: "atomic-function",
		scouts: [
			"af-source-rtm",
			"af-source-pseudocode",
			"af-source-prd",
			"af-source-testcases",
		],
		workingCopyCategory: "atomic-function",
		workingCopyArtifact: "atomic-functions",
		inputs: [
			{ kind: "discussion", label: "discussion", optional: true },
			{ kind: "doc", artifact: "PRD", label: "PRD" },
			{ kind: "doc", artifact: "RTM", label: "RTM" },
			{ kind: "doc", artifact: "feasibility-study", label: "feasibility-study" },
			{ kind: "doc", artifact: "design", label: "design" },
			{ kind: "doc", artifact: "pseudocode", label: "pseudocode" },
			{ kind: "doc", artifact: "test-plan", label: "test-plan" },
			{ kind: "doc", artifact: "test-cases", label: "test-cases" },
		],
		formatMissingError: ({ cwd, projectName }) =>
			atomicMissingError(projectName, cwd),
	},

	"development-order": {
		key: "development-order",
		stageEnum: "ordered-development",
		skillName: "development-order",
		scouts: ["do-topology", "do-risk", "do-test", "do-value"],
		workingCopyCategory: "development-order",
		workingCopyArtifact: "development-order",
		inputs: [
			{ kind: "doc", artifact: "design", label: "design" },
			{ kind: "doc", artifact: "RTM", label: "RTM" },
			{ kind: "doc", artifact: "feasibility-study", label: "feasibility-study" },
			{ kind: "doc", artifact: "PRD", label: "PRD" },
			{ kind: "doc", artifact: "test-plan", label: "test-plan" },
		],
		formatMissingError: ({ cwd, projectName }) =>
			devOrderMissingError(projectName, cwd),
	},
};

// ---------------------------------------------------------------------------
// Atomic-function and development-order error messages — preserve the
// pre-refactor byte-for-byte wording. The "first failing input" is picked
// by walking the required list in order; that matches the pre-refactor
// handler, which emitted the same message for whichever artifact came first.
// ---------------------------------------------------------------------------

const FEAS_REQUIRED_ORDER = [
	"PRD",
	"RTM",
	"feasibility-study",
	"design",
	"pseudocode",
	"test-plan",
	"test-cases",
] as const;

const DO_REQUIRED_ORDER = [
	"design",
	"RTM",
	"feasibility-study",
	"PRD",
	"test-plan",
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
	const artifact = firstMissingArtifact(projectName, cwd, FEAS_REQUIRED_ORDER);
	const groupedPath = _buildGroupedPath(artifact, projectName);
	return `Cannot run atomic-function: missing ${artifact} at ${cwd}/${groupedPath}. All previous stages (prd, rtm, feasibility, design, pseudocode, testplan) must be published.`;
}

function devOrderMissingError(projectName: string, cwd: string): string {
	const artifact = firstMissingArtifact(projectName, cwd, DO_REQUIRED_ORDER);
	const groupedPath = _buildGroupedPath(artifact, projectName);
	return `Cannot run development-order: missing ${artifact}. All previous stages (prd, rtm, feasibility, design, testplan) must be published. Path tried: ${cwd}/${groupedPath}.`;
}

export interface ResolveInputsDeps {
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
	if (input.kind === "discussion") {
		const topicSlug = slugify(deps.mission);
		const grouped = join(deps.cwd, "Doc", "discussion", `discussion-${topicSlug}.md`);
		const legacy = join(deps.cwd, `Doc/discussion-${topicSlug}.md`);
		if (existsSync(grouped)) return { path: grouped, label: input.label };
		if (existsSync(legacy)) return { path: legacy, label: input.label };
		const resolved = resolveDiscussionArtifact(topicSlug, deps.cwd);
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
		ctx.ui.notify("No active run. Run /velpari-discuss first.", "error");
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

	// 4. Load profile metadata.
	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);

	// 5. Compose StageRunConfig and hand off.
	const stageConfig: StageRunConfig = {
		stage: spec.stageEnum,
		mission: state.mission,
		framework: config.framework?.language,
		runId: state.runId,
		scouts: spec.scouts.map((name) => ({
			name,
			reportPath: join(scoutsDir, `${name}-report.json`),
		})),
		inputArtifactPath: inputs.inputArtifactPath,
		inputArtifactContent: inputs.inputArtifactContent,
		workingCopyDir,
		workingCopyPath,
		scoutsDir,
		additionalWorkingCopies,
		cwd,
		profileMetadata,
	};

	await runStageWithScouts(stageConfig, ctx, pi);
}
