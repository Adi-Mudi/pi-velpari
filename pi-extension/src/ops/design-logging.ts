/**
 * /velpari-design-logging handler (v1.4.0).
 *
 * Cross-cutting discipline command — NOT a stage. Runs after Design is
 * approved (`designed` or later) and before the next stage. Produces
 * `Doc/observability/logging-plan_<projectName>.md` with the 17-section
 * template from `core/logging-plan.ts`.
 *
 * Flow:
 *   1. Validate state + config + multiplexer.
 *   2. Bootstrap 3 logging scouts (logging-standards-researcher,
 *      logging-architecture-designer, logging-compliance-mapper).
 *   3. Build the run-context prompt + embed the skill markdown.
 *   4. Hand off to the parent LLM via `pi.sendUserMessage`.
 *   5. Parent LLM spawns 3 scouts in parallel, writes BOTH the working
 *      copy AND the published Doc/observability/... copy, updates
 *      state.json:loggingPlanPublishedPath.
 *   6. User runs /velpari-doctor to verify.
 *
 * Why no separate /velpari-prd-approve step: logging is cross-cutting
 * and small enough that the publish-on-write pattern (parent LLM
 * writes both copies + state.json in one pass) is faster than
 * the 2-step approve-then-publish pattern used by Stages 2–10.
 * Doctor's `checkLoggingPlanSection` is the safety net.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadState } from "../core/state.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { loadRequirementsProfile, compactProfileMetadata } from "../core/profile.js";
import { loadAgentConfig, LOGGING_SCOUT_ROLES, resolveAgentName, type VelpariRole } from "../core/agents-config.js";
import { buildRunDir, buildWorkingGroupedPath, resolveDocArtifact } from "../core/paths.js";
import { detectMultiplexer } from "../core/multiplexer.js";
import { resolveSkillPath } from "../core/prompt.js";
import { ensureStageAgents } from "../io/agents-install.js";
import { loadPublishedLoggingPlanMarkdown } from "../core/logging-plan.js";

/**
 * Stages at which /velpari-design-logging may be invoked. The command
 * is cross-cutting — it requires Design (Stage 5) to be approved, but
 * can be re-invoked at any later stage in update mode (PRD revision,
 * RTM update, etc.). Stages that are still in flight (e.g. `drafting-prd`)
 * are NOT allowed; the user must finish the in-flight stage first.
 */
const ALLOWED_STAGES = new Set([
	"designed",
	"analyzed-atomic-functions",
	"wrote-pseudocode",
	"planned-tests",
	"ordered-development",
	"finalized-design",
	"handoff-ready",
]);

export async function handleDesignLogging(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	// 1. State + config.
	const state = loadState(cwd);
	if (!state.runId || state.currentStage === "none") {
		ctx.ui.notify("No active run. Run /velpari-brainstorm first.", "error");
		return;
	}

	const config = loadFilesConfig(cwd);
	if (!validateFilesConfig(config)) {
		ctx.ui.notify("Project name not set. Run /velpari-configure-inputs first.", "error");
		return;
	}
	const projectName = config.projectName;

	// 2. Stage gate (cross-cutting: runs after Design approved).
	if (!ALLOWED_STAGES.has(state.currentStage)) {
		ctx.ui.notify(
			`Cannot run /velpari-design-logging at stage "${state.currentStage}". ` +
				`Design must be approved first — run /velpari-architecture-generator + /velpari-rtm-approve.`,
			"error",
		);
		return;
	}

	// 3. Multiplexer hard gate (matches brainstorm v2.1 pattern).
	const mux = detectMultiplexer();
	if (mux.mux === "unknown" && !process.env.PI_SUBAGENT_MUX) {
		ctx.ui.notify(
			"Logging design requires a multiplexer (zellij/tmux/wezterm/cmux) for visible subagents. " +
				"Override with PI_SUBAGENT_MUX=1 for wrappers and tests.",
			"error",
		);
		return;
	}

	// 4. Inputs.
	const prdResolved = resolveDocArtifact("PRD", projectName, cwd);
	const designResolved = resolveDocArtifact("design", projectName, cwd);
	if (!prdResolved) {
		ctx.ui.notify(
			`PRD not found for ${projectName}. Run /velpari-prd and /velpari-feasibility-approve first.`,
			"error",
		);
		return;
	}
	if (!designResolved) {
		ctx.ui.notify(
			`Design not found for ${projectName}. Run /velpari-architecture-generator and /velpari-architecture-generator-approve first.`,
			"error",
		);
		return;
	}

	// 5. Path setup.
	const runDir = buildRunDir(state.runId, cwd);
	const workingCopyDir = join(runDir, "observability");
	const scoutsDir = join(workingCopyDir, "scouts");
	const workingCopyPath = buildWorkingGroupedPath(cwd, state.runId, "logging-plan", projectName);
	const publishedPath = join(cwd, "Doc", "observability", `logging-plan_${projectName}.md`);
	mkdirSync(workingCopyDir, { recursive: true });
	mkdirSync(scoutsDir, { recursive: true });

	// 6. Scout bootstrap.
	const agentConfig = loadAgentConfig(cwd);
	const scoutIds = [...LOGGING_SCOUT_ROLES];
	const bootstrap = ensureStageAgents(scoutIds, cwd, agentConfig);
	const bootstrapLines: string[] = [];
	if (bootstrap.installed.length > 0) {
		bootstrapLines.push(`Installed ${bootstrap.installed.length} logging scout(s): ${bootstrap.installed.join(", ")}.`);
	}
	if (bootstrap.missing.length > 0) {
		bootstrapLines.push(
			`⚠ Bundled agent file(s) missing for: ${bootstrap.missing.join(", ")}. ` +
				`/velpari-design-logging will fail until you add them.`,
		);
	}

	// 7. Scout slots (role-keyed report paths).
	const scoutSlots = scoutIds.map((role) => ({
		name: role,
		reportPath: join(scoutsDir, `${role}-report.json`),
		agentName: resolveAgentName(agentConfig, role as VelpariRole),
	}));

	// 8. Update-mode detection (living documents).
	let updateModeBlock = "";
	const baseline = loadPublishedLoggingPlanMarkdown(cwd, projectName);
	if (baseline) {
		updateModeBlock = [
			"",
			"## Update Mode",
			"",
			`A published logging plan exists at \`${baseline.path}\`. This run REVISES it in place — never rewrite from scratch.`,
			"Apply the 4 revision rules from the skill:",
			"1. Keep section ids; append new sections in canonical order.",
			"2. Deprecate-don't-delete (mark with `[DEPRECATED <date>]` prefix).",
			"3. Version bump: minor for additions, major for deprecations.",
			"4. Add a Change Log entry under §16.",
			"",
			`Baseline content is at \`<${baseline.path}>\`. Read it before writing.`,
			"",
		].join("\n");
	}

	// 9. Profile metadata block.
	const profile = loadRequirementsProfile(cwd);
	const profileMetadata = compactProfileMetadata(profile);
	const profileBlock = profileMetadata
		? [
				"## Profile (compact)",
				"",
				`- ID: \`${profileMetadata.profileId}\``,
				`- Version: \`${profileMetadata.profileVersion}\``,
				`- Application type: ${profileMetadata.applicationType}`,
				`- Domain: ${profileMetadata.domain}`,
				`- Development method: ${profileMetadata.developmentMethod}`,
				`- Regulated: ${profileMetadata.regulated ? "yes" : "no"}`,
				`- Output variant: ${profileMetadata.outputVariant}`,
				"",
			].join("\n")
		: "";

	// 10. Standards overlay block.
	const standardsBlock = state.standardsProfile
		? [
				"## Active standards overlay",
				"",
				`- ID: \`${state.standardsProfile.id}\``,
				`- Version: \`${state.standardsProfile.version}\``,
				`- Selected at: ${state.standardsProfile.selectedAt}`,
				state.standardsProfile.researchConsent ? "- Research consent: granted" : "- Research consent: not granted",
				state.standardsProfile.researchSources && state.standardsProfile.researchSources.length > 0
					? `- Research sources: ${state.standardsProfile.researchSources.join(", ")}`
					: "",
				"",
				"If the overlay id is one of `medical-device-b`, `industrial-ot`, `financial-payments`, or `cloud-saas`, read its `loggingRequirements` block from `skills/standards/overlays/<id>/profile.json` and bake the requirements into §3 (event catalog), §7 (storage), §8 (protection), and §11 (review cadence).",
				"",
			].join("\n")
		: "";

	// 11. Load the skill markdown.
	const skillPath = resolveSkillPath("design-logging");
	let skillContent: string;
	try {
		skillContent = readFileSync(skillPath, "utf8");
	} catch {
		ctx.ui.notify(`Skill markdown not found at ${skillPath}. Did the package build correctly?`, "error");
		return;
	}
	// Strip YAML frontmatter.
	skillContent = skillContent.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();

	// 12. Build the prompt.
	const scoutList = scoutSlots
		.map((s) => `- \`${s.name}\` → \`${s.reportPath}\` (spawn agent: \`${s.agentName}\`)`)
		.join("\n");

	const prompt = [
		skillContent,
		"",
		"---",
		"",
		"# Run context (injected by the handler)",
		"",
		`- Mission: ${state.mission}`,
		`- Run id: \`${state.runId}\``,
		`- Project: \`${projectName}\``,
		`- Current stage: \`${state.currentStage}\``,
		`- Framework: ${config.framework?.language ?? "(none configured)"}`,
		"",
		"## Inputs",
		"",
		`- PRD: \`${prdResolved.path}\``,
		`- Design: \`${designResolved.path}\``,
		`- Standards profile: ${
			state.standardsProfile
				? `\`${".pi/velpari/standards-profile.json"}\` (overlay=\`${state.standardsProfile.id}@${state.standardsProfile.version}\`)`
				: "(none; implicit 'none' overlay)"
		}`,
		"",
		profileBlock,
		standardsBlock,
		"## Working copy + Published paths",
		"",
		`- Working copy (write here first): \`${workingCopyPath}\``,
		`- Published copy (copy after validation): \`${publishedPath}\``,
		"- Scout reports:",
		scoutList,
		"",
		"After writing the working copy, run `validateLoggingPlan` (via `node -e` against `dist/pi-extension/src/core/logging-plan.js`, OR by reading the file back and checking every section heading against `LOGGING_PLAN_REQUIRED_SECTIONS`).",
		"",
		"If validation passes, copy the working copy to the published path with `mkdir -p Doc/observability && cp <workingCopy> <publishedPath>`. Then update `.pi/velpari/state.json` by setting `loggingPlanPublishedPath` to the published path. Use `jq` for the JSON patch or rewrite via Python.",
		"",
		"If validation fails, leave the working copy in place and tell the user which section(s) need fixing.",
		updateModeBlock,
	].join("\n");

	// 13. Hand off to parent LLM.
	pi.sendUserMessage(prompt);

	// 14. Notify.
	const notifyLines: string[] = [
		`Logging design started for: ${state.mission}`,
		`Project: ${projectName}`,
		`Current stage: ${state.currentStage}`,
		`Working copy target: ${workingCopyPath}`,
		`Published target: ${publishedPath}`,
		`Scouts: ${scoutIds.join(", ")}`,
		`Scout reports: ${scoutsDir}`,
	];
	if (baseline) {
		notifyLines.push(`Update mode: revising ${baseline.path}`);
	}
	notifyLines.push(
		"The parent LLM is now orchestrating the 3 subagents (visible panes). When the plan is ready, run /velpari-doctor to verify.",
	);
	if (bootstrapLines.length > 0) {
		notifyLines.push("");
		notifyLines.push(...bootstrapLines);
	}
	ctx.ui.notify(notifyLines.join("\n"), "info");
}
