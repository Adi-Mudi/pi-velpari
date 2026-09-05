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
 * Split into two pure helpers:
 *   - checkScoutAgentFiles(cwd, lines)  → also exposes .lastSummary
 *   - checkStageSkillMarkdowns(cwd, lines) → returns issue count
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
// Scout-agent file check
// ---------------------------------------------------------------------------

/** Most-recent summary, exposed so the orchestrator can print a single line. */
export const scoutAgentCheck = { missing: 0, badFrontmatter: 0 };

/**
 * Walk every stage in ALL_STAGE_SCOUTS, check each agent file's
 * presence + frontmatter. Records counts in `scoutAgentCheck` for the
 * orchestrator's summary line.
 */
export function checkScoutAgentFiles(cwd: string, lines: string[]): void {
	const agentsDir = join(cwd, ".pi", "agents");
	let totalMissing = 0;
	let totalBadFrontmatter = 0;
	for (const stage of Object.keys(ALL_STAGE_SCOUTS)) {
		const scouts = ALL_STAGE_SCOUTS[stage]!;
		lines.push(`### /velpari-${stage} (${scouts.length} scouts)`);
		for (const id of scouts) {
			const target = join(agentsDir, `${id}.md`);
			if (!existsSync(target)) {
				lines.push(`  ✗ ${id}.md MISSING (will auto-bootstrap on first /velpari-${stage})`);
				totalMissing++;
				continue;
			}
			const content = readFileSync(target, "utf8");
			const fm = parseFrontmatter(content);
			const missing = REQUIRED_AGENT_FIELDS.filter((f) => !fm[f]);
			if (missing.length > 0) {
				lines.push(`  ✗ ${id}.md frontmatter missing: ${missing.join(", ")}`);
				totalBadFrontmatter++;
			} else {
				lines.push(`  ✓ ${id}.md (frontmatter OK)`);
			}
		}
	}
	scoutAgentCheck.missing = totalMissing;
	scoutAgentCheck.badFrontmatter = totalBadFrontmatter;
}

// ---------------------------------------------------------------------------
// Stage skill markdown integrity check
// ---------------------------------------------------------------------------

/**
 * Walk every stage in STAGES_WITH_SKILL_MARKDOWN, check that the skill
 * file exists, mentions every scout, and references the v2.0 machinery.
 * Returns the issue count (the orchestrator prints a summary line).
 */
export function checkStageSkillMarkdowns(cwd: string, lines: string[]): number {
	let totalSkillIssues = 0;
	for (const stage of STAGES_WITH_SKILL_MARKDOWN) {
		const skillPath = join(cwd, "skills", `velpari-${stage}.md`);
		if (!existsSync(skillPath)) {
			lines.push(`✗ skills/velpari-${stage}.md MISSING`);
			totalSkillIssues++;
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
			lines.push(`✓ skills/velpari-${stage}.md: OK`);
		} else {
			lines.push(`✗ skills/velpari-${stage}.md: ${issues.length} issue(s)`);
			for (const issue of issues) {
				lines.push(`  - ${issue}`);
			}
			totalSkillIssues += issues.length;
		}
	}
	return totalSkillIssues;
}
