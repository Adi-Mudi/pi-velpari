/**
 * Doctor orchestrator + handler.
 *
 * Phase D split:
 *   - this file           — orchestrator: assembles sections + handler
 *   - ./report.ts         — markdown report file write + truncation
 *   - ./checks/secrets.ts          — secret scanner
 *   - ./checks/multiplexer.ts      — multiplexer detection + pi-interactive-subagents
 *   - ./checks/psrs.ts             — PSRS structural check
 *   - ./checks/rtm.ts              — RTM-to-PSRS traceability check
 *   - ./checks/agents.ts           — scout agent file presence + skill markdown integrity
 *   - ./checks/paths.ts            — grouped/legacy path presence per artifact
 *   - ./checks/working-published.ts — working vs published separation
 *   - ./checks/profile.ts          — requirements profile presence + version
 *
 * Adding a new check = write a new file in ./checks/ and append a call to
 * it in runDoctor(). No edits to other checks required.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { PATHS } from "../../core/constants.js";
import { loadFilesConfig, validateFilesConfig } from "../../core/config.js";
import { loadState } from "../../core/state.js";
import { renderPsrsSummary, validatePsrs } from "../../core/psrs.js";
import {
	REQUIREMENTS_PROFILE_VERSION,
	loadRequirementsProfile,
	validateRequirementsProfile,
} from "../../core/profile.js";
import { buildGroupedPath, buildOutputPath } from "../../core/paths.js";
import { writeDoctorReport } from "./report.js";
import { checkGroupedLegacyPaths } from "./checks/paths.js";
import { checkWorkingPublishedSeparation } from "./checks/working-published.js";
import { checkPsrs } from "./checks/psrs.js";
import { checkRtmTraceability } from "./checks/rtm.js";
import { scanForSecrets } from "./checks/secrets.js";
import { detectMultiplexer, detectInteractiveSubagentsVersion } from "./checks/multiplexer.js";
import {
	ALL_STAGE_SCOUTS,
	REQUIRED_AGENT_FIELDS,
	STAGES_WITH_SKILL_MARKDOWN,
	parseFrontmatter,
	checkScoutAgentFiles,
	checkStageSkillMarkdowns,
	scoutAgentCheck,
} from "./checks/agents.js";
import { checkRequirementsProfile } from "./checks/profile.js";

/** Re-exports for callers (commands.ts, doctor.test.ts).
 * Each is sourced from its own check submodule so callers can import
 * from a single entry while keeping the source modules narrow.
 */
export { scanForSecrets } from "./checks/secrets.js";
export {
	detectMultiplexer,
	detectInteractiveSubagentsVersion,
	type MultiplexerKind,
	type MultiplexerInfo,
} from "./checks/multiplexer.js";
export {
	ALL_STAGE_SCOUTS,
	REQUIRED_AGENT_FIELDS,
} from "./checks/agents.js";
export { writeDoctorReport } from "./report.js";

// ---------------------------------------------------------------------------
// Helper: read the projectName from .pi/velpari/files.json.
// ---------------------------------------------------------------------------

function readProjectName(cwd: string): string {
	try {
		const cfg = loadFilesConfig(cwd);
		return validateFilesConfig(cfg) ? cfg.projectName : "";
	} catch {
		return "";
	}
}

// ---------------------------------------------------------------------------
// Helper: append each section to a shared lines array.
// ---------------------------------------------------------------------------

function appendStateSection(cwd: string, lines: string[]): void {
	const statePath = join(cwd, PATHS.STATE_FILE);
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
}

function appendConfigSection(cwd: string, lines: string[]): void {
	const configPath = join(cwd, PATHS.CONFIG_DIR, "files.json");
	if (existsSync(configPath)) {
		const config = loadFilesConfig(cwd);
		const valid = validateFilesConfig(config);
		lines.push(`Config: ${valid ? "VALID" : "INVALID"} (projectName="${config.projectName}")`);
	} else {
		lines.push("Config: MISSING (run /velpari-configure-inputs)");
	}
	lines.push("");
}

function appendProfileSection(cwd: string, lines: string[]): void {
	lines.push("## Requirements profile");
	checkRequirementsProfile(cwd, lines);
	lines.push("");
}

function appendDocArtifactsSection(cwd: string, lines: string[]): void {
	const docDir = join(cwd, "Doc");
	lines.push("## Doc/ artifacts");
	if (!existsSync(docDir)) {
		lines.push("- Doc/ directory missing");
		return;
	}
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

function appendMultiplexerSection(cwd: string, lines: string[]): void {
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
}

function appendScoutAgentsSection(cwd: string, lines: string[]): void {
	lines.push("## Scout agents (.pi/agents/)");
	checkScoutAgentFiles(cwd, lines);
	lines.push("");
	const totalScouts = Object.values(ALL_STAGE_SCOUTS).flat().length;
	const totalStages = Object.keys(ALL_STAGE_SCOUTS).length;
	lines.push(
		`Summary: ${totalScouts} scouts expected across ${totalStages} stages. ` +
			`Missing: ${scoutAgentCheck.missing}, bad frontmatter: ${scoutAgentCheck.badFrontmatter}.`,
	);
	lines.push("");
}

function appendStageSkillsSection(cwd: string, lines: string[]): void {
	lines.push("## Stage skills");
	const issueCount = checkStageSkillMarkdowns(cwd, lines);
	lines.push("");
	lines.push(
		`Summary: ${STAGES_WITH_SKILL_MARKDOWN.length} stage skills checked, ${issueCount} issues.`,
	);
	lines.push("");
}

// ---------------------------------------------------------------------------
// runDoctor — assembles the report.
// ---------------------------------------------------------------------------

/**
 * Run the full audit. Returns the report markdown and writes it to disk.
 */
export function runDoctor(cwd: string = process.cwd()): string {
	const lines: string[] = ["# Velpari Doctor Report", ""];
	const projectName = readProjectName(cwd);

	appendStateSection(cwd, lines);
	appendConfigSection(cwd, lines);
	appendProfileSection(cwd, lines);
	appendDocArtifactsSection(cwd, lines);

	checkGroupedLegacyPaths(cwd, projectName, lines);
	checkWorkingPublishedSeparation(cwd, projectName, lines);
	checkPsrs(cwd, projectName, lines);
	checkRtmTraceability(cwd, projectName, lines);

	appendMultiplexerSection(cwd, lines);
	appendScoutAgentsSection(cwd, lines);
	appendStageSkillsSection(cwd, lines);

	return lines.join("\n");
}

/**
 * /velpari-doctor handler. Runs the audit and emits summary.
 */
export async function handleDoctor(
	ctx: ExtensionCommandContext,
	pi?: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	// v0.5.0 Phase I.1: honor the --velpari-skip-doctor flag (registered
	// in index.ts). When set, short-circuit and notify the user instead of
	// running the audit. The `?.` makes this safe in test rig / RPC mode
	// where `pi` is absent.
	if (pi?.getFlag?.("velpari-skip-doctor")) {
		ctx.ui.notify("Doctor checks skipped (--velpari-skip-doctor).", "info");
		return;
	}
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

/** Maximum length of the notify that the handler pushes to the TUI. */
const MAX_NOTIFY_LENGTH = 8000;
