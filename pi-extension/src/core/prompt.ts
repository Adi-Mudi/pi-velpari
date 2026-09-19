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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "./paths.js";
import type { Stage } from "./constants.js";
import type { CompactProfileMetadata } from "./profile.js";
import type { ScanType } from "./state.js";
import type { AtomicProfile } from "./atomic-tier.js";
import { tierLabel } from "./atomic-tier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Map each Stage value to the skill-file basename (without `velpari-` prefix
 * or `.md` suffix). Both the in-progress and completed states for a stage
 * point at the same skill file.
 */
const STAGE_SKILL: Record<Stage, string | undefined> = {
	none: undefined,
	brainstorming: "brainstorm",
	brainstormed: "brainstorm",
	"drafting-prd": "prd",
	"drafted-prd": "prd",
	"building-rtm": "rtm",
	"built-rtm": "rtm",
	"analyzing-feasibility": "feasibility",
	"analyzed-feasibility": "feasibility",
	designing: "architecture-generator",
	designed: "architecture-generator",
	"writing-pseudocode": "pseudocode",
	"wrote-pseudocode": "pseudocode",
	"planning-tests": "testplan",
	"planned-tests": "testplan",
	"analyzing-atomic-functions": "atomic-function",
	"analyzed-atomic-functions": "atomic-function",
	"ordering-development": "development-order",
	"ordered-development": "development-order",
	"finalizing-design": "design",
	"finalized-design": "design",
	"handoff-ready": "handoff",
};

/**
 * Resolve the path to a skill markdown file. Layout-independent: walks
 * up from `__dirname` to the nearest package.json (via findPackageRoot)
 * and joins `skills/velpari-<skillName>.md`. Works for:
 *  - dist layout:  dist/pi-extension/src/core/prompt.js
 *  - src layout:   pi-extension/src/core/prompt.ts (npm install)
 *  - symlinked:    ~/.pi/agent/extensions/pi-velpari (dev hot-reload)
 *
 * Phase v1.0.1: replaced the Phase F 4-level-up probe, which silently
 * resolved one level too high when Pi loaded the source tree directly
 * (the `main: ./pi-extension/src/index.ts` layout).
 */
export function resolveSkillPath(skillName: string): string {
	const pkgRoot = findPackageRoot(__dirname);
	return join(pkgRoot, "skills", `velpari-${skillName}.md`);
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
	/** Scout ROLE id (e.g. "extractor", "fr-extractor"). Report paths stay
	 *  role-keyed — custom agent names never change report file names. */
	name: string;
	/** Absolute or relative path where the scout writes its JSON report. */
	reportPath: string;
	/** Resolved agent name to spawn (from `.pi/velpari/agents.json`).
	 *  Optional — absent means "spawn the role id" (the bundled default). */
	agentName?: string;
}

/**
 * Existing project context for the brainstorm stage (change-aware
 * brainstorm). Built by the brainstorm handler from pure existence probes;
 * paths only — content is read on demand by the parent LLM. When every
 * field is empty the block is omitted (truly fresh project).
 */
export interface BrainstormExistingContext {
	/** Published artifact paths present under Doc/ (absolute). */
	publishedArtifacts: readonly string[];
	/** Configured project name from .pi/velpari/files.json. */
	projectName?: string;
	/** Framework line from .pi/velpari/files.json. */
	framework?: string;
	/** Selected requirements profile id, if any. */
	profileId?: string;
	/** Previous run ids (runs/ folders other than the current run). */
	previousRunIds: readonly string[];
	/** Current run's stage history lines ("<stage> via <command>"). */
	history: readonly string[];
}

/**
 * Inputs for assembling a stage prompt.
 *
 * - stage: current Stage value (for the metadata block + skill selection)
 * - mission: the run's mission string
 * - framework: optional framework line (per FR-49) — from `.pi/velpari/files.json`
 * - runId: optional run id (used in metadata block)
 * - answers: interview answers collected by the handler (Q1-Q6)
 * - webSearchAllowed: whether the user consented to web search (FR-52, brainstorm stage only)
 * - paths: artifact paths the parent LLM needs (scout reports, working copy, etc.)
 * - paths.scouts: NEW (Phase 1): ordered list of scout agents to render in the prompt.
 *   If provided, this takes precedence over the brainstorm-stage-specific hardcoded
 *   fields below (which are kept for backward compatibility).
 * - paths.inputArtifact: NEW (Phase 1): path to the input artifact (e.g. brainstorm
 *   notes for prd, PRD for rtm, etc.). Rendered in the metadata block.
 */
export interface BuildStagePromptInput {
	stage: Stage;
	mission: string;
	framework: string | undefined;
	runId: string | undefined;
	answers: readonly string[];
	webSearchAllowed: boolean;
	/**
	 * Optional: resolved agent name for the community (web-search) role,
	 * from `.pi/velpari/agents.json`. Rendered into the `## Flags`
	 * web-search line. When absent, the literal "web-search-agent" is used
	 * (the default mapping is the identity).
	 */
	communityAgentName?: string;
	/**
	 * Optional (Phase 7): compact profile metadata. Rendered into a
	 * dedicated profile block. When null/undefined the block is omitted.
	 */
	profileMetadata?: CompactProfileMetadata | null;
	/**
	 * Optional (lifecycle v2, brainstorm stage only): scan kinds the user
	 * approved at the scan-plan gate. When present (not undefined), the
	 * prompt renders a `## Scan Plan` block INSTEAD of the legacy
	 * `## Flags` web-search line. When undefined, the legacy `## Flags`
	 * section renders unchanged (in-flight runs must not break).
	 */
	scansSelected?: readonly ScanType[];
	/** Optional (lifecycle v2): hard-lock status line for the Scan Plan block. */
	understandingConfirmed?: boolean;
	/**
	 * Optional (lifecycle v2): pre-rendered per-scan lines for the
	 * `## Scan Plan` block (scout roles + timeouts). Built by the caller in
	 * stages/ via `formatScanPlanLines` from stages/brainstorm/dispatcher.ts —
	 * prompt.ts (L0) must not import the dispatcher (L1), so the scan
	 * details arrive pre-rendered. Falls back to plain scan names.
	 */
	scanPlanLines?: readonly string[];
	/**
	 * Optional (change-aware brainstorm, brainstorm stage only): existing
	 * project context. When present and non-empty, renders an
	 * `## Existing Project Context` block (paths only, read-on-demand).
	 */
	existingContext?: BrainstormExistingContext | null;
	/**
	 * Optional (living documents): update mode. When the stage's published
	 * artifact already exists, the handler passes its path + full content
	 * here and the prompt renders an `## Update Mode` block with the 5
	 * revision rules and the fenced baseline as read-only reference.
	 */
	updateMode?: { baselinePath: string; baselineContent: string } | null;
	/**
	 * Optional (feasibility v2): conditional agents available for this
	 * stage — bootstrapped by the handler, spawned by the parent LLM only
	 * when the skill's conditions are met. Rendered as a
	 * `## Conditional Agents` block with the resolved spawn names.
	 */
	conditionalAgents?: readonly { role: string; agentName: string }[] | null;
	/**
	 * Optional (atomic-function stage only): tier profile loaded from
	 * `.pi/velpari/files.json:atomic`. Rendered as a `## Atomic Profile`
	 * block so the parent LLM knows which fields are required at the
	 * selected tier (ISO/IEC 29110 entry/basic/intermediate/advanced).
	 */
	atomicProfile?: AtomicProfile | null;
	/**
	 * Optional (v3 brainstorm): active persistent sub-agent session
	 * handles. When present, renders an `## Active sub-agents` block
	 * listing the session handle + agent name for each pane. The parent
	 * LLM uses this block to route messages during the DISCUSS loop:
	 *
	 *   subagent({ session: "<handle>", prompt: <user message> })
	 *
	 * When absent (legacy one-shot path), the block is omitted.
	 */
	activeSubagents?: {
		web?: string;
		docCode?: string;
		spawnedAt?: string;
	} | null;
	paths: {
		/** Ordered list of scout agents (preferred over the legacy hardcoded fields). */
		scouts?: ScoutSlot[];
		/** Path to the input artifact (e.g. brainstorm-{slug}.md, PRD_<project>.md). */
		inputArtifact?: string;
		/**
		 * NEW (Phase 5): full text of the input artifact(s) to embed in the prompt.
		 * Used by stages that read multiple published docs (atomic-function,
		 * development-order) and concatenate them into a single content blob.
		 * When provided, this is rendered as a fenced markdown section in the prompt.
		 */
		inputArtifactContent?: string;
		/** Path where the LLM should write the working-copy artifact. */
		workingCopy?: string;
		/** Directory under run/ where the scouts write their reports. */
		scoutsDir?: string;
		/** Legacy: hardcoded brainstorm-stage paths. Kept for backward compat with brainstorm.ts. */
		extractorReport?: string;
		prdCheckerReport?: string;
		rtmCheckerReport?: string;
		webSearchReport?: string;
		brainstormNotes?: string;
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

	const communityAgent = input.communityAgentName ?? "web-search-agent";
	const webSearchLine = input.webSearchAllowed
		? `Web search: ALLOWED (spawn ${communityAgent} subagent).\n`
		: `Web search: NOT ALLOWED (skip ${communityAgent} subagent).\n`;

	// Phase 7: render compact profile metadata (only the compact projection).
	let profileSection = "";
	if (input.profileMetadata) {
		const p = input.profileMetadata;
		profileSection = [
			`## Profile (compact)`,
			``,
			`Profile id: ${p.profileId}`,
			`Profile version: ${p.profileVersion}`,
			`Application type: ${p.applicationType}`,
			`Domain: ${p.domain}`,
			`Development method: ${p.developmentMethod}`,
			`Regulated: ${p.regulated ? "yes" : "no"}`,
			`Output variant: ${p.outputVariant}`,
			``,
		].join("\n");
	}

	// Render scout report paths: prefer the new `scouts` array; fall back to the
	// legacy hardcoded brainstorm-stage fields if `scouts` is not provided.
	const scoutLines: string[] = [];
	if (input.paths.scouts && input.paths.scouts.length > 0) {
		for (const s of input.paths.scouts) {
			// Report paths stay role-keyed; the spawn note names the resolved
			// agent only when agents.json remaps the role to a custom name.
			const spawnNote =
				s.agentName && s.agentName !== s.name ? ` (spawn agent: ${s.agentName})` : "";
			scoutLines.push(`    ${s.name}-report.json: ${s.reportPath}${spawnNote}`);
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
	if (input.paths.brainstormNotes) {
		artifactLines.push(`  Brainstorm notes (working copy): ${input.paths.brainstormNotes}`);
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

	// Lifecycle v2 (Phase 3): when the scan gate ran (scansSelected present,
	// possibly empty), the `## Scan Plan` block carries the user's gate
	// decision and REPLACES the fixed `## Flags` web-search line. Legacy
	// callers (scansSelected undefined) get the unchanged `## Flags` section.
	const scanPlanSection =
		input.scansSelected !== undefined
			? [
					`## Scan Plan`,
					``,
					`Understanding confirmed: ${input.understandingConfirmed === true ? "yes" : "no"}`,
					`Approved scans:`,
					...(input.scanPlanLines ??
						input.scansSelected.map((s) => `- ${s}`)),
					``,
				].join("\n")
			: "";

	// Optional: pre-provided input artifact content (concatenated published docs).
	// Rendered as a fenced markdown block in its own section so the LLM can read it.
	const inputContentSection = input.paths.inputArtifactContent
		? [
				`## Input Artifact Content (pre-loaded by handler)`,
				``,
				"```",
				input.paths.inputArtifactContent,
				"```",
				``,
			].join("\n")
		: "";

	// Change-aware brainstorm: render the existing-context block when the
	// handler found published artifacts / config / history. Paths only —
	// the parent LLM reads the content on demand.
	const existingContextSection = renderExistingContext(input.existingContext ?? null);

	// Living documents: render the update-mode block (after flags, before
	// the skill) when a published baseline exists for this stage.
	const updateModeSection = renderUpdateMode(input.updateMode ?? null);

	// Feasibility v2: conditional agents block (reuse scout, spike agent).
	const conditionalSection =
		input.conditionalAgents && input.conditionalAgents.length > 0
			? [
					`## Conditional Agents (spawn ONLY when the skill's conditions are met)`,
					``,
					...input.conditionalAgents.map((a) =>
						a.agentName !== a.role
							? `- role ${a.role} (spawn agent: ${a.agentName})`
							: `- role ${a.role}`,
					),
					``,
				].join("\n")
			: "";

	// Atomic profile block (atomic-function stage only — ISO/IEC 29110 + IEC 61508/IEC 62304).
	const atomicProfileSection = renderAtomicProfile(input.atomicProfile ?? null);

	// v3 — Active sub-agents block (brainstorm stage only). Renders when
	// state.activeSubagents is set so the parent LLM knows the 2 session
	// handles for routing during the DISCUSS loop.
	const activeSubagentsSection = renderActiveSubagents(input.activeSubagents ?? null);

	return [metadata, profileSection, atomicProfileSection, existingContextSection, answersSection, scanPlanSection || flagsSection, activeSubagentsSection, updateModeSection, conditionalSection, inputContentSection, skill]
		.filter((s) => s.length > 0)
		.join("\n");
}

/**
 * Render the `## Atomic Profile` block. Lists the tier, safetyClass, SIL,
 * overlay id, and the field set required at the selected tier (so the
 * parent LLM populates the right columns). Returns "" when the profile
 * is null (other stages).
 */
function renderAtomicProfile(profile: AtomicProfile | null): string {
	if (!profile) return "";
	const fieldsByTier: Record<AtomicProfile["tier"], string> = {
		entry: "Base-core only (8 fields): afId, name, purpose, signature, source, cohesion, verification, testable.",
		basic: "Base-core + basic-tier refs: calledByFrIds, designRef, extractedFrom, satisfactionFrId, feasibilityRef.",
		intermediate: "Base-core + basic + EARS pattern, inputs, outputs, errors, dependencies, dbOrIo, complexity, coupling, argCount, oneLevelAbstr, nameIntent.",
		advanced: "Base-core + basic + intermediate + owner, priority, securityClass, risk, reusability, modifiabilityNote, storyPoints, acceptanceRef, testRef, rationale, changeLog.",
	};
	return [
		`## Atomic Profile (ISO/IEC 29110 + IEC 61508/IEC 62304)`,
		``,
		`Tier: ${tierLabel(profile.tier)}`,
		`Safety class (IEC 62304): ${profile.safetyClass}`,
		`SIL (IEC 61508): ${profile.sil}`,
		`Standards overlay: ${profile.overlayId ?? "(none)"}`,
		``,
		`Required field set:`,
		fieldsByTier[profile.tier],
		``,
		`Every AF row in the working copy must populate every required field.`,
		`The doctor gate (publish-time) reports missing fields as errors.`,
		``,
	].join("\n");
}

/**
 * Render the `## Update Mode` block: baseline path, the 5 revision rules,
 * and the full published baseline fenced as a read-only reference.
 * Returns "" when no baseline exists (fresh draft — unchanged behavior).
 */
function renderUpdateMode(
	updateMode: { baselinePath: string; baselineContent: string } | null,
): string {
	if (!updateMode) return "";
	return [
		`## Update Mode`,
		``,
		`A published version of this artifact already exists. REVISE it — never`,
		`regenerate from scratch.`,
		``,
		`Baseline (published, read-only reference): ${updateMode.baselinePath}`,
		``,
		`Revision rules:`,
		`1. Append-only IDs: never renumber or reuse existing IDs (FR/NFR/US/SM/HF/ERR/DATA/Q).`,
		`2. Deprecate, don't delete: removals stay in the document with status`,
		`   \`deprecated\` plus a reason.`,
		`3. Version bump: minor (x.Y.0) for additions only; major (X.0.0) when any`,
		`   requirement is deprecated or an acceptance criterion changes.`,
		`4. Change Log: add a new entry describing this revision.`,
		`5. New rows start with status \`proposed\`.`,
		``,
		`Baseline content (read-only):`,
		``,
		"```markdown",
		updateMode.baselineContent,
		"```",
		``,
	].join("\n");
}

/**
 * Render the `## Existing Project Context` block. Returns "" when the
 * context is null or carries no signals (truly fresh project).
 */
function renderExistingContext(context: BrainstormExistingContext | null): string {
	if (!context) return "";
	const hasSignals =
		context.publishedArtifacts.length > 0 ||
		Boolean(context.projectName) ||
		Boolean(context.profileId) ||
		context.previousRunIds.length > 0;
	if (!hasSignals) return "";

	const lines: string[] = [
		`## Existing Project Context`,
		``,
		`This is NOT a fresh project — treat this brainstorm as a CHANGE brainstorm.`,
		`Read the artifacts below on demand (paths only) before framing questions.`,
		``,
	];
	if (context.publishedArtifacts.length > 0) {
		lines.push(`Published artifacts (read on demand):`);
		for (const p of context.publishedArtifacts) lines.push(`- ${p}`);
		lines.push(``);
	}
	const configParts: string[] = [];
	if (context.projectName) configParts.push(`projectName=${context.projectName}`);
	if (context.framework) configParts.push(`framework=${context.framework}`);
	if (configParts.length > 0) {
		lines.push(`Config: ${configParts.join(", ")}`, ``);
	}
	if (context.profileId) {
		lines.push(`Requirements profile: ${context.profileId}`, ``);
	}
	if (context.previousRunIds.length > 0) {
		lines.push(`Previous runs: ${context.previousRunIds.join(", ")}`, ``);
	}
	if (context.history.length > 0) {
		lines.push(`Run history (this run): ${context.history.join(" → ")}`, ``);
	}
	return lines.join("\n");
}

/**
 * v3 — Render the `## Active sub-agents` block. When the brainstorm
 * handler has spawned the 2 persistent sessions, the parent LLM needs
 * to know the session handles to route messages during the DISCUSS
 * loop. The block renders when at least one handle is set; absent
 * handles render as `- (not yet spawned)`.
 *
 * Returns "" when the input is null AND the legacy one-shot scan path
 * is being used (legacy callers pass undefined). Callers who want the
 * block always rendered (e.g. fresh rehydrate) pass an empty object.
 */
function renderActiveSubagents(
	handles: { web?: string; docCode?: string; spawnedAt?: string } | null,
): string {
	if (handles === null) return "";
	const lines: string[] = [
		`## Active sub-agents (persistent sessions)`,
		``,
		`Two persistent sub-agent sessions were opened at brainstorm step 2`,
		`(AUTOMATIC SPAWN). They stay alive across the whole brainstorm and`,
		`the parent LLM routes messages to them by session handle:`,
		``,
		`- row 1 right column: web-research      — session: ${handles.web ?? "(not yet spawned)"}`,
		`- row 2 right column: doc-code-analyst  — session: ${handles.docCode ?? "(not yet spawned)"}`,
		``,
		`Routing rules (apply on every user message during DISCUSS):`,
		`- Web/community/docs topic present     → subagent({ session: "${handles.web ?? "web"}", prompt: <user message> })`,
		`- PRD/RTM/source-code topic present    → subagent({ session: "${handles.docCode ?? "doc-code"}", prompt: <user message> })`,
		`- Both topics present                   → 2 parallel subagent() calls (different sessions, allowed)`,
		`- General/meta question                 → answer directly (no sub-agent call)`,
		``,
		`Sub-agent replies are folded back into your context as normal assistant`,
		`turns. Use them to enrich the brainstorm notes during the DISCUSS loop.`,
		``,
	];
	if (handles.spawnedAt) {
		lines.push(`Spawned at: ${handles.spawnedAt}`, ``);
	}
	return lines.join("\n");
}