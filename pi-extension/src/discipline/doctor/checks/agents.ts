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
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REQUIRED_AGENT_FIELDS = ["name", "description", "tools", "thinking", "session-mode", "auto-exit", "spawning"];

/**
 * Per-stage scout agent ids (all 9 stages use 4 visible subagents each).
 */
export const ALL_STAGE_SCOUTS: Record<string, string[]> = {
	discuss: ["extractor", "prd-checker", "rtm-checker", "web-search-agent"],
	prd: ["fr-extractor", "nfr-checker", "helper-detector", "consolidator"],
	rtm: ["rtm-requirement-tracer", "rtm-test-case-linker", "rtm-coverage-analyzer", "rtm-consolidator"],
	feasibility: ["feasibility-tech", "feasibility-schedule", "feasibility-cost", "feasibility-risk"],
	design: ["design-module-decomposer", "design-contract-definer", "design-data-flow-mapper", "design-error-definer"],
	pseudocode: [
		"pseudo-algorithm-extractor",
		"pseudo-edge-case-handler",
		"pseudo-complexity-analyzer",
		"pseudo-consolidator",
	],
	testplan: [
		"testplan-strategy-designer",
		"testplan-unit-test-generator",
		"testplan-integration-test-generator",
		"testplan-coverage-tracer",
	],
	"atomic-function": ["af-source-rtm", "af-source-pseudocode", "af-source-prd", "af-source-testcases"],
	"development-order": ["do-topology", "do-risk", "do-test", "do-value"],
};

export const STAGES_WITH_SKILL_MARKDOWN = [
	"discuss",
	"prd",
	"rtm",
	"feasibility",
	"design",
	"pseudocode",
	"testplan",
	"atomic-function",
	"development-order",
	"configure-requirements",
];

// ---------------------------------------------------------------------------
// Lightweight YAML frontmatter parser (scalar values only).
// ---------------------------------------------------------------------------

export function parseFrontmatter(markdown: string): Record<string, string> {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) return {};
	const block = match[1]!;
	const result: Record<string, string> = {};
	for (const line of block.split("\n")) {
		const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
		if (m) {
			result[m[1]!] = m[2]!.trim();
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Scout-agent section
// ---------------------------------------------------------------------------

/**
 * Walk every stage in ALL_STAGE_SCOUTS, check each agent file's
 * presence + frontmatter. Returns a DiagnosticSection whose items
 * describe each missing or malformed file; a final summary item
 * reports total counts.
 */
export function checkScoutAgentsSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const agentsDir = join(cwd, ".pi", "agents");
	let totalMissing = 0;
	let totalBadFrontmatter = 0;

	for (const stage of Object.keys(ALL_STAGE_SCOUTS)) {
		const scouts = ALL_STAGE_SCOUTS[stage]!;
		for (const id of scouts) {
			const target = join(agentsDir, `${id}.md`);
			if (!existsSync(target)) {
				totalMissing++;
				items.push({
					status: "warning",
					message: `${id}.md (${stage}) MISSING — will auto-bootstrap on first /velpari-${stage}.`,
					suggestion: `Run any /velpari-${stage} command to trigger auto-install, or place the file manually at \`.pi/agents/${id}.md\`.`,
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
					message: `${id}.md (${stage}) frontmatter missing fields: ${missing.join(", ")}`,
					suggestion: `Add the missing frontmatter fields to \`.pi/agents/${id}.md\`. Required: ${REQUIRED_AGENT_FIELDS.join(", ")}.`,
				});
			} else {
				items.push({
					status: "ok",
					message: `${id}.md (${stage}) frontmatter OK`,
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
				suggestion: "Restore the skill markdown from the bundled `skills/` directory or git history.",
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
				suggestion: `Fix the listed contract checks in skills/velpari-${stage}.md.`,
			});
		}
	}

	items.push({
		status: totalIssues === 0 ? "ok" : "info",
		message: `Stage skills summary: ${STAGES_WITH_SKILL_MARKDOWN.length} checked (${STAGES_WITH_SKILL_MARKDOWN.join(", ")}), ${totalIssues} contract issue(s).`,
	});

	return { title: "Stage skills", items };
}
