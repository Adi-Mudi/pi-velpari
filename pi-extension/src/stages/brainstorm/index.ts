/**
 * /velpari-brainstorm handler (lifecycle v3 — AUTOMATIC SPAWN + understand-first).
 *
 * Bespoke by design — this handler stays outside STAGE_REGISTRY because of
 * three data-flow concerns that would leak UI state into the data model:
 *   1. The seed guard + run creation happen here, deterministically, before
 *      any LLM involvement.
 *   2. The interview is NOT owned by the handler anymore (lifecycle v2):
 *      the parent LLM runs the conversational UNDERSTAND → CONFIRM loop,
 *      the scan-plan gate (legacy one-shot fallback), and the DISCUSS loop,
 *      driven by `skills/velpari-brainstorm.md`. The handler only hands off.
 *   3. Stage does not advance state on its own; `/velpari-approve-brainstorm`
 *      owns the brainstorming -> brainstormed -> drafting-prd transition.
 *
 * Handler phase (deterministic, runs in this function):
 * 1. Refuse an empty seed (guardSeedInput).
 * 2. Load state + framework config.
 * 2b. Stage guard (v2.2): refuse re-run if run has advanced past brainstorming.
 * 3. Create run if `currentStage === "none"`.
 * 3.5. v3 — AUTOMATIC SPAWN: bootstrap the 2 persistent sub-agent
 *      definitions into `.pi/agents/`; build the 2 prepared subagent()
 *      calls (the parent LLM executes them on first turn and persists
 *      the session handles via `velpari_brainstorm_session spawn-sessions`).
 * 4. Bootstrap 4 scout agents into `.pi/agents/` if missing (legacy fallback path).
 * 5. Build artifact paths for this run.
 * 6. Build stage prompt with run context + AUTOMATIC SPAWN block +
 *    Active sub-agents block (when state already has handles) + scan
 *    plan / existing context / answers / skill.
 * 7. Hand off via `pi.sendUserMessage(prompt)`.
 * 8. Notify user with location + lifecycle instructions.
 *
 * LLM phase (orchestrated by the parent LLM, driven by
 * `skills/velpari-brainstorm.md`):
 *   [1] AUTOMATIC SPAWN — execute the prepared subagent() calls and
 *       persist handles via spawn-sessions (NEW in v3)
 *   [2] UNDERSTAND — chat only, inline reads, NO subagents (parent may
 *       route web/doc-code questions to the persistent sessions)
 *   [3] CONFIRM loop + hard lock (velpari_brainstorm_session confirm-understanding)
 *   [4] INFORM — facts + questions with suggested answers
 *   [5] DISCUSS loop — route each user message per topic + question states
 *       via upsert-question; decisions ledger
 *   [6] BATCH CONFIRM
 *   [7] COVERAGE CHECK
 *   [8] APPROVE — Go / Clarify / Kill → /velpari-approve-brainstorm
 *                  (which fires subagent_interrupt on both panes)
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
 *   at the scan-plan gate (FR-52 consent preserved) OR routed implicitly
 *   to the persistent web-research session (v3 default).
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
import { spawnPersistentSessions } from "./spawn-sessions.js";
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
	const projectName = config.projectName ?? null;

	// 3. v3 — AUTOMATIC SPAWN. Opens 2 persistent sub-agent sessions
	//    (web-research + doc-code-analyst) right after createRun, BEFORE
	//    the UNDERSTAND step. The helper bootstraps the 2 agent .md files
	//    into `.pi/agents/` (idempotent — copies only missing files) and
	//    returns the prepared subagent() calls for the parent LLM to
	//    execute on first turn. Result.alreadySpawned means the handles
	//    are already persisted (rehydrate path).
	const spawn = spawnPersistentSessions({
		cwd,
		mission,
		projectName,
		onInstallNotice: (msg) => ctx.ui.notify(msg, "info"),
	});
	if (!spawn.ok) {
		ctx.ui.notify(`AUTOMATIC SPAWN failed: ${spawn.error}`, "error");
		return;
	}

	// 4. Bootstrap scout agents into `.pi/agents/` if missing.
	//    (Legacy one-shot fallback path — the v3 default uses the 2
	//    persistent sessions above; the 4 scouts stay available for
	//    users who prefer the legacy scan-gate flow.)
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

	// 5. Build the stage prompt. `answers` stays empty — the interview
	//    moved into the skill (UNDERSTAND loop). `webSearchAllowed` is
	//    DERIVED from `state.scansSelected.includes("community")` — true
	//    if the user picked community at the upfront scan gate OR added
	//    it via the v1.x dynamic-scan upgrade during DISCUSS. For fresh
	//    runs scansSelected is undefined and the renderer shows PENDING
	//    (scan gate has not run yet). When the scan gate already ran
	//    (re-entry into an active brainstorm with scansSelected set),
	//    the prompt renders the `## Scan Plan` block instead of the
	//    legacy `## Flags` section.
	const webSearchAllowed =
		state.scansSelected?.includes("community") === true;

	// v3 — re-read state after the spawn helper so we pick up any
	// handles that were persisted by the idempotency branch (rehydrate
	// path: handles were already in state, no fresh spawn needed).
	const postSpawnState = loadState(cwd);

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
			activeSubagents:
				spawn.alreadySpawned && postSpawnState.activeSubagents
					? postSpawnState.activeSubagents
					: undefined,
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

	// v3 — When the spawn helper emitted fresh calls (needsDispatch), prepend
	// a block that tells the parent LLM to execute them right now + persist
	// the handles via spawn-sessions. This is the only turn the prompt
	// carries the prepared calls explicitly; from the next turn onward,
	// state.activeSubagents is populated and the `## Active sub-agents`
	// block takes over.
	if (!spawn.alreadySpawned && spawn.needsDispatch) {
		const spawnBlock = [
			``,
			`## Step 1 — AUTOMATIC SPAWN (execute now)`,
			``,
			`Two persistent sub-agent sessions must open RIGHT NOW. `,
			`The handler has already prepared the calls. Execute them in `,
			`this exact order on your first action of this turn:`,
			``,
			`### Call 1 — open web-research session`,
			"```",
			`subagent({`,
			`  agent: "${spawn.calls[0]?.agent}",`,
			`  session: "${spawn.calls[0]?.session}",`,
			`  prompt: ${JSON.stringify(spawn.calls[0]?.prompt ?? "")},`,
			`})`,
			"```",
			``,
			`### Call 2 — open doc-code-analyst session`,
			"```",
			`subagent({`,
			`  agent: "${spawn.calls[1]?.agent}",`,
			`  session: "${spawn.calls[1]?.session}",`,
			`  prompt: ${JSON.stringify(spawn.calls[1]?.prompt ?? "")},`,
			`})`,
			"```",
			``,
			`After BOTH subagent() calls return the session handles, persist`,
			`them with:`,
			``,
			`velpari_brainstorm_session({`,
			`  action: "spawn-sessions",`,
			`  web: "<the web-research session handle>",`,
			`  docCode: "<the doc-code-analyst session handle>",`,
			`})`,
			``,
			`Once spawn-sessions lands, the Active sub-agents block in every`,
			`following turn will list both handles. Then proceed to [2]`,
			`UNDERSTAND.`,
			``,
		].join("\n");
		prompt = spawnBlock + prompt;
	}

	// 6. Hand off to the parent LLM. It runs the lifecycle: UNDERSTAND →
	//    CONFIRM (hard lock) → scan gate → visible scout scans → DISCUSS →
	//    coverage check → approve.
	pi.sendUserMessage(prompt);

	// 7. Notify user with location + lifecycle instructions.
	const topicSlug = slugify(mission);
	const spawnMessage = spawn.alreadySpawned
		? "Sub-agent sessions already running (rehydrate). "
		: "Sub-agent panes opening in right column (web-research + doc-code-analyst). ";
	ctx.ui.notify(
		`Brainstorm started for: ${mission}\n` +
			`Run: ${state.runId}\n` +
			`Working copy target: ${brainstormNotes}\n` +
			`Published copy target: Doc/brainstorm/brainstorm-${topicSlug}.md\n` +
			spawnMessage +
			`The parent LLM now runs the lifecycle: routes each user message to the right sub-agent ` +
			`(web topic -> web-research, doc/code topic -> doc-code-analyst, otherwise parent answers ` +
			`directly), understands your request, confirms it with you, and discusses decisions. ` +
			`When the notes are ready, run /velpari-approve-brainstorm to publish. The graceful close ` +
			`fires subagent_interrupt on both panes.`,
		"info",
	);
}
