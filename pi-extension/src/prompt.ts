/**
 * Stage prompt loading (v2.0).
 *
 * Mirrors the pattern in pi-seani/src/prompt.ts: actually reads
 * `skills/velpari-<skill>.md` from disk and assembles the full prompt that
 * `pi.sendUserMessage()` sends to the parent LLM. The parent LLM then
 * follows the skill instructions (interview questions, subagent spawns,
 * artifact writes, preview gate).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Stage } from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Map each Stage value to the skill-file basename (without `velpari-` prefix
 * or `.md` suffix). Both the in-progress and completed states for a stage
 * point at the same skill file.
 */
const STAGE_SKILL: Record<Stage, string | undefined> = {
	none: undefined,
	discussing: "discuss",
	discussed: "discuss",
	"drafting-prd": "prd",
	"drafted-prd": "prd",
	"building-rtm": "rtm",
	"built-rtm": "rtm",
	"analyzing-feasibility": "feasibility",
	"analyzed-feasibility": "feasibility",
	designing: "design",
	designed: "design",
	"writing-pseudocode": "pseudocode",
	"wrote-pseudocode": "pseudocode",
	"planning-tests": "testplan",
	"planned-tests": "testplan",
	"analyzing-atomic-functions": "atomic-function",
	"analyzed-atomic-functions": "atomic-function",
	"ordering-development": "development-order",
	"ordered-development": "development-order",
	"handoff-ready": "handoff",
};

/**
 * Resolve the path to a skill markdown file. Tries the dist layout first
 * (dist/pi-extension/src → repo root, 3 levels up) and falls back to the
 * source layout (pi-extension/src → repo root, 2 levels up).
 */
export function resolveSkillPath(skillName: string): string {
	const candidates = [
		resolve(__dirname, "../../..", "skills", `velpari-${skillName}.md`),
		resolve(__dirname, "../..", "skills", `velpari-${skillName}.md`),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return candidates[0]!;
}

/**
 * Load a stage skill markdown. Strips YAML frontmatter. Returns content.
 * On ENOENT, throws so the caller can decide whether to surface or swallow.
 */
export function loadStageSkill(stage: Stage): string {
	const skill = STAGE_SKILL[stage];
	if (!skill) {
		throw new Error(`No skill mapped for stage "${stage}".`);
	}
	const skillPath = resolveSkillPath(skill);
	if (!existsSync(skillPath)) {
		throw new Error(`Stage skill not found at ${skillPath} for stage "${stage}".`);
	}
	let content = readFileSync(skillPath, "utf8");
	content = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
	return content.trim();
}

/**
 * A scout subagent that the parent LLM should spawn.
 */
export interface ScoutSlot {
	/** Display name passed to the subagent() tool (e.g. "extractor", "fr-extractor"). */
	name: string;
	/** Absolute or relative path where the scout writes its JSON report. */
	reportPath: string;
}

/**
 * Inputs for assembling a stage prompt.
 *
 * - stage: current Stage value (for the metadata block + skill selection)
 * - mission: the run's mission string
 * - framework: optional framework line (per FR-49) — from `.pi/velpari/files.json`
 * - runId: optional run id (used in metadata block)
 * - answers: interview answers collected by the handler (Q1-Q6)
 * - webSearchAllowed: whether the user consented to web search (FR-52, discuss stage only)
 * - paths: artifact paths the parent LLM needs (scout reports, working copy, etc.)
 * - paths.scouts: NEW (Phase 1): ordered list of scout agents to render in the prompt.
 *   If provided, this takes precedence over the discuss-stage-specific hardcoded
 *   fields below (which are kept for backward compatibility).
 * - paths.inputArtifact: NEW (Phase 1): path to the input artifact (e.g. discussion
 *   notes for prd, PRD for rtm, etc.). Rendered in the metadata block.
 */
export interface BuildStagePromptInput {
	stage: Stage;
	mission: string;
	framework: string | undefined;
	runId: string | undefined;
	answers: readonly string[];
	webSearchAllowed: boolean;
	paths: {
		/** Ordered list of scout agents (preferred over the legacy hardcoded fields). */
		scouts?: ScoutSlot[];
		/** Path to the input artifact (e.g. discussion-{slug}.md, PRD_<project>.md). */
		inputArtifact?: string;
		/** Path where the LLM should write the working-copy artifact. */
		workingCopy?: string;
		/** Directory under run/ where the scouts write their reports. */
		scoutsDir?: string;
		/** Legacy: hardcoded discuss-stage paths. Kept for backward compat with discuss.ts. */
		extractorReport?: string;
		prdCheckerReport?: string;
		rtmCheckerReport?: string;
		webSearchReport?: string;
		discussionNotes?: string;
	};
}

/**
 * Build the full stage prompt that gets sent to the parent LLM via
 * `pi.sendUserMessage()`. Mirrors the structure used in pi-seani:
 *
 *   <pi-velpari stage="...">
 *     metadata block (mission, framework, run id, paths)
 *   </pi-velpari>
 *
 *   <interview answers section>
 *
 *   <web search flag section>
 *
 *   <stage skill content (from skills/velpari-*.md)>
 */
export function buildStagePrompt(input: BuildStagePromptInput): string {
	const skill = loadStageSkill(input.stage);
	const fwLine = input.framework ? `Framework: ${input.framework}\n` : "";
	const answersBlock = input.answers.length === 0
		? "(no answers collected)"
		: input.answers
				.map((a, i) => `${i + 1}. ${a}`)
				.join("\n");

	const webSearchLine = input.webSearchAllowed
		? `Web search: ALLOWED (spawn web-search-agent subagent).\n`
		: `Web search: NOT ALLOWED (skip web-search-agent subagent).\n`;

	// Render scout report paths: prefer the new `scouts` array; fall back to the
	// legacy hardcoded discuss-stage fields if `scouts` is not provided.
	const scoutLines: string[] = [];
	if (input.paths.scouts && input.paths.scouts.length > 0) {
		for (const s of input.paths.scouts) {
			scoutLines.push(`    ${s.name}-report.json: ${s.reportPath}`);
		}
	} else {
		if (input.paths.extractorReport) {
			scoutLines.push(`    extractor-report.json: ${input.paths.extractorReport}`);
		}
		if (input.paths.prdCheckerReport) {
			scoutLines.push(`    prd-checker-report.json: ${input.paths.prdCheckerReport}`);
		}
		if (input.paths.rtmCheckerReport) {
			scoutLines.push(`    rtm-checker-report.json: ${input.paths.rtmCheckerReport}`);
		}
		if (input.paths.webSearchReport) {
			scoutLines.push(`    web-search-report.json: ${input.paths.webSearchReport}`);
		}
	}

	const artifactLines: string[] = [];
	if (input.paths.scoutsDir) {
		artifactLines.push(`  Scouts directory: ${input.paths.scoutsDir}`);
	}
	if (scoutLines.length > 0) {
		artifactLines.push(...scoutLines);
	}
	if (input.paths.inputArtifact) {
		artifactLines.push(`  Input artifact: ${input.paths.inputArtifact}`);
	}
	if (input.paths.workingCopy) {
		artifactLines.push(`  Working copy (LLM writes here): ${input.paths.workingCopy}`);
	}
	if (input.paths.discussionNotes) {
		artifactLines.push(`  Discussion notes (working copy): ${input.paths.discussionNotes}`);
	}

	const metadata = [
		`<pi-velpari stage="${input.stage}">`,
		`Mission: ${input.mission}`,
		fwLine.trimEnd(),
		`Run ID: ${input.runId ?? "(none — pre-run)"}`,
		``,
		`Artifact paths for this run:`,
		...artifactLines,
		`</pi-velpari>`,
		``,
	].join("\n");

	const answersSection = [
		`## Interview Answers (collected by handler)`,
		``,
		answersBlock,
		``,
	].join("\n");

	const flagsSection = [
		`## Flags`,
		``,
		webSearchLine.trimEnd(),
		``,
	].join("\n");

	return [metadata, answersSection, flagsSection, skill].join("\n");
}