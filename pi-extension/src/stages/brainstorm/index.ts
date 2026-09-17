/**
 * /velpari-brainstorm handler (lifecycle v2 — understand-first).
 *
 * Bespoke by design — this handler stays outside STAGE_REGISTRY because of
 * three data-flow concerns that would leak UI state into the data model:
 *   1. The seed guard + run creation happen here, deterministically, before
 *      any LLM involvement.
 *   2. The interview is NOT owned by the handler anymore (lifecycle v2):
 *      the parent LLM runs the conversational UNDERSTAND → CONFIRM loop,
 *      the scan-plan gate, and the DISCUSS loop, driven by
 *      `skills/velpari-brainstorm.md`. The handler only hands off.
 *   3. Stage does not advance state on its own; `/velpari-approve-brainstorm`
 *      owns the brainstorming -> brainstormed -> drafting-prd transition.
 *
 * Handler phase (deterministic, runs in this function):
 * 1. Refuse an empty seed (guardSeedInput).
 * 2. Load state + framework config.
 * 2b. Stage guard (v2.2): refuse re-run if run has advanced past brainstorming.
 * 3. Create run if `currentStage === "none"`.
 * 4. Bootstrap 4 scout agents into `.pi/agents/` if missing (silent copy).
 * 4. Build artifact paths for this run (run dir, brainstorm dir, scouts dir).
 * 5. Build stage prompt with run context + the session-tool state so far
 *    (understandingConfirmed / scansSelected / scan-plan lines when the
 *    scan gate already ran — e.g. re-entry into an active brainstorm).
 * 6. Hand off via `pi.sendUserMessage(prompt)`.
 * 7. Notify user with location + lifecycle instructions.
 *
 * LLM phase (orchestrated by the parent LLM, driven by
 * `skills/velpari-brainstorm.md`):
 *   [0] UNDERSTAND — chat only, inline reads, NO subagents
 *   [1] CONFIRM loop + hard lock (velpari_brainstorm_session confirm-understanding)
 *   [2] SCAN-PLAN GATE — v2.1: ALWAYS asks via the picker (no default).
 *       Parent LLM calls `velpari_brainstorm_session request-scan-gate`
 *       which runs `runScanGatePicker` and persists the result.
 *   [3] SCANS — dispatcher-prepared visible scout subagents
 *   [4] INFORM — facts + questions with suggested answers
 *   [5] DISCUSS loop — question states via upsert-question; decisions ledger
 *   [6] BATCH CONFIRM
 *   [7] COVERAGE CHECK
 *   [8] APPROVE — Go / Clarify / Kill → /velpari-approve-brainstorm
 *
 * Notes (per AGENTS.md):
 * - Brainstorm is orthogonal; we do NOT mutate `state.currentStage`. The state
 *   already advanced to `brainstorming` in `createRun()`. Stage transitions
 *   happen in `/velpari-approve-brainstorm` (which advances to `brainstormed`).
 * - We do NOT write the working copy in this handler. The parent LLM does
 *   that during the DISCUSS loop (decisions are written immediately).
 * - The old fixed 6-question `ctx.ui.input` interview and the web-search
 *   `ctx.ui.confirm` are REMOVED (lifecycle v2): the interview is
 *   conversational, and web-search consent is now the community-scan choice
 *   at the scan-plan gate (FR-52 consent preserved).
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ensureScoutAgents, formatScoutAgentsInstalledMessage } from "../../io/agents-install.js";
import { loadAgentConfig, resolveAgentName } from "../../core/agents-config.js";
import { loadFilesConfig, type FilesConfig } from "../../core/config.js";
import { PATHS } from "../../core/constants.js";
import { detectMultiplexer, multiplexerRequiredMessage } from "../../core/multiplexer.js";
import { buildStagePrompt, type BrainstormExistingContext } from "../../core/prompt.js";
import { buildRunDir, resolveDocArtifact, slugify } from "../../core/paths.js";
import { loadRequirementsProfile } from "../../core/profile.js";
import { createRun, loadState, type RunState } from "../../core/state.js";
import { formatScanPlanLines } from "./dispatcher.js";
import { guardSeedInput, guardStageForBrainstorm } from "./guard.js";

/** Doc artifacts probed for the existing-context block (paths only). */
const PUBLISHED_ARTIFACT_KEYS = [
	"PRD",
	"RTM",
	"feasibility-study",
	"design",
	"pseudocode",
	"test-plan",
	"test-cases",
	"atomic-functions",
	"development-order",
] as const;

/**
 * Collect everything an already-in-flight project knows: published
 * artifacts under Doc/ (grouped + legacy fallback), the configured
 * project/framework, the selected requirements profile, previous run ids,
 * and this run's stage history. Pure existence probes + config reads —
 * content is read on demand by the parent LLM (Senai-style injection).
 *
 * Returns null on a truly fresh project (no published artifacts, no
 * config, no profile, no previous runs) so the prompt stays unchanged.
 */
function collectExistingContext(
	cwd: string,
	state: RunState,
	config: FilesConfig,
): BrainstormExistingContext | null {
	const publishedArtifacts: string[] = [];
	if (config.projectName) {
		for (const artifact of PUBLISHED_ARTIFACT_KEYS) {
			const resolved = resolveDocArtifact(artifact, config.projectName, cwd);
			if (resolved) publishedArtifacts.push(resolved.path);
		}
	}
	const publishedBrainstormDir = join(cwd, PATHS.DOC_DIR, "brainstorm");
	if (existsSync(publishedBrainstormDir)) {
		for (const entry of readdirSync(publishedBrainstormDir).sort()) {
			if (entry.endsWith(".md")) {
				publishedArtifacts.push(join(publishedBrainstormDir, entry));
			}
		}
	}

	const profile = loadRequirementsProfile(cwd);

	const previousRunIds: string[] = [];
	const runsDir = join(cwd, PATHS.RUNS_DIR);
	if (existsSync(runsDir)) {
		for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
			if (entry.isDirectory() && entry.name !== state.runId) {
				previousRunIds.push(entry.name);
			}
		}
		previousRunIds.sort();
	}

	const hasSignals =
		publishedArtifacts.length > 0 ||
		Boolean(config.projectName) ||
		Boolean(profile) ||
		previousRunIds.length > 0;
	if (!hasSignals) return null;

	return {
		publishedArtifacts,
		projectName: config.projectName,
		framework: config.framework?.language,
		profileId: profile?.profileId,
		previousRunIds,
		history: state.history.map((h) => `${h.stage} via ${h.command}`),
	};
}

export async function handleBrainstorm(
	mission: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	// 0. Multiplexer hard gate (v2.1). Velpari spawns visible scout
	//    subagents in multiplexer panes at the SCAN step. Fail fast before
	//    any state work so a brainstorm started outside a multiplexer
	//    cannot create an orphan run. The override env var lets wrappers
	//    and tests force a value.
	const mux = detectMultiplexer();
	if (mux.mux === "unknown") {
		ctx.ui.notify(multiplexerRequiredMessage(), "error");
		return;
	}

	// 1. Refuse an empty seed — the parent LLM needs at least one signal to
	//    anchor the UNDERSTAND step.
	const seedGuard = guardSeedInput(mission);
	if (!seedGuard.ok) {
		ctx.ui.notify(seedGuard.reason!, "error");
		return;
	}

	// 2. Load state + framework. Create a new run if `currentStage === "none"`.
	let state = loadState(cwd);

	// 2b. Stage guard (v2.2). Brainstorm is single-shot per run: only
	//     `none` (fresh) and `brainstorming` (resume) are allowed. Anything
	//     else means the previous brainstorm was approved or the run has
	//     advanced, and the correct next step is the next-stage command.
	//     Runs AFTER loadState (to know the stage) and BEFORE createRun (so
	//     a refused re-run does not overwrite the existing run).
	const stageGuard = guardStageForBrainstorm(state);
	if (!stageGuard.ok) {
		ctx.ui.notify(stageGuard.reason!, "error");
		return;
	}

	if (state.currentStage === "none") {
		state = createRun(mission, cwd);
	}
	const config = loadFilesConfig(cwd);
	const framework = config.framework?.language;

	// 3. Bootstrap scout agents into `.pi/agents/` if missing.
	const bootstrap = ensureScoutAgents(cwd);
	const bootstrapMessage = formatScoutAgentsInstalledMessage(bootstrap);
	if (bootstrapMessage) {
		ctx.ui.notify(bootstrapMessage, "info");
	}

	// 4. Build artifact paths for this run.
	const runDir = buildRunDir(state.runId, cwd);
	const brainstormDir = join(runDir, "brainstorm");
	const scoutsDir = join(runDir, "scouts");
	mkdirSync(brainstormDir, { recursive: true });
	mkdirSync(scoutsDir, { recursive: true });

	const extractorReport = join(scoutsDir, "extractor-report.json");
	const prdCheckerReport = join(scoutsDir, "prd-checker-report.json");
	const rtmCheckerReport = join(scoutsDir, "rtm-checker-report.json");
	const webSearchReport = join(scoutsDir, "web-search-report.json");
	const brainstormNotes = join(brainstormDir, "brainstorm-notes.md");

	// 5. Build the stage prompt. `answers` / `webSearchAllowed` are kept for
	//    back-compat but are empty/false — the interview + web-search consent
	//    moved into the skill (UNDERSTAND loop, community scan at the gate).
	//    When the scan gate already ran (re-entry), the prompt renders the
	//    `## Scan Plan` block instead of the legacy `## Flags` section.
	let prompt: string;
	try {
		prompt = buildStagePrompt({
			stage: state.currentStage,
			mission,
			framework,
			runId: state.runId,
			answers: [],
			webSearchAllowed: false,
			communityAgentName: resolveAgentName(loadAgentConfig(cwd), "web-search-agent"),
			scansSelected: state.scansSelected,
			understandingConfirmed: state.understandingConfirmed ?? false,
			scanPlanLines: state.scansSelected
				? formatScanPlanLines(state.scansSelected, cwd)
				: undefined,
			existingContext: collectExistingContext(cwd, state, config),
			paths: {
				extractorReport,
				prdCheckerReport,
				rtmCheckerReport,
				webSearchReport,
				brainstormNotes,
				scoutsDir,
			},
		});
	} catch (err) {
		ctx.ui.notify(
			`Failed to build stage prompt: ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
		return;
	}

	// 6. Hand off to the parent LLM. It runs the lifecycle: UNDERSTAND →
	//    CONFIRM (hard lock) → scan gate → visible scout scans → DISCUSS →
	//    coverage check → approve.
	pi.sendUserMessage(prompt);

	// 7. Notify user with location + lifecycle instructions.
	const topicSlug = slugify(mission);
	ctx.ui.notify(
		`Brainstorm started for: ${mission}\n` +
			`Run: ${state.runId}\n` +
			`Working copy target: ${brainstormNotes}\n` +
			`Published copy target: Doc/brainstorm/brainstorm-${topicSlug}.md\n` +
			`The parent LLM now runs the lifecycle: understand your request first, confirm it with you, ` +
			`then ask which scans to run (code/doc/community), dispatch visible scout subagents, ` +
			`and discuss decisions with you. When the notes are ready, run /velpari-approve-brainstorm to publish.`,
		"info",
	);
}
