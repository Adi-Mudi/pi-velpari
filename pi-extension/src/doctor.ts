/**
 * /velpari-doctor handler (Phase 7 update; FR-12).
 *
 * Audits the Velpari setup:
 *  - .pi/velpari/files.json validity (NFR-04)
 *  - Requirements profile presence + version (Phase 7)
 *  - Doc/ artifact presence for completed stages, grouped + legacy (FR-22)
 *  - Secret scan over all artifacts (NFR-04)
 *  - Multiplexer detection (required for /velpari-discuss subagents)
 *  - Scout agent file presence + frontmatter
 *  - Stage skill markdown integrity
 *  - PSRS structural validation (Phase 7)
 *  - RTM-to-PSRS traceability (Phase 7)
 *  - Working/published separation (Phase 7)
 *  - Best-effort peer dep check
 *  - Writes report to .IDE_Plans/velpari/doctor-report.md (NFR-05)
 *
 * Doctor is a reporter. It never auto-selects, fixes, or generates a
 * profile. The configure-requirements command is the only entrypoint
 * that mutates the profile.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadState } from "./state.js";
import { PATHS } from "./constants.js";
import { loadFilesConfig, validateFilesConfig } from "./config.js";
import { SCOUT_AGENT_IDS } from "./agents-install.js";
import {
	loadRequirementsProfile,
	REQUIREMENTS_PROFILE_VERSION,
	validateRequirementsProfile,
} from "./requirements-profile.js";
import {
	buildGroupedPath,
	buildOutputPath,
	GROUPED_CATEGORIES,
	resolveDocArtifact,
} from "./paths.js";
import { renderPsrsSummary, validatePsrs } from "./psrs.js";

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
 */
export function detectInteractiveSubagentsVersion(cwd: string = process.cwd()): string | undefined {
	const candidates = [
		join(cwd, "node_modules", "@earendil-works", "pi-interactive-subagents", "package.json"),
		join(cwd, "..", "node_modules", "@earendil-works", "pi-interactive-subagents", "package.json"),
		join(cwd, "..", "..", "node_modules", "@earendil-works", "pi-interactive-subagents", "package.json"),
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
	"configure-requirements",
];

/** PSRS structural check on the new grouped document. */
function checkPsrs(cwd: string, projectName: string, lines: string[]): void {
	const grouped = join(cwd, buildGroupedPath("PRD", projectName));
	const legacy = join(cwd, buildOutputPath("PRD", projectName));
	if (existsSync(grouped)) {
		const content = readFileSync(grouped, "utf8");
		const result = validatePsrs(content);
		lines.push("### PSRS validation (grouped)");
		lines.push(renderPsrsSummary(result));
		lines.push("");
		return;
	}
	if (existsSync(legacy)) {
		lines.push("### PSRS validation (legacy)");
		lines.push(
			`- Legacy PSRS found at ${legacy}. ` +
			"PSRS validation applies to new grouped documents; rerun the PRD stage to create a validated grouped copy.",
		);
		lines.push("");
	}
}

/** RTM traceability check: every PSRS FR / NFR referenced by RTM. */
function checkRtmTraceability(cwd: string, projectName: string, lines: string[]): void {
	const psrsResolved = resolveDocArtifact("PRD", projectName, cwd);
	const rtmResolved = resolveDocArtifact("RTM", projectName, cwd);
	if (!psrsResolved) {
		lines.push("### RTM traceability");
		lines.push("- PSRS not found — skipping traceability check.");
		lines.push("");
		return;
	}
	if (!rtmResolved) {
		lines.push("### RTM traceability");
		lines.push("- RTM not found — skipping traceability check.");
		lines.push("");
		return;
	}
	const psrsContent = readFileSync(psrsResolved.path, "utf8");
	const rtmContent = readFileSync(rtmResolved.path, "utf8");
	const psrsIds = new Set<string>();
	for (const m of psrsContent.matchAll(/\b(?:FR|NFR)-\d+\b/g)) psrsIds.add(m[0]);
	for (const m of psrsContent.matchAll(/\bHF-\d+\b/g)) psrsIds.add(m[0]);

	const rtmIds = new Set<string>();
	for (const m of rtmContent.matchAll(/\b(?:FR|NFR|HF)-\d+\b/g)) rtmIds.add(m[0]);

	const missing = Array.from(rtmIds).filter((id) => !psrsIds.has(id));
	lines.push("### RTM traceability");
	lines.push(`- PSRS path: ${psrsResolved.path} (${psrsResolved.layout})`);
	lines.push(`- RTM path: ${rtmResolved.path} (${rtmResolved.layout})`);
	lines.push(`- PSRS ids: ${psrsIds.size} | RTM ids: ${rtmIds.size}`);
	if (missing.length > 0) {
		lines.push(`- ✗ RTM references ${missing.length} unknown id(s): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "..." : ""}`);
	} else {
		lines.push(`- ✓ All RTM ids resolve in the PSRS.`);
	}
	lines.push("");
}

/** Working / published separation check. */
function checkWorkingPublishedSeparation(cwd: string, projectName: string, lines: string[]): void {
	const docsDir = join(cwd, "Doc");
	const workingRoot = join(cwd, ".IDE_Plans", "velpari", "runs");
	lines.push("### Working / published separation");
	if (!existsSync(workingRoot)) {
		lines.push("- No working runs present.");
		lines.push("");
		return;
	}
	let workingCount = 0;
	let publishedCount = 0;
	for (const entry of readdirSync(workingRoot)) {
		const runDir = join(workingRoot, entry);
		for (const cat of Object.values(GROUPED_CATEGORIES)) {
			const wcDir = join(runDir, cat);
			if (existsSync(wcDir)) {
				const files = readdirSync(wcDir).filter((f) => f.endsWith(".md"));
				workingCount += files.length;
			}
		}
	}
	if (existsSync(docsDir)) {
		const recurse = (dir: string): number => {
			let n = 0;
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				if (e.isDirectory()) n += recurse(join(dir, e.name));
				else if (e.name.endsWith(".md")) n += 1;
			}
			return n;
		};
		publishedCount = recurse(docsDir);
	}
	lines.push(`- Working copies under .IDE_Plans/velpari/runs/: ${workingCount}`);
	lines.push(`- Published docs under Doc/: ${publishedCount}`);
	lines.push(`- Grouped categories: ${Object.keys(GROUPED_CATEGORIES).length} → ${Object.values(new Set(Object.values(GROUPED_CATEGORIES))).join(", ")}`);
	lines.push(`- Project under audit: ${projectName || "(none — projectName missing)"}`);
	lines.push("");
}

/** Grouped/legacy path presence check per artifact. */
function checkGroupedLegacyPaths(cwd: string, projectName: string, lines: string[]): void {
	if (!projectName) {
		lines.push("### Grouped / legacy paths");
		lines.push("- Project name missing — skipping per-artifact scan.");
		lines.push("");
		return;
	}
	lines.push("### Grouped / legacy paths");
	const artifacts = [
		"PRD",
		"RTM",
		"feasibility-study",
		"design",
		"pseudocode",
		"test-plan",
		"test-cases",
		"atomic-functions",
		"development-order",
	];
	for (const a of artifacts) {
		const grouped = join(cwd, buildGroupedPath(a, projectName));
		const legacy = join(cwd, buildOutputPath(a, projectName));
		const hasGrouped = existsSync(grouped);
		const hasLegacy = existsSync(legacy);
		const tag = hasGrouped ? "✓ grouped" : hasLegacy ? "✓ legacy" : "✗ missing";
		lines.push(`- ${a}: ${tag} | grouped=${grouped} | legacy=${legacy}`);
	}
	lines.push("");
}

/**
 * Run the full audit. Returns the report markdown and writes it to disk.
 */
export function runDoctor(cwd: string = process.cwd()): string {
	const lines: string[] = ["# Velpari Doctor Report", ""];

	const statePath = join(cwd, PATHS.STATE_FILE);
	const configPath = join(cwd, PATHS.CONFIG_DIR, "files.json");

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

	if (existsSync(configPath)) {
		const config = loadFilesConfig(cwd);
		const valid = validateFilesConfig(config);
		lines.push(`Config: ${valid ? "VALID" : "INVALID"} (projectName="${config.projectName}")`);
	} else {
		lines.push("Config: MISSING (run /velpari-configure-inputs)");
	}
	lines.push("");

	// 3. Requirements profile (Phase 7).
	lines.push("## Requirements profile");
	const profile = loadRequirementsProfile(cwd);
	if (!profile) {
		lines.push("Profile: MISSING (run /velpari-configure-requirements)");
	} else {
		const ok = validateRequirementsProfile(profile);
		lines.push(`Profile: ${ok ? "VALID" : "INVALID"} mode=${profile.profileKind} id=${profile.profileId} version=${profile.version} (expected ${REQUIREMENTS_PROFILE_VERSION})`);
		lines.push(
			`Application=${profile.applicationType} | Domain=${profile.domain} | Method=${profile.developmentMethod} | Regulated=${profile.regulated ? "yes" : "no"} | Security=${profile.securityLevel} | Variant=${profile.outputVariant}`,
		);
		lines.push(`Required sections: ${profile.requiredSections.join(", ") || "(none)"}`);
		lines.push(`Research consent: ${profile.researchConsent ? "yes" : "no"} | Research source count: ${profile.researchSources.length}`);
		lines.push(
			`Doctor is report-only: it lists the active profile and research state but never selects, fixes, or mutates a profile.`,
		);
		if (profile.profileKind === "common-core") {
			lines.push(
				`Common PSRS core selected (id=${profile.profileId}); this is a real, valid choice and not a placeholder for a missing match.`,
			);
		}
	}
	lines.push("");

	// 4. Doc/ artifact presence + secret scan + grouped/legacy paths.
	const docDir = join(cwd, "Doc");
	const projectName = (() => {
		try {
			const cfg = loadFilesConfig(cwd);
			return validateFilesConfig(cfg) ? cfg.projectName : "";
		} catch {
			return "";
		}
	})();

	lines.push("## Doc/ artifacts");
	if (!existsSync(docDir)) {
		lines.push("- Doc/ directory missing");
	} else {
		const recurse = (dir: string, prefix: string): string[] => {
			const out: string[] = [];
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const rel = `${prefix}${e.name}`;
				if (e.isDirectory()) out.push(...recurse(join(dir, e.name), `${rel}/`));
				else if (e.name.endsWith(".md")) out.push(rel);
			}
			return out;
		};
		const files = recurse(docDir, "");
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

	checkGroupedLegacyPaths(cwd, projectName, lines);
	checkWorkingPublishedSeparation(cwd, projectName, lines);
	checkPsrs(cwd, projectName, lines);
	checkRtmTraceability(cwd, projectName, lines);

	// Multiplexer
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

	// Scout agents
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
	lines.push("");
	lines.push(
		`Summary: ${Object.values(ALL_STAGE_SCOUTS).flat().length} scouts expected across ${Object.keys(ALL_STAGE_SCOUTS).length} stages. ` +
			`Missing: ${totalMissing}, bad frontmatter: ${totalBadFrontmatter}.`,
	);
	lines.push("");

	// Stage skill markdown integrity
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
	lines.push("");
	lines.push(`Summary: ${STAGES_WITH_SKILL_MARKDOWN.length} stage skills checked, ${totalSkillIssues} issues.`);
	lines.push("");

	void SCOUT_AGENT_IDS;

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