/**
 * /velpari-discuss handler.
 *
 * Flow:
 * 1. Multi-turn interview (6 questions, one at a time)
 * 2. Ask: "web search?" (FR-52)
 * 3. Run 3 mandatory scouts + 1 optional web search
 * 4. DECISION merge: classify each input as new-fr, update-fr, helper-update, new-helper
 * 5. Write working copy to .IDE_Plans/velpari/runs/<run-id>/discuss/discussion-notes.md
 * 6. Render preview + ask user to confirm
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "./config.js";
import { loadStageSkill } from "./prompt.js";
import { createRun, loadState, saveState } from "./state.js";
import { buildRunDir, slugify } from "./paths.js";
import { runScout } from "./scout.js";
import { runExtractor, type ExtractorProposal } from "./scouts/extractor.js";
import { runPrdChecker, type PrdCheckerProposal } from "./scouts/prd-checker.js";
import { runRtmChecker, type RtmCheckerProposal } from "./scouts/rtm-checker.js";
import { runWebSearch, type WebSearchProposal } from "./scouts/web-search-agent.js";

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
	cwd: string = process.cwd(),
): Promise<void> {
	// 1. Interview loop
	const answers: string[] = [];
	for (const question of INTERVIEW_QUESTIONS) {
		const answer = await ctx.ui.input(question);
		if (answer === undefined || answer === "") break;
		answers.push(answer);
	}

	// 2. Web search prompt (FR-52)
	const webSearchAllowed = await ctx.ui.confirm(
		"Web search?",
		"Do you want me to search the web for community resources, official docs, " +
			"and similar projects related to your input?",
	);

	// 3. Run scouts (3 mandatory + 1 optional)
	const config = loadFilesConfig(cwd);
	const existingState = loadState(cwd);
	const existingPrd = existingState.runId ? undefined : undefined; // Phase B: skip read
	const existingRtm = undefined;
	const scoutInput = {
		mission,
		interviewAnswers: answers,
		framework: config.framework?.language,
		existingPrd,
		existingRtm,
		webSearchAllowed,
	};

	const [extractorOut, prdCheckerOut, rtmCheckerOut, webSearchOut] = await Promise.all([
		runScout<ExtractorProposal>("extractor", runExtractor, scoutInput),
		runScout<PrdCheckerProposal>("prd-checker", runPrdChecker, scoutInput),
		runScout<RtmCheckerProposal>("rtm-checker", runRtmChecker, scoutInput),
		webSearchAllowed
			? runScout<WebSearchProposal>("web-search-agent", runWebSearch, scoutInput)
			: Promise.resolve({
					proposals: [] as Array<{ id: string; source: "web-search-agent"; payload: WebSearchProposal }>,
					source: "web-search-agent" as const,
					timestamp: new Date().toISOString(),
				}),
	]);

	// 4. DECISION merge (deterministic post-scout processing per FR-27)
	const decision = mergeProposals(extractorOut, prdCheckerOut, rtmCheckerOut);

	// 5. Create or update run state
	let state = existingState;
	if (state.currentStage === "none") {
		state = createRun(mission, cwd);
	}

	const runDir = buildRunDir(state.runId, cwd);
	const discussDir = join(runDir, "discuss");
	mkdirSync(discussDir, { recursive: true });

	// 6. Write working copy
	const notes = renderDiscussionNotes(mission, answers, extractorOut, prdCheckerOut, rtmCheckerOut, webSearchOut, decision);
	const workingPath = join(discussDir, "discussion-notes.md");
	writeFileSync(workingPath, notes, "utf8");

	// 7. Preview gate (FR-23)
	const confirmed = await ctx.ui.confirm(
		"Publish discussion notes?",
		`Working copy written to ${workingPath}. Publish to Doc/discussion-${slugify(mission)}.md?`,
	);
	if (confirmed) {
		// Phase C wires the actual /velpari-approve-discuss handler. Phase B stops here.
		ctx.ui.notify("Discussion notes drafted. Run /velpari-approve-discuss to publish.", "info");
	}

	void loadStageSkill; // keep import live for Phase C wiring
}

function renderDiscussionNotes(
	mission: string,
	answers: string[],
	extractorOut: { proposals: Array<{ payload: ExtractorProposal }> },
	prdCheckerOut: { proposals: Array<{ payload: PrdCheckerProposal }> },
	rtmCheckerOut: { proposals: Array<{ payload: RtmCheckerProposal }> },
	webSearchOut: { proposals: Array<{ payload: WebSearchProposal }> },
	decision: { newFr: string[]; updateFr: string[]; helperUpdate: string[]; newHelper: string[] },
): string {
	const lines: string[] = [
		`# Discussion Notes — ${mission}`,
		``,
		`## Mission`,
		mission,
		``,
		`## Interview Answers`,
		...answers.map((a, i) => `${i + 1}. ${a}`),
		``,
		`## Scout Proposals`,
		``,
		`### NEW EXTRACTOR`,
		...extractorOut.proposals.map((p) => `- (${p.payload.classification}) ${p.payload.rawText}`),
		``,
		`### PRD CHECKER`,
		...prdCheckerOut.proposals.map((p) => `- (${p.payload.frId}) ${p.payload.delta}`),
		``,
		`### RTM CHECKER`,
		...rtmCheckerOut.proposals.map((p) => `- (${p.payload.frId}) ${p.payload.testCase}`),
		``,
		`### WEB SEARCH AGENT`,
		...webSearchOut.proposals.flatMap((p) => [
			`- community: ${p.payload.community.join(", ") || "(none)"}`,
			`- official: ${p.payload.official.join(", ") || "(none)"}`,
			`- similar: ${p.payload.similar.join(", ") || "(none)"}`,
		]),
		``,
		`## Decision Summary`,
		`- new-fr: ${decision.newFr.join(", ") || "(none)"}`,
		`- update-fr: ${decision.updateFr.join(", ") || "(none)"}`,
		`- helper-update: ${decision.helperUpdate.join(", ") || "(none)"}`,
		`- new-helper: ${decision.newHelper.join(", ") || "(none)"}`,
		``,
	];
	return lines.join("\n");
}

interface DecisionResult {
	newFr: string[];
	updateFr: string[];
	helperUpdate: string[];
	newHelper: string[];
}

/**
 * DECISION agent logic — moved from a separate scout to the main handler
 * per v1.5. Classifies each candidate as one of 4 categories.
 */
function mergeProposals(
	extractorOut: { proposals: Array<{ payload: ExtractorProposal }> },
	prdCheckerOut: { proposals: Array<{ payload: PrdCheckerProposal }> },
	rtmCheckerOut: { proposals: Array<{ payload: RtmCheckerProposal }> },
): DecisionResult {
	const result: DecisionResult = {
		newFr: [],
		updateFr: [],
		helperUpdate: [],
		newHelper: [],
	};
	for (const p of extractorOut.proposals) {
		if (p.payload.classification === "new-requirement") {
			result.newFr.push(p.payload.rawText);
		} else if (p.payload.classification === "refinement") {
			result.updateFr.push(p.payload.rawText);
		} else if (p.payload.classification === "helper-function") {
			result.newHelper.push(p.payload.rawText);
		}
	}
	for (const p of prdCheckerOut.proposals) {
		// Phase B: simple merge — assume PRD CHECKER deltas map to update-fr
		result.updateFr.push(`${p.payload.frId}: ${p.payload.delta}`);
	}
	for (const p of rtmCheckerOut.proposals) {
		void p;
		// RTM CHECKER proposals do not change the classification; they add test cases.
	}
	return result;
}

void saveState; // keep import live for Phase C
