/**
 * Doctor orchestrator + handler (Phase 1 refactor).
 *
 * Phase 1 changes the output shape from a flat string to a structured
 * `DiagnosticReport`. Every check returns a `DiagnosticSection`; the
 * orchestrator collects sections, computes summary + verdict, and
 * hands the report to the formatter.
 *
 * Phase 0 layout (this file is unchanged in structure):
 *   - index.ts      — orchestrator: assembles sections + handler
 *   - report.ts     — markdown report file write + truncation
 *   - _types.ts     — DiagnosticStatus / Item / Section / Report
 *   - checks/*.ts   — one file per check, each returns DiagnosticSection
 *
 * Adding a new check = write a new file in checks/ and append a call
 * in runDoctor(). No edits to other checks required.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { PATHS } from "../../core/constants.js";
import { loadFilesConfig, validateFilesConfig } from "../../core/config.js";
import { loadState } from "../../core/state.js";
import {
	type DiagnosticItem,
	type DiagnosticReport,
	type DiagnosticSection,
	summarize,
} from "./_types.js";
import { writeDoctorReport } from "./report.js";
import { checkGroupedLegacyPathsSection } from "./checks/paths.js";
import { checkWorkingPublishedSeparationSection } from "./checks/working-published.js";
import { checkPsrsSection } from "./checks/psrs.js";
import { checkRtmTraceabilitySection } from "./checks/rtm.js";
import { scanForSecrets } from "./checks/secrets.js";
import { detectMultiplexer, detectInteractiveSubagentsVersion } from "./checks/multiplexer.js";
import {
	checkScoutAgentsSection,
	checkStageSkillsSection,
} from "./checks/agents.js";
import { checkRequirementsProfileSection } from "./checks/profile.js";
import { checkSetupProgress } from "./checks/setup-progress.js";
import { checkSubagentExtension } from "./checks/subagent-extension.js";
import { checkStrayFiles } from "./checks/stray-files.js";
import { suggestionFor } from "./checks/fix-suggestions.js";

/** Re-exports for callers (commands/index.ts, doctor.test.ts).
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
	checkScoutAgentsSection,
	checkStageSkillsSection,
	ALL_STAGE_SCOUTS,
	REQUIRED_AGENT_FIELDS,
} from "./checks/agents.js";
export { writeDoctorReport, formatDiagnosticReport } from "./report.js";
export {
	type DiagnosticItem,
	type DiagnosticSection,
	type DiagnosticReport,
	type DiagnosticStatus,
	iconFor,
	summarize,
} from "./_types.js";

// ---------------------------------------------------------------------------
// Helpers: read projectName and build small inline sections.
// ---------------------------------------------------------------------------

function readProjectName(cwd: string): string {
	try {
		const cfg = loadFilesConfig(cwd);
		return validateFilesConfig(cfg) ? cfg.projectName : "";
	} catch {
		return "";
	}
}

function buildStateSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const statePath = join(cwd, PATHS.STATE_FILE);
	if (existsSync(statePath)) {
		const state = loadState(cwd);
		items.push({
			status: "ok",
			message: `Run: ${state.runId}`,
			details: [
				`Mission: ${state.mission || "(none)"}`,
				`Current stage: ${state.currentStage}`,
				`History entries: ${state.history.length}`,
			],
		});
	} else {
		items.push({
			status: "info",
			message: "No active run. State: empty.",
			suggestion: suggestionFor("no-active-run"),
		});
	}
	return { title: "Run state", items };
}

function buildConfigSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const configPath = join(cwd, PATHS.CONFIG_DIR, "files.json");
	if (existsSync(configPath)) {
		const config = loadFilesConfig(cwd);
		const valid = validateFilesConfig(config);
		items.push({
			status: valid ? "ok" : "error",
			message: `Config: ${valid ? "VALID" : "INVALID"} (projectName="${config.projectName}")`,
			suggestion: valid ? undefined : suggestionFor("config-invalid"),
		});
	} else {
		items.push({
			status: "info",
			message: "Config: MISSING",
			suggestion: suggestionFor("config-missing"),
		});
	}
	return { title: "Config", items };
}

function buildDocArtifactsSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const docDir = join(cwd, "Doc");
	if (!existsSync(docDir)) {
		items.push({
			status: "info",
			message: "Doc/ directory missing",
			suggestion: suggestionFor("doc-dir-missing"),
		});
		return { title: "Doc/ artifacts", items };
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
		items.push({
			status: "info",
			message: "No artifacts in Doc/ yet.",
		});
		return { title: "Doc/ artifacts", items };
	}

	items.push({
		status: "ok",
		message: `${files.length} markdown file(s) under Doc/.`,
		details: files.map((f) => `- ${f}`),
	});

	return { title: "Doc/ artifacts", items };
}

function buildMultiplexerSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const mux = detectMultiplexer();
	items.push({
		status: mux.mux === "unknown" ? "warning" : "ok",
		message: `Multiplexer detected: ${mux.mux} (env: ${mux.source})`,
		details: ["Required for /velpari-discuss v2.0 visible subagents."],
		suggestion:
			mux.mux === "unknown"
				? suggestionFor("unknown-multiplexer")
				: undefined,
	});

	const subagentsVersion = detectInteractiveSubagentsVersion(cwd);
	if (subagentsVersion) {
		items.push({
			status: "ok",
			message: `pi-interactive-subagents: ${subagentsVersion}`,
		});
	} else {
		items.push({
			status: "warning",
			message: "pi-interactive-subagents: NOT FOUND (peer dep required for visible subagents)",
			suggestion: suggestionFor("subagent-ext-missing"),
		});
	}

	if (mux.mux === "unknown") {
		items.push({
			status: "info",
			message: "Supported multiplexers: cmux, tmux, zellij, wezTerm. Start with e.g. `tmux new -A -s pi 'pi'`.",
		});
	}
	if (mux.mux === "zellij") {
		items.push({
			status: "warning",
			message: "zellij known bug [pi-interactive-subagents Issue #19]: `zellij action close-pane` closes the FOCUSED pane, not the target.",
			details: [
				suggestionFor("zellij-close-pane"),
				"cmux/tmux/wezterm are not affected.",
			],
		});
	}

	return { title: "Multiplexer (required for /velpari-discuss v2.0)", items };
}

// Inline secret scan for Doc/ only; Phase 5 expands scope.
function buildDocSecretScanSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const docDir = join(cwd, "Doc");
	if (!existsSync(docDir)) {
		return { title: "Secret scan (Doc/)", items };
	}

	const recurse = (dir: string): string[] => {
		const out: string[] = [];
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.isDirectory()) out.push(...recurse(join(dir, e.name)));
			else if (e.name.endsWith(".md")) out.push(join(dir, e.name));
		}
		return out;
	};

	const hits: string[] = [];
	for (const filePath of recurse(docDir)) {
		const content = readFileSync(filePath, "utf8");
		const scanHits = scanForSecrets(content);
		for (const h of scanHits) {
			hits.push(`  - ${h.pattern} at line ${h.line} in ${filePath.replace(`${cwd}/`, "")}`);
		}
	}

	if (hits.length > 0) {
		items.push({
			status: "warning",
			message: `Secret scan (NFR-04): ${hits.length} potential secret(s) in Doc/.`,
			details: hits,
			suggestion: suggestionFor("secret-detected"),
		});
	} else {
		items.push({
			status: "ok",
			message: "Secret scan: no secrets detected in Doc/.",
		});
	}

	return { title: "Secret scan (Doc/)", items };
}

// ---------------------------------------------------------------------------
// runDoctor — assembles the report.
// ---------------------------------------------------------------------------

/**
 * Run the full audit. Returns the structured report; the caller decides
 * whether to format it, write it to disk, or notify it.
 */
export function runDoctor(cwd: string = process.cwd()): DiagnosticReport {
	const projectName = readProjectName(cwd);

	const sections: DiagnosticSection[] = [
		checkSetupProgress(cwd),
		buildStateSection(cwd),
		buildConfigSection(cwd),
		checkRequirementsProfileSection(cwd),
		buildDocArtifactsSection(cwd),
		checkGroupedLegacyPathsSection(cwd, projectName),
		checkWorkingPublishedSeparationSection(cwd, projectName),
		checkPsrsSection(cwd, projectName),
		checkRtmTraceabilitySection(cwd, projectName),
		buildMultiplexerSection(cwd),
		checkSubagentExtension(),
		checkStrayFiles(cwd),
		checkScoutAgentsSection(cwd),
		checkStageSkillsSection(cwd),
		buildDocSecretScanSection(cwd),
	];

	const { summary, ok } = summarize(sections);
	return { ok, summary, sections };
}

/** Maximum length of the notify that the handler pushes to the TUI. */
const MAX_NOTIFY_LENGTH = 8000;

/**
 * /velpari-doctor handler. Runs the audit, writes the report, and emits
 * a summary notification. Honors --velpari-skip-doctor.
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
	// Format a short summary for the TUI notify; full report goes to disk.
	const summaryLine = `Doctor: ${report.summary.ok} OK / ${report.summary.warning} warnings / ${report.summary.error} errors${report.ok ? "" : " — see report for fixes."}`;
	if (summaryLine.length <= MAX_NOTIFY_LENGTH) {
		ctx.ui.notify(summaryLine, report.ok ? "info" : "warning");
	} else {
		ctx.ui.notify(summaryLine.slice(0, MAX_NOTIFY_LENGTH) + "\n... [truncated]", "warning");
	}
	ctx.ui.notify(`Full report written to ${reportPath}.`, "info");
}
