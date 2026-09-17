/**
 * Stage runner (Phase 1 of the all-stages refactor).
 *
 * Common two-phase flow used by every stage command that spawns visible
 * subagents (prd, rtm, feasibility, design, pseudocode, testplan,
 * atomic-function, development-order). Mirrors the pattern in
 * `brainstorm.ts` (commit a25e975) but factored out so each per-stage handler
 * can be ~50 lines.
 *
 * Phase 1 (handler): validate config, bootstrap agents, build prompt,
 *   hand off to parent LLM via `pi.sendUserMessage(prompt)`.
 *
 * Phase 2 (parent LLM, driven by the stage's skill markdown):
 *   spawn N subagents in parallel via `subagent()` tool,
 *   wait, read reports, optionally iterate, write working copy,
 *   show preview gate, on preview-yes call the `velpari_stage_publish`
 *   tool (which runs `handleApprove` and advances the stage).
 */

import { mkdirSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Stage } from "./constants.js";
import { loadAgentConfig, resolveAgentName } from "./agents-config.js";
import { ensureStageAgents } from "../io/agents-install.js";
import { buildStagePrompt, type ScoutSlot } from "./prompt.js";
import type { CompactProfileMetadata } from "./profile.js";
import type { AtomicProfile } from "./atomic-tier.js";

/**
 * Configuration for a single stage run.
 *
 * Per-stage handlers build one of these and pass it to `runStageWithScouts`.
 * The runner is generic; the stage-specific behavior is encoded in the
 * stage skill markdown + the agent definitions.
 */
export interface StageRunConfig {
	/** Stage value (used to load the stage skill markdown). */
	stage: Stage;
	/** Stage command suffix for error messages (e.g. "prd" → /velpari-prd).
	 *  Comes from the registry spec key — never derived from agent names. */
	stageCommand?: string;
	/** Mission string for the metadata block. */
	mission: string;
	/** Framework line (per FR-49) — from `.pi/velpari/files.json`. */
	framework: string | undefined;
	/** Run id (used in metadata block). */
	runId: string | undefined;
	/** Stage-specific scout agents (must exist in `skills/agents/<id>.md`). */
	scouts: readonly ScoutSlot[];
	/** Absolute path to the input artifact (e.g. `Doc/brainstorm-<slug>.md` for prd). */
	inputArtifactPath: string;
	/** Working-copy directory under run/ (e.g. `<runDir>/prd`). */
	workingCopyDir: string;
	/** Absolute path where the parent LLM should write the final working-copy file. */
	workingCopyPath: string;
	/** Subdirectory for scout reports (e.g. `<runDir>/prd/scouts`). */
	scoutsDir: string;
	/**
	 * Optional: additional working-copy paths for stages that produce multiple
	 * outputs (e.g. testplan writes test-plan_<project>.md AND test-cases_<project>.md).
	 * The LLM is told to write the primary `workingCopyPath` plus each of these.
	 */
	additionalWorkingCopies?: readonly string[];
	/** Working directory (defaults to process.cwd()). */
	cwd?: string;
	/**
	 * Optional override: full path to the input artifact's contents to embed
	 * directly in the prompt. If omitted, the runner reads `inputArtifactPath`.
	 */
	inputArtifactContent?: string;
	/**
	 * Optional: web-search consent flag (currently only brainstorm uses this).
	 * Defaults to false.
	 */
	webSearchAllowed?: boolean;
	/**
	 * Optional: list of additional free-form strings to embed under
	 * `## Interview Answers`. Defaults to empty.
	 */
	answers?: readonly string[];
	/**
	 * Optional (Phase 7): compact profile metadata injected into the
	 * stage prompt. Only the compact projection is carried — never the
	 * full profile. When absent, the prompt omits the profile block.
	 */
	profileMetadata?: CompactProfileMetadata | null;
	/**
	 * Optional (living documents): update mode. When the stage's published
	 * artifact already exists, the registry passes its path + full content
	 * and the prompt revises the baseline instead of regenerating.
	 */
	updateMode?: { baselinePath: string; baselineContent: string } | null;
	/**
	 * Optional (feasibility v2): conditional agents bootstrapped by the
	 * registry but spawned only when the skill's conditions are met
	 * (reuse scout after web consent; spike agents on the
	 * build-from-scratch path). Rendered as a prompt block so the parent
	 * LLM knows the resolved agent names.
	 */
	conditionalAgents?: readonly { role: string; agentName: string }[];
	/**
	 * Optional (atomic-function stage only): tier profile loaded from
	 * `.pi/velpari/files.json:atomic` (ISO/IEC 29110 + IEC 61508/IEC 62304).
	 * Rendered as a `## Atomic Profile` block so the parent LLM knows which
	 * fields are required at the selected tier. Defaults applied by the
	 * registry when absent.
	 */
	atomicProfile?: AtomicProfile | null;
}

/**
 * Run the two-phase stage flow.
 *
 * Steps:
 *  1. Bootstrap scout agents into `.pi/agents/` if missing.
 *  2. Read the input artifact (unless content pre-provided).
 *  3. Build the stage prompt via `buildStagePrompt`.
 *  4. Hand off via `pi.sendUserMessage(prompt)`.
 *  5. Notify user with location + scout location + next-step hint.
 *
 * The handler does NOT:
 *  - Write the working copy (LLM's job).
 *  - Mutate `state.stage` (advance is the `velpari_stage_publish` tool's
 *    job, which calls `the publish tool` internally).
 *
 * If the user declines the gate or any precondition fails, the handler
 * returns early without calling `pi.sendUserMessage`.
 */
export async function runStageWithScouts(
	config: StageRunConfig,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
): Promise<void> {
	const cwd = config.cwd ?? process.cwd();
	const agentConfig = loadAgentConfig(cwd);

	// 1. Bootstrap agents. Roles remapped to custom agent names in
	//    agents.json are skipped — the custom agent must already exist.
	const scoutIds = config.scouts.map((s) => s.name);
	const bootstrap = ensureStageAgents(scoutIds, cwd, agentConfig);
	const msg = formatScoutAgentsInstalledMessageForStage(bootstrap, config.stageCommand ?? "status");
	if (msg) {
		ctx.ui.notify(msg, "info");
	}

	// 2. Read input artifact if not provided inline.
	let inputContent = config.inputArtifactContent;
	if (inputContent === undefined) {
		try {
			inputContent = readFileSync(config.inputArtifactPath, "utf8");
		} catch (err) {
			ctx.ui.notify(
				`Cannot read input artifact at ${config.inputArtifactPath}: ` +
					`${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			return;
		}
	}

	// 3. Build working-copy directory (LLM will write into it later).
	mkdirSync(config.workingCopyDir, { recursive: true });
	mkdirSync(config.scoutsDir, { recursive: true });

	// 4. Build the prompt.
	let prompt: string;
	try {
		const additionalLines = (config.additionalWorkingCopies ?? []).map((p) => `    additional: ${p}`).join("\n");
		const workingCopyField = additionalLines
			? `${config.workingCopyPath}\n${additionalLines}`
			: config.workingCopyPath;
		prompt = buildStagePrompt({
			stage: config.stage,
			mission: config.mission,
			framework: config.framework,
			runId: config.runId,
			answers: config.answers ?? [],
			webSearchAllowed: config.webSearchAllowed ?? false,
			communityAgentName: resolveAgentName(agentConfig, "web-search-agent"),
			profileMetadata: config.profileMetadata ?? null,
			updateMode: config.updateMode ?? null,
			conditionalAgents: config.conditionalAgents ?? null,
			atomicProfile: config.atomicProfile ?? null,
			paths: {
				scouts: [...config.scouts],
				inputArtifact: config.inputArtifactPath,
				inputArtifactContent: config.inputArtifactContent,
				workingCopy: workingCopyField,
				scoutsDir: config.scoutsDir,
			},
		});
	} catch (err) {
		ctx.ui.notify(
			`Failed to build stage prompt: ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
		return;
	}

	// 5. Hand off to parent LLM.
	pi.sendUserMessage(prompt);

	// 6. Notify user.
	const scoutList = config.scouts.map((s) => s.name).join(", ");
	const modeLine = config.updateMode
		? `Mode: UPDATE (baseline: ${config.updateMode.baselinePath})\n`
		: "";
	ctx.ui.notify(
		`Stage "${config.stage}" started for: ${config.mission}\n` +
			modeLine +
			`Scouts: ${scoutList}\n` +
			`Scout reports: ${config.scoutsDir}\n` +
			`Working copy target: ${config.workingCopyPath}\n` +
			`The parent LLM is now orchestrating the ${config.scouts.length} subagents (visible panes). ` +
			`When the working copy is ready and the user confirms the preview, publish via the velpari_stage_publish tool.`,
		"info",
	);

	// inputContent is intentionally read but not embedded directly; the stage
	// skill markdown instructs the LLM to read the input artifact itself via its
	// task argument. This keeps the prompt small.
	void inputContent;
}

/**
 * Render a notify message from an `ensureStageAgents` result. Reuses the
 * brainstorm-stage helper but works with the generic return shape.
 * `stageCommand` is the registry spec key (e.g. "prd") — the stage command
 * is never derived from agent names (custom names break name heuristics).
 */
function formatScoutAgentsInstalledMessageForStage(
	result: { installed: string[]; alreadyPresent: string[]; missing: string[] },
	stageCommand: string,
): string {
	const lines: string[] = [];
	if (result.installed.length > 0) {
		lines.push(`Installed ${result.installed.length} agent(s): ${result.installed.join(", ")}.`);
	}
	if (result.missing.length > 0) {
		lines.push(
			`⚠ Bundled agent file(s) missing for: ${result.missing.join(", ")}. ` +
				`/velpari-${stageCommand} will fail until you add them.`,
		);
	}
	return lines.join("\n");
}