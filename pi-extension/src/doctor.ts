/**
 * /velpari-doctor handler (FR-12).
 *
 * Audits the Velpari setup:
 *  - .pi/velpari/files.json validity (NFR-04)
 *  - Doc/ artifacts present for completed stages (FR-22 traceability)
 *  - Secret scan over all artifacts (NFR-04)
 *  - Multiplexer detection (v2.0 — required for /velpari-discuss subagents)
 *  - Scout agent file presence + frontmatter (v2.0)
 *  - Stage skill markdown integrity (v2.0)
 *  - Best-effort peer dep check (v2.0)
 *  - Writes report to .IDE_Plans/velpari/doctor-report.md (NFR-05)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadState } from "./state.js";
import { PATHS } from "./constants.js";
import { loadFilesConfig, validateFilesConfig } from "./config.js";
import { SCOUT_AGENT_IDS } from "./agents-install.js";

const MAX_NOTIFY_LENGTH = 8000;

const SECRET_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
	{ name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
	{ name: "GitHub PAT", regex: /ghp_[A-Za-z0-9]{36}/g },
	{ name: "OpenAI API Key", regex: /sk-[A-Za-z0-9]{48}/g },
	{ name: "Generic Bearer Token", regex: /Bearer\s+[A-Za-z0-9_\-.]{20,}/g },
];

/**
 * Scan text for accidental secrets (NFR-04).
 * Returns array of `{ pattern, line }` for each match.
 */
export function scanForSecrets(text: string): Array<{ pattern: string; line: number; match: string }> {
	const hits: Array<{ pattern: string; line: number; match: string }> = [];
	const lines = text.split("\n");
	for (const { name, regex } of SECRET_PATTERNS) {
		for (const [i, line] of lines.entries()) {
			const matches = line.match(regex);
			if (matches) {
				for (const m of matches) {
					hits.push({ pattern: name, line: i + 1, match: m });
				}
			}
		}
	}
	return hits;
}

export type MultiplexerKind = "cmux" | "tmux" | "zellij" | "wezterm" | "unknown";

export interface MultiplexerInfo {
	mux: MultiplexerKind;
	source: string;
}

/**
 * Detect the active multiplexer by sniffing env vars.
 *
 * Order:
 *  1. `PI_SUBAGENT_MUX` (user-overridden, valid: cmux|tmux|zellij|wezterm)
 *  2. `TMUX` → tmux
 *  3. `ZELLIJ_PANE_ID` or `ZELLIJ_SESSION_NAME` → zellij
 *  4. `WEZTERM_PANE` (and `WEZTERM_EXECUTABLE`) → wezTerm
 *  5. `CMUX_PANE_ID` → cmux
 *  6. else unknown
 *
 * See https://github.com/HazAT/pi-interactive-subagents#install for the
 * supported multiplexer list.
 */
export function detectMultiplexer(env: NodeJS.ProcessEnv = process.env): MultiplexerInfo {
	const override = env.PI_SUBAGENT_MUX;
	if (override === "cmux" || override === "tmux" || override === "zellij" || override === "wezterm") {
		return { mux: override, source: "PI_SUBAGENT_MUX" };
	}
	if (env.TMUX) return { mux: "tmux", source: "TMUX" };
	if (env.ZELLIJ_PANE_ID || env.ZELLIJ_SESSION_NAME) {
		return { mux: "zellij", source: env.ZELLIJ_PANE_ID ? "ZELLIJ_PANE_ID" : "ZELLIJ_SESSION_NAME" };
	}
	if (env.WEZTERM_PANE || env.WEZTERM_EXECUTABLE) {
		return { mux: "wezterm", source: env.WEZTERM_PANE ? "WEZTERM_PANE" : "WEZTERM_EXECUTABLE" };
	}
	if (env.CMUX_PANE_ID || env.CMUX_SESSION_NAME) {
		return { mux: "cmux", source: env.CMUX_PANE_ID ? "CMUX_PANE_ID" : "CMUX_SESSION_NAME" };
	}
	return { mux: "unknown", source: "(none — no multiplexer env vars detected)" };
}

/**
 * Best-effort lookup for pi-interactive-subagents package.
 * Tries several common locations; returns version if found.
 */
export function detectInteractiveSubagentsVersion(cwd: string = process.cwd()): string | undefined {
	const candidates = [
		join(cwd, "node_modules", "@earendil-works", "pi-interactive-subagents", "package.json"),
		join(cwd, "..", "node_modules", "@earendil-works", "pi-interactive-subagents", "package.json"),
		join(cwd, "..", "..", "node_modules", "@earendil-works", "pi-interactive-subagents", "package.json"),
		// Pi user-level extension location.
		join(homedir(), ".pi", "agent", "extensions", "pi-interactive-subagents", "package.json"),
	];
	for (const candidate of candidates) {
		try {
			if (existsSync(candidate)) {
				const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
				if (pkg.version) return pkg.version;
			}
		} catch {
			// ignore parse errors
		}
	}
	return undefined;
}

/**
 * Lightweight YAML frontmatter parser (scalar values only).
 * Returns empty object if no frontmatter block.
 */
function parseFrontmatter(markdown: string): Record<string, string> {
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

const REQUIRED_AGENT_FIELDS = ["name", "description", "tools", "thinking", "session-mode", "auto-exit", "spawning"];

/**
 * Per-stage scout agent ids (v2.0 — all 8 stages use 4 visible subagents each).
 * 9 stages total: discuss, prd, rtm, feasibility, design, pseudocode, testplan,
 * atomic-function (post-pipeline, optional), development-order (post-pipeline, optional).
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

/**
 * Stages that produce a stage skill markdown under skills/velpari-<stage>.md.
 * The 6 core stages (prd..testplan) plus discuss have skill markdowns; atomic-function
 * and development-order also have skill markdowns (added in Phase 5).
 */
const STAGES_WITH_SKILL_MARKDOWN = [
	"discuss",
	"prd",
	"rtm",
	"feasibility",
	"design",
	"pseudocode",
	"testplan",
	"atomic-function",
	"development-order",
];

/**
 * Run the full audit. Returns the report markdown and writes it to disk.
 */
export function runDoctor(cwd: string = process.cwd()): string {
	const lines: string[] = ["# Velpari Doctor Report", ""];

	const statePath = join(cwd, PATHS.STATE_FILE);
	const configPath = join(cwd, PATHS.CONFIG_DIR, "files.json");

	// 1. State file
	if (existsSync(statePath)) {
		const state = loadState(cwd);
		lines.push(`Run: ${state.runId}`);
		lines.push(`Mission: ${state.mission || "(none)"}`);
		lines.push(`Current stage: ${state.currentStage}`);
		lines.push(`History entries: ${state.history.length}`);
	} else {
		lines.push("No active run. State: empty.");
	}
	lines.push("");

	// 2. Config validity
	if (existsSync(configPath)) {
		const config = loadFilesConfig(cwd);
		const valid = validateFilesConfig(config);
		lines.push(`Config: ${valid ? "VALID" : "INVALID"} (projectName="${config.projectName}")`);
	} else {
		lines.push("Config: MISSING (run /velpari-configure-inputs)");
	}
	lines.push("");

	// 3. Doc/ artifact presence + secret scan
	const docDir = join(cwd, "Doc");
	lines.push("## Doc/ artifacts");
	if (!existsSync(docDir)) {
		lines.push("- Doc/ directory missing");
	} else {
		const files = readdirSync(docDir).filter((f) => f.endsWith(".md"));
		if (files.length === 0) {
			lines.push("- (no artifacts)");
		}
		const secrets: string[] = [];
		for (const f of files) {
			const filePath = join(docDir, f);
			const content = readFileSync(filePath, "utf8");
			lines.push(`- ${f}`);
			const hits = scanForSecrets(content);
			for (const h of hits) {
				secrets.push(`  - ${h.pattern} at line ${h.line} in ${f}`);
			}
		}
		if (secrets.length > 0) {
			lines.push("");
			lines.push("## Secret scan (NFR-04)");
			lines.push(...secrets);
		} else {
			lines.push("");
			lines.push("## Secret scan");
			lines.push("No secrets detected.");
		}
	}
	lines.push("");

	// 4. Multiplexer (v2.0 — required for /velpari-discuss subagents)
	lines.push("## Multiplexer (required for /velpari-discuss v2.0)");
	const mux = detectMultiplexer();
	lines.push(`Detected: ${mux.mux} (env: ${mux.source})`);
	const subagentsVersion = detectInteractiveSubagentsVersion(cwd);
	if (subagentsVersion) {
		lines.push(`pi-interactive-subagents: ${subagentsVersion}`);
	} else {
		lines.push("pi-interactive-subagents: NOT FOUND (peer dep required for visible subagents)");
		lines.push("  Install: pi install npm:@earendil-works/pi-interactive-subagents");
	}
	if (mux.mux === "unknown") {
		lines.push("");
		lines.push("⚠ WARNING: /velpari-discuss requires a supported multiplexer.");
		lines.push("  Supported: cmux, tmux, zellij, wezTerm (see pi-interactive-subagents docs).");
		lines.push("  Start pi inside one of them, e.g.: `tmux new -A -s pi 'pi'`");
	}
	if (mux.mux === "zellij") {
		lines.push("");
		lines.push("⚠ WARNING (zellij): known bug [pi-interactive-subagents Issue #19].");
		lines.push("  zellij action close-pane closes the FOCUSED pane, not the target.");
		lines.push("  During the discussion stage, do NOT manually focus a subagent pane.");
		lines.push("  cmux/tmux/wezterm are not affected.");
	}
	lines.push("");

	// 5. Scout agent files (v2.0 — covers all 9 stages)
	lines.push("## Scout agents (.pi/agents/)");
	const agentsDir = join(cwd, ".pi", "agents");
	let totalMissing = 0;
	let totalBadFrontmatter = 0;
	for (const stage of Object.keys(ALL_STAGE_SCOUTS)) {
		const scouts = ALL_STAGE_SCOUTS[stage]!;
		lines.push(`### /velpari-${stage} (${scouts.length} scouts)`);
		for (const id of scouts) {
			const target = join(agentsDir, `${id}.md`);
			if (!existsSync(target)) {
				lines.push(`  ✗ ${id}.md MISSING (will auto-bootstrap on first /velpari-${stage === "discuss" ? "discuss" : stage})`);
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
	lines.push("");
	lines.push(
		`Summary: ${Object.values(ALL_STAGE_SCOUTS).flat().length} scouts expected across ${Object.keys(ALL_STAGE_SCOUTS).length} stages. ` +
			`Missing: ${totalMissing}, bad frontmatter: ${totalBadFrontmatter}.`,
	);
	lines.push("");

	// 6. Stage skill markdown integrity (v2.0 — covers all 9 stages)
	lines.push("## Stage skills");
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
		// Every stage skill should mention all of its scouts.
		for (const agentName of ALL_STAGE_SCOUTS[stage] ?? []) {
			if (!content.includes(agentName)) {
				issues.push(`missing mention of agent '${agentName}'`);
			}
		}
		if (content.includes("max_turns")) {
			issues.push("contains removed v2.0 hallucination 'max_turns'");
		}
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
		if (issues.length === 0) {
			lines.push(`✓ skills/velpari-${stage}.md: OK (mentions all ${ALL_STAGE_SCOUTS[stage]?.length ?? 0} agents, no max_turns, references pi-interactive-subagents + caller_ping + AskUserQuestion + zellij workaround)`);
		} else {
			lines.push(`✗ skills/velpari-${stage}.md: ${issues.length} issue(s)`);
			for (const issue of issues) {
				lines.push(`  - ${issue}`);
			}
			totalSkillIssues += issues.length;
		}
	}
	lines.push("");
	lines.push(`Summary: ${STAGES_WITH_SKILL_MARKDOWN.length} stage skills checked, ${totalSkillIssues} issues.`);
	lines.push("");

	return lines.join("\n");
}

/**
 * Write the doctor report to disk.
 */
export function writeDoctorReport(report: string, cwd: string = process.cwd()): void {
	const reportPath = join(cwd, PATHS.DOCTOR_REPORT);
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, report, "utf8");
}

/**
 * /velpari-doctor handler. Runs the audit and emits summary.
 */
export async function handleDoctor(
	ctx: ExtensionCommandContext,
	cwd: string = process.cwd(),
): Promise<void> {
	const report = runDoctor(cwd);
	writeDoctorReport(report, cwd);
	const reportPath = join(cwd, PATHS.DOCTOR_REPORT);
	if (report.length <= MAX_NOTIFY_LENGTH) {
		ctx.ui.notify(report, "info");
	} else {
		ctx.ui.notify(report.slice(0, MAX_NOTIFY_LENGTH) + "\n... [truncated]", "info");
	}
	ctx.ui.notify(`Full report written to ${reportPath}.`, "info");
}