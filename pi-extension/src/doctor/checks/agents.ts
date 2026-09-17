/**
 * Scout agent + stage skill markdown integrity checks.
 *
 * The doctor needs to verify that:
 *   - every scout agent file is present in `.pi/agents/`
 *   - every scout agent file has the required YAML frontmatter
 *   - every stage's skill markdown exists and references its scouts
 *     plus the v2.0 machinery (pi-interactive-subagents, caller_ping,
 *     AskUserQuestion, zellij workaround).
 *
 * Phase 1: returns DiagnosticSections instead of mutating a shared
 * `lines` array. Replaces the mutable `scoutAgentCheck` summary
 * object with two `info` items in the returned section.
 *
 * Phase 7: ALL_STAGE_SCOUTS is derived from BRAINSTORM_ROLES +
 * STAGE_REGISTRY (no hard-coded list); the presence check resolves
 * effective agent names through agents.json; checkAgentMappingSection
 * validates the mapping file itself.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";
import { STAGE_REGISTRY } from "../../stages/registry.js";
import {
	BRAINSTORM_ROLES,
	DEFAULT_AGENTS,
	loadAgentConfig,
	LOGGING_SCOUT_ROLES,
	resolveAgentName,
	validateMappedAgents,
	type AgentConfig,
	type VelpariRole,
} from "../../core/agents-config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REQUIRED_AGENT_FIELDS = ["name", "description", "tools", "thinking", "session-mode", "auto-exit", "spawning"];

/**
 * Known pi tool names. Mirrors Senai's `_types.ts`. Anything outside
 * this set in an agent's `tools:` is a typo that blocks scout startup.
 */
export const KNOWN_TOOL_NAMES: Set<string> = new Set([
	"read", "write", "edit", "bash", "grep", "find", "ls",
	"askuserquestion", "intercom", "subagent",
	"taskcreate", "taskexecute", "taskget", "tasklist", "taskoutput", "taskstop", "taskupdate",
	"websearch", "fetchurl",
]);

/** Valid pi thinking levels. */
export const VALID_THINKING_LEVELS: Set<string> = new Set([
	"off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

/** Valid `session-mode:` values per pi's agent frontmatter spec. */
export const VALID_SESSION_MODES: Set<string> = new Set(["standalone", "lineage-only"]);

/** Valid `auto-exit:` values. */
export const VALID_AUTO_EXIT: Set<string> = new Set(["true", "false"]);

/** Valid `spawning:` values. */
export const VALID_SPAWNING: Set<string> = new Set(["true", "false"]);

/**
 * Per-stage scout ROLE ids (all 9 stages use 4 visible subagents each).
 * Derived from the single sources of truth: BRAINSTORM_ROLES
 * (core/agents-config) for brainstorm and STAGE_REGISTRY.scouts
 * (stages/registry) for the 8 registry stages. Values are role ids —
 * the effective agent name is resolved through agents.json at check time.
 */
export const ALL_STAGE_SCOUTS: Record<string, string[]> = {
	brainstorm: [...BRAINSTORM_ROLES],
	...Object.fromEntries(
		Object.values(STAGE_REGISTRY).map((spec) => [spec.key, [...spec.scouts]]),
	),
	// v1.4.0 — cross-cutting discipline command. The 3 logging scouts
	// live in LOGGING_SCOUT_ROLES (agents-config.ts) and are bundled
	// under skills/agents/. Listed here so the stage-skills doctor check
	// verifies the skill markdown mentions each one.
	"design-logging": [...LOGGING_SCOUT_ROLES],
};

export const STAGES_WITH_SKILL_MARKDOWN = [
	"brainstorm",
	"prd",
	"rtm",
	"feasibility",
	"architecture-generator",
	"design",
	"pseudocode",
	"testplan",
	"atomic-function",
	"development-order",
	"configure-requirements",
	// v1.4.0 — cross-cutting discipline command /velpari-design-logging.
	// Not a stage (no STAGE_TRANSITIONS entry) but its skill markdown
	// is checked alongside the stage skills.
	"design-logging",
];

// ---------------------------------------------------------------------------
// Lightweight YAML frontmatter parser (scalar values only).
// ---------------------------------------------------------------------------

export function parseFrontmatter(markdown: string): Record<string, string> {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) return {};
	const block = match[1]!;
	const result: Record<string, string> = {};
	let lastKey: string | null = null;
	for (const line of block.split("\n")) {
		const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
		if (kv) {
			const key = kv[1]!;
			const value = kv[2]!.trim();
			result[key] = value;
			lastKey = value === "" ? key : null;
			continue;
		}
		// Indented list item under the last key (YAML list style).
		const li = line.match(/^\s+-\s+(.*)$/);
		if (li && lastKey) {
			result[lastKey] = `${result[lastKey] ?? ""},${li[1]!.trim()}`.replace(/^,/, "");
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Scout-agent section
// ---------------------------------------------------------------------------

/**
 * Walk every stage in ALL_STAGE_SCOUTS, resolve each role's effective
 * agent name through `.pi/velpari/agents.json` (identity when absent),
 * and check the resolved file's presence + frontmatter. A custom-mapped
 * agent that is missing is an error (auto-bootstrap only installs the
 * bundled defaults); a missing default stays a warning. A corrupt
 * agents.json is NOT reported here — checkAgentMappingSection owns it;
 * this check falls back to default names in that case.
 */
export function checkScoutAgentsSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const agentsDir = join(cwd, ".pi", "agents");
	let totalMissing = 0;
	let totalBadFrontmatter = 0;

	let agentConfig: AgentConfig | null = null;
	try {
		agentConfig = loadAgentConfig(cwd);
	} catch {
		agentConfig = null;
	}

	for (const stage of Object.keys(ALL_STAGE_SCOUTS)) {
		const roles = ALL_STAGE_SCOUTS[stage]!;
		for (const role of roles) {
			const agentName = resolveAgentName(agentConfig, role as VelpariRole);
			const isCustom = agentName !== DEFAULT_AGENTS[role as VelpariRole];
			const customNote = isCustom ? " custom mapping in effect (agents.json)." : "";
			const target = join(agentsDir, `${agentName}.md`);
			if (!existsSync(target)) {
				totalMissing++;
				items.push({
					status: isCustom ? "error" : "warning",
					message: isCustom
						? `${agentName}.md (${stage}, role ${role}) MISSING —${customNote} Auto-bootstrap only installs bundled defaults.`
						: `${agentName}.md (${stage}) MISSING — will auto-bootstrap on first /velpari-${stage}.`,
					suggestion: suggestionFor(isCustom ? "agent-mapping-missing" : "scout-agent-missing"),
				});
				continue;
			}
			const content = readFileSync(target, "utf8");
			const fm = parseFrontmatter(content);
			const missing = REQUIRED_AGENT_FIELDS.filter((f) => !fm[f]);
			if (missing.length > 0) {
				totalBadFrontmatter++;
				items.push({
					status: "error",
					message: `${agentName}.md (${stage}) frontmatter missing fields: ${missing.join(", ")}.${customNote}`,
					suggestion: suggestionFor("scout-agent-bad-frontmatter"),
				});
			} else {
				items.push({
					status: "ok",
					message: `${agentName}.md (${stage}) frontmatter OK${customNote}`,
				});
			}
		}
	}

	const totalScouts = Object.values(ALL_STAGE_SCOUTS).flat().length;
	const totalStages = Object.keys(ALL_STAGE_SCOUTS).length;
	const stageList = Object.keys(ALL_STAGE_SCOUTS).join(", ");
	items.push({
		status: totalMissing === 0 && totalBadFrontmatter === 0 ? "ok" : "info",
		message: `Scout agents summary: ${totalScouts} scouts across ${totalStages} stages (${stageList}) — ${totalMissing} missing, ${totalBadFrontmatter} with bad frontmatter.`,
	});

	return { title: "Scout agents (.pi/agents/)", items };
}

// ---------------------------------------------------------------------------
// Agent mapping section (agents.json)
// ---------------------------------------------------------------------------

/**
 * Validate `.pi/velpari/agents.json`: present? valid? do all custom-mapped
 * agents exist on disk? Missing file = info ("all defaults"); a corrupt
 * file or a mapping to a nonexistent agent = error items pointing at
 * /velpari-configure-agents.
 */
export function checkAgentMappingSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	let config: AgentConfig | null;
	try {
		config = loadAgentConfig(cwd);
	} catch (err) {
		items.push({
			status: "error",
			message: (err as Error).message,
			suggestion: suggestionFor("agent-config-invalid"),
		});
		return { title: "Agent mapping (agents.json)", items };
	}

	if (!config) {
		items.push({
			status: "info",
			message: "No agents.json — all 42 roles use bundled defaults.",
		});
		return { title: "Agent mapping (agents.json)", items };
	}

	const customRoles = Object.entries(config.agents).filter(([, name]) => Boolean(name));
	const errors = validateMappedAgents(cwd, config);
	for (const error of errors) {
		items.push({
			status: "error",
			message: error,
			suggestion: suggestionFor("agent-mapping-missing"),
		});
	}
	if (errors.length === 0) {
		items.push({
			status: "ok",
			message: `Agent mapping valid: ${customRoles.length} custom mapping(s), all mapped agents available.`,
		});
	}
	if (customRoles.length > 0) {
		items.push({
			status: "info",
			message:
				"Skill markdown references the bundled default agent names; custom mappings are resolved at spawn time via agents.json.",
		});
	}

	return { title: "Agent mapping (agents.json)", items };
}

// ---------------------------------------------------------------------------
// Stage skill markdown integrity section
// ---------------------------------------------------------------------------

/**
 * Walk every stage in STAGES_WITH_SKILL_MARKDOWN, check that the skill
 * file exists, mentions every scout, and references the v2.0 machinery.
 * Returns a DiagnosticSection.
 */
export function checkStageSkillsSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	let totalIssues = 0;

	for (const stage of STAGES_WITH_SKILL_MARKDOWN) {
		const skillPath = join(cwd, "skills", `velpari-${stage}.md`);
		if (!existsSync(skillPath)) {
			totalIssues++;
			items.push({
				status: "error",
				message: `skills/velpari-${stage}.md MISSING`,
				suggestion: suggestionFor("skill-missing"),
			});
			continue;
		}
		const content = readFileSync(skillPath, "utf8");
		const issues: string[] = [];
		const scoutsForStage = ALL_STAGE_SCOUTS[stage];
		if (scoutsForStage) {
			for (const agentName of scoutsForStage) {
				if (!content.includes(agentName)) {
					issues.push(`missing mention of agent '${agentName}'`);
				}
			}
		}
		if (content.includes("max_turns")) {
			issues.push("contains removed v2.0 hallucination 'max_turns'");
		}
		if (stage !== "configure-requirements") {
			if (!content.includes("pi-interactive-subagents")) {
				issues.push("missing reference to pi-interactive-subagents");
			}
			if (!content.includes("caller_ping")) {
				issues.push("missing reference to caller_ping");
			}
			if (!content.includes("AskUserQuestion")) {
				issues.push("missing reference to AskUserQuestion");
			}
			if (!/Issue #19|zellij.*close-pane/i.test(content)) {
				issues.push("missing reference to zellij close-pane workaround (Issue #19)");
			}
		}

		if (issues.length === 0) {
			items.push({
				status: "ok",
				message: `skills/velpari-${stage}.md: OK`,
			});
		} else {
			totalIssues += issues.length;
			items.push({
				status: "error",
				message: `skills/velpari-${stage}.md: ${issues.length} issue(s)`,
				details: issues,
				suggestion: suggestionFor("skill-bad-contract"),
			});
		}
	}

	items.push({
		status: totalIssues === 0 ? "ok" : "info",
		message: `Stage skills summary: ${STAGES_WITH_SKILL_MARKDOWN.length} checked (${STAGES_WITH_SKILL_MARKDOWN.join(", ")}), ${totalIssues} contract issue(s).`,
	});

	return { title: "Stage skills", items };
}

// ---------------------------------------------------------------------------
// Agent file integrity (Phase 4d)
// ---------------------------------------------------------------------------

import { readdirSync } from "node:fs";

/**
 * Per-file integrity audit of `.pi/agents/*.md`. Catches typos and
 * invalid frontmatter values that block scout startup but slip past
 * the "required fields present" check.
 */
export function checkAgentFileIntegrity(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const agentsDir = join(cwd, ".pi", "agents");

	if (!existsSync(agentsDir)) {
		items.push({
			status: "ok",
			message: "No .pi/agents/ directory — nothing to audit.",
		});
		return { title: "Agent file integrity", items };
	}

	const files = readdirSync(agentsDir, { encoding: "utf8" }).filter(
		(name) => typeof name === "string" && name.endsWith(".md"),
	);
	let errors = 0;
	let warnings = 0;

	for (const filename of files) {
		const target = join(agentsDir, filename);
		const content = readFileSync(target, "utf8");
		const fm = parseFrontmatter(content);
		const stem = filename.replace(/\.md$/, "");

		// 1. Filename vs name: frontmatter match.
		if (fm.name && fm.name !== stem) {
			errors++;
			items.push({
				status: "error",
				message: `${filename}: \`name:\` ("${fm.name}") does not match filename ("${stem}").`,
				suggestion: `Rename the file or update \`name:\` to "${stem}".`,
			});
		}

		// 2. tools: values are in KNOWN_TOOL_NAMES.
		if (fm.tools) {
			const tools = fm.tools
				.split(/[\s,[\]]+/)
				.map((t) => t.trim())
				.filter(Boolean);
			const unknown = tools.filter((t) => !KNOWN_TOOL_NAMES.has(t));
			if (unknown.length > 0) {
				errors++;
				items.push({
					status: "error",
					message: `${filename}: unknown tool(s) in \`tools:\`: ${unknown.join(", ")}`,
					details: [
						`Known tools: ${Array.from(KNOWN_TOOL_NAMES).sort().join(", ")}`,
					],
					suggestion: "Fix the typo or remove the unknown tool.",
				});
			}
		}

		// 3. thinking: is in VALID_THINKING_LEVELS.
		if (fm.thinking && !VALID_THINKING_LEVELS.has(fm.thinking)) {
			errors++;
			items.push({
				status: "error",
				message: `${filename}: invalid \`thinking:\` value "${fm.thinking}".`,
				details: [`Valid levels: ${Array.from(VALID_THINKING_LEVELS).join(", ")}`],
				suggestion: `Set \`thinking:\` to one of: ${Array.from(VALID_THINKING_LEVELS).join(", ")}.`,
			});
		}

		// 4. session-mode: is in VALID_SESSION_MODES.
		if (fm["session-mode"] && !VALID_SESSION_MODES.has(fm["session-mode"])) {
			errors++;
			items.push({
				status: "error",
				message: `${filename}: invalid \`session-mode:\` value "${fm["session-mode"]}".`,
				details: [`Valid values: ${Array.from(VALID_SESSION_MODES).join(", ")}`],
				suggestion: `Set \`session-mode:\` to "${Array.from(VALID_SESSION_MODES).join("\" or \"")}".`,
			});
		}

		// 5. auto-exit: is a known boolean string.
		if (fm["auto-exit"] && !VALID_AUTO_EXIT.has(fm["auto-exit"])) {
			warnings++;
			items.push({
				status: "warning",
				message: `${filename}: \`auto-exit:\` value "${fm["auto-exit"]}" is not a boolean.`,
				suggestion: 'Set `auto-exit: true` or `auto-exit: false`.',
			});
		}

		// 6. spawning: is a known boolean string.
		if (fm.spawning && !VALID_SPAWNING.has(fm.spawning)) {
			warnings++;
			items.push({
				status: "warning",
				message: `${filename}: \`spawning:\` value "${fm.spawning}" is not a boolean.`,
				suggestion: 'Set `spawning: true` or `spawning: false`.',
			});
		}

		// 7. Body is non-empty (anything after the frontmatter closer).
		const body = content.replace(/^---[\s\S]*?---\n?/, "").trim();
		if (body.length === 0) {
			warnings++;
			items.push({
				status: "warning",
				message: `${filename}: body is empty after frontmatter.`,
				suggestion: "Add at least one paragraph describing the agent's mandate.",
			});
		}
	}

	if (files.length === 0) {
		items.push({
			status: "ok",
			message: "No agent files present — nothing to audit.",
		});
	} else if (errors === 0 && warnings === 0) {
		items.push({
			status: "ok",
			message: `Agent file integrity OK: ${files.length} file(s) checked, 0 issues.`,
		});
	} else {
		items.push({
			status: errors > 0 ? "error" : "warning",
			message: `Agent file integrity: ${errors} error(s), ${warnings} warning(s) across ${files.length} file(s).`,
		});
	}

	return { title: "Agent file integrity", items };
}
