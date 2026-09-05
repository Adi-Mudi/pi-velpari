/**
 * Stage runner (Phase 1 of the all-stages refactor).
 *
 * Common two-phase flow used by every stage command that spawns visible
 * subagents (prd, rtm, feasibility, design, pseudocode, testplan,
 * atomic-function, development-order). Mirrors the pattern in
 * `discuss.ts` (commit a25e975) but factored out so each per-stage handler
 * can be ~50 lines.
 *
 * Phase 1 (handler): validate config, bootstrap agents, build prompt,
 *   hand off to parent LLM via `pi.sendUserMessage(prompt)`.
 *
 * Phase 2 (parent LLM, driven by the stage's skill markdown):
 *   spawn N subagents in parallel via `subagent()` tool,
 *   wait, read reports, optionally iterate, write working copy,
 *   show preview gate, tell user to run `/velpari-approve`.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Stage } from "./constants.js";
import { ensureStageAgents, formatScoutAgentsInstalledMessage } from "./agents-install.js";
import { buildStagePrompt, type ScoutSlot } from "./prompt.js";
import type { CompactProfileMetadata } from "./profile.js";

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
	/** Mission string for the metadata block. */
	mission: string;
	/** Framework line (per FR-49) — from `.pi/velpari/files.json`. */
	framework: string | undefined;
	/** Run id (used in metadata block). */
	runId: string | undefined;
	/** Stage-specific scout agents (must exist in `skills/agents/<id>.md`). */
	scouts: readonly ScoutSlot[];
	/** Absolute path to the input artifact (e.g. `Doc/discussion-<slug>.md` for prd). */
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
	 * Optional: web-search consent flag (currently only discuss uses this).
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
 *  - Mutate `state.stage` (advance is `/velpari-approve`'s job).
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

	// 1. Bootstrap agents.
	const scoutIds = config.scouts.map((s) => s.name);
	const bootstrap = ensureStageAgents(scoutIds, cwd);
	const msg = formatScoutAgentsInstalledMessageForStage(bootstrap);
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
			profileMetadata: config.profileMetadata ?? null,
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
	ctx.ui.notify(
		`Stage "${config.stage}" started for: ${config.mission}\n` +
			`Scouts: ${scoutList}\n` +
			`Scout reports: ${config.scoutsDir}\n` +
			`Working copy target: ${config.workingCopyPath}\n` +
			`The parent LLM is now orchestrating the ${config.scouts.length} subagents (visible panes). ` +
			`When the working copy is ready, run /velpari-approve to publish.`,
		"info",
	);

	// inputContent is intentionally read but not embedded directly; the stage
	// skill markdown instructs the LLM to read the input artifact itself via its
	// task argument. This keeps the prompt small.
	void inputContent;
}

/**
 * Render a notify message from an `ensureStageAgents` result. Reuses the
 * discuss-stage helper but works with the generic return shape.
 */
function formatScoutAgentsInstalledMessageForStage(result: { installed: string[]; alreadyPresent: string[]; missing: string[] }): string {
	const lines: string[] = [];
	if (result.installed.length > 0) {
		lines.push(`Installed ${result.installed.length} agent(s): ${result.installed.join(", ")}.`);
	}
	if (result.missing.length > 0) {
		lines.push(
			`⚠ Bundled agent file(s) missing for: ${result.missing.join(", ")}. ` +
				`/velpari-${stageCommandName(result.installed[0] ?? result.missing[0] ?? "")} will fail until you add them.`,
		);
	}
	return lines.join("\n");
}

/**
 * Best-effort mapping from agent name to a likely stage command name.
 * Used only for error messages; the actual stage is passed via StageRunConfig.
 */
function stageCommandName(agentId: string): string {
	// Heuristic: if any scout name starts with "fr-" or "nfr-" or "helper" assume prd;
	// if "requirement-" or "test-case" assume rtm; if "feas-" assume feasibility;
	// if "module-" or "contract-" assume design; if "algorithm-" assume pseudocode;
	// if "strategy-" or "unit-" assume testplan; if "af-" assume atomic-function;
	// if "do-" assume development-order; otherwise "discuss".
	if (/^(fr-|nfr-|helper-)/.test(agentId)) return "prd";
	if (/^(requirement-|test-case|coverage-)/.test(agentId)) return "rtm";
	if (/^feas-/.test(agentId)) return "feasibility";
	if (/^(module-|contract-|data-flow|error-)/.test(agentId)) return "design";
	if (/^(algorithm-|edge-|complexity-)/.test(agentId)) return "pseudocode";
	if (/^(strategy-|unit-|integration-)/.test(agentId)) return "testplan";
	if (/^af-/.test(agentId)) return "atomic-function";
	if (/^do-/.test(agentId)) return "development-order";
	return "discuss";
}