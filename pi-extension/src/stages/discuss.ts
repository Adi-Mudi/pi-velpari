/**
 * /velpari-discuss handler (v2.0 — two-phase flow).
 *
 * Bespoke by design — Phase B refactor left this handler outside
 * STAGE_REGISTRY because of three data-flow concerns that would leak UI
 * state into the data model:
 *   1. Six-question native UI interview loop (`ctx.ui.input`) — answers are
 *      collected here and passed into the prompt.
 *   2. Web-search yes/no consent (`ctx.ui.confirm`) — gates the
 *      webSearchAllowed flag in the prompt.
 *   3. Stage does not advance state on its own; `/velpari-approve-discuss`
 *      owns the discussing -> discussed -> drafting-prd transition.
 *
 * Handler phase (deterministic, runs in this function):
 * 1. Validate mission arg.
 * 2. Load state + framework config; create run if `currentStage === "none"`.
 * 3. Bootstrap 4 scout agents into `.pi/agents/` if missing (silent copy).
 * 4. Run 6-question interview via `ctx.ui.input`.
 * 5. Ask web-search yes/no via `ctx.ui.confirm`.
 * 6. Build stage prompt with all context.
 * 7. Hand off via `pi.sendUserMessage(prompt)`.
 * 8. Notify user with location + next-step instructions.
 *
 * LLM phase (orchestrated by the parent LLM, driven by
 * `skills/velpari-discuss.md`):
 *   - Spawn 4 subagents in parallel via `subagent()` tool
 *   - Wait for completion
 *   - Read 4 reports
 *   - Optionally iterate with AskUserQuestion follow-ups
 *   - Write working copy `discussion-notes.md`
 *   - Show preview gate
 *   - Tell user → `/velpari-approve-discuss`
 *
 * Notes (per AGENTS.md):
 * - Discussion is orthogonal; we do NOT mutate `state.stage`. The state
 *   already advanced to `discussing` in `createRun()`. Stage transitions
 *   happen in `/velpari-approve-discuss` (which advances to `discussed`).
 * - We do NOT write the working copy in this handler. The parent LLM does
 *   that after reading the 4 scout reports.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ensureScoutAgents, formatScoutAgentsInstalledMessage } from "../core/agents-install.js";
import { loadFilesConfig } from "../core/config.js";
import { buildStagePrompt } from "../core/prompt.js";
import { buildRunDir, slugify } from "../core/paths.js";
import { createRun, loadState } from "../core/state.js";

/**
 * The 6 fixed interview questions asked one at a time via `ctx.ui.input`.
 * Matches the original `INTERVIEW_QUESTIONS` array — preserved for compatibility.
 */
const INTERVIEW_QUESTIONS = [
	"What are you building? (one sentence)",
	"Who is it for? (intended audience, primary user)",
	"What problem does it solve? (the pain point)",
	"What is explicitly out of scope? (anti-goals)",
	"Any constraints? (tech stack, deadlines, dependencies)",
	"What does success look like? (acceptance criteria, measurable outcomes)",
];

export async function handleDiscuss(
	mission: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	// 1. Load state + framework. Create a new run if `currentStage === "none"`.
	let state = loadState(cwd);
	if (state.currentStage === "none") {
		state = createRun(mission, cwd);
	}
	const config = loadFilesConfig(cwd);
	const framework = config.framework?.language;

	// 2. Bootstrap scout agents into `.pi/agents/` if missing.
	const bootstrap = ensureScoutAgents(cwd);
	const bootstrapMessage = formatScoutAgentsInstalledMessage(bootstrap);
	if (bootstrapMessage) {
		ctx.ui.notify(bootstrapMessage, "info");
	}

	// 3. Build artifact paths for this run.
	const runDir = buildRunDir(state.runId, cwd);
	const discussDir = join(runDir, "discuss");
	const scoutsDir = join(runDir, "scouts");
	mkdirSync(discussDir, { recursive: true });
	mkdirSync(scoutsDir, { recursive: true });

	const extractorReport = join(scoutsDir, "extractor-report.json");
	const prdCheckerReport = join(scoutsDir, "prd-checker-report.json");
	const rtmCheckerReport = join(scoutsDir, "rtm-checker-report.json");
	const webSearchReport = join(scoutsDir, "web-search-report.json");
	const discussionNotes = join(discussDir, "discussion-notes.md");

	// 4. Interview loop. Skip-on-empty breaks the loop without losing prior answers.
	const answers: string[] = [];
	for (const question of INTERVIEW_QUESTIONS) {
		const answer = await ctx.ui.input(question);
		if (answer === undefined || answer === "") break;
		answers.push(answer);
	}

	// 5. Web-search consent (FR-52). User-prompted, never auto-invoked.
	const webSearchAllowed = await ctx.ui.confirm(
		"Web search?",
		"Do you want me to search the web for community resources, official docs, " +
			"and similar projects related to your input?",
	);

	// 6. Build the stage prompt.
	let prompt: string;
	try {
		prompt = buildStagePrompt({
			stage: state.currentStage,
			mission,
			framework,
			runId: state.runId,
			answers,
			webSearchAllowed,
			paths: {
				extractorReport,
				prdCheckerReport,
				rtmCheckerReport,
				webSearchReport,
				discussionNotes,
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

	// 7. Hand off to the parent LLM. It will spawn 4 visible subagents,
	//    wait for them, iterate as needed, and write the working copy.
	pi.sendUserMessage(prompt);

	// 8. Notify user with location + next-step hint.
	const topicSlug = slugify(mission);
	ctx.ui.notify(
		`Discussion started for: ${mission}\n` +
			`Run: ${state.runId}\n` +
			`Scouts will write to: ${scoutsDir}\n` +
			`Working copy target: ${discussionNotes}\n` +
			`Published copy target: Doc/discussion-${topicSlug}.md\n` +
			`The parent LLM is now orchestrating the 4 scout subagents (visible panes). ` +
			`When the working copy is ready, review the preview and run /velpari-approve-discuss to publish.`,
		"info",
	);
}