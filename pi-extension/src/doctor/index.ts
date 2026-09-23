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
import { PATHS } from "../core/constants.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { loadState } from "../core/state.js";
import { loadHistory } from "../core/history.js";
import { buildWorkingGroupedPath } from "../core/paths.js";
import { type DiagnosticItem, type DiagnosticReport, type DiagnosticSection, summarize } from "./_types.js";
import { writeDoctorReport } from "./report.js";
import { checkGroupedLegacyPathsSection } from "./checks/paths.js";
import { checkWorkingPublishedSeparationSection } from "./checks/working-published.js";
import { checkPsrsSection } from "./checks/psrs.js";
import { checkRtmTraceabilitySection } from "./checks/rtm.js";
import { checkFrontmatterSection } from "./checks/frontmatter.js";
import { checkRtmDataSection } from "./checks/rtm-data.js";
import { checkTraceLinkConsistencySection } from "./checks/trace-link-consistency.js";
import { checkAfDataSection } from "./checks/af-data.js";
import { checkTestCasesDataSection } from "./checks/test-cases-data.js";
import { checkDevOrderDataSection } from "./checks/dev-order-data.js";
import { checkFeasibilityRecordSection } from "./checks/feasibility-record.js";
import { checkFingerprintsSection } from "./checks/fingerprints.js";
import { checkPhaseConsistencySection } from "./checks/phase-consistency.js";
import { checkMvpCoverageSection } from "./checks/mvp-coverage.js";
import { checkFeasibilityV2Section } from "./checks/feasibility-v2.js";
import { detectMultiplexer, detectInteractiveSubagentsVersion } from "./checks/multiplexer.js";
import {
	checkScoutAgentsSection,
	checkStageSkillsSection,
	checkAgentFileIntegrity,
	checkAgentMappingSection,
} from "./checks/agents.js";
import { checkRequirementsProfileSection } from "./checks/profile.js";
import { checkSecretScan } from "./checks/secrets.js";
import { checkSetupProgress } from "./checks/setup-progress.js";
import { checkSubagentExtension } from "./checks/subagent-extension.js";
import { checkStrayFiles } from "./checks/stray-files.js";
import { checkWebToolLock } from "./checks/web-tool-lock.js";
import { checkOfficialReadiness } from "./checks/official-readiness.js";
import { checkSubAgentGeneratorSection } from "./checks/sub-agent-generator.js";
import { checkAgentFreshnessSection } from "./checks/agent-freshness.js";
import { checkVerifierVerdictsSection } from "./checks/reviewer-verdict.js";
import { checkDesignReadiness } from "./checks/design-readiness.js";
import { checkShapeCompatibilityAll } from "./checks/shape-compatibility.js";
import { checkGateWiringSection, checkStaleDownstreamSection } from "./checks/stale-downstream.js";
import { checkFreshnessSection } from "./checks/freshness.js";
import { checkIdCoverageSection } from "./checks/id-coverage.js";
import { checkScanOptions } from "./checks/scan-options.js";
import { checkLoggingPlanSection } from "./checks/logging-plan.js";
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

/**
 * Load the design working-copy content for the current run + project,
 * or null when there is no active run / no working copy on disk. Used
 * by `checkDesignReadiness` so the doctor audit reaches the same
 * content the publish gate checks against. Kept local to this module;
 * it depends on `loadState` + `buildWorkingGroupedPath` for the run id
 * and project name respectively.
 */
function loadDesignWorkingContent(cwd: string): string | null {
	let runId: string | null = null;
	try {
		const state = loadState(cwd);
		runId = state?.runId ?? null;
	} catch {
		return null;
	}
	if (!runId) return null;

	let projectName = "";
	try {
		const cfg = loadFilesConfig(cwd);
		if (validateFilesConfig(cfg)) projectName = cfg.projectName;
	} catch {
		return null;
	}
	if (!projectName) return null;

	const path = buildWorkingGroupedPath(cwd, runId, "design", projectName);
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
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
				`History entries: ${loadHistory(cwd, state.runId).length}`,
			],
		});
	} else {
		items.push({
			status: "info",
			message: "No active run. State: empty.",
			suggestion: suggestionFor("no-active-run"),
		});
	}
	if (existsSync(join(cwd, PATHS.LEGACY_STATE_FILE))) {
		items.push({
			status: "info",
			message: `Legacy state file present: ${PATHS.LEGACY_STATE_FILE}. Migration to ${PATHS.STATE_FILE} is pending — re-run any /velpari-* command to trigger it.`,
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
		details: ["Required for /velpari-brainstorm v2.0 visible subagents."],
		suggestion: mux.mux === "unknown" ? suggestionFor("unknown-multiplexer") : undefined,
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
			message:
				"zellij known bug [pi-interactive-subagents Issue #19]: `zellij action close-pane` closes the FOCUSED pane, not the target.",
			details: [suggestionFor("zellij-close-pane"), "cmux/tmux/wezterm are not affected."],
		});
	}

	return { title: "Multiplexer (required for /velpari-brainstorm v2.1)", items };
}

// ---------------------------------------------------------------------------
// runDoctor — assembles the report.
// ---------------------------------------------------------------------------

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
		checkFrontmatterSection(cwd, projectName),
		checkRtmDataSection(cwd, projectName),
		checkTraceLinkConsistencySection(cwd, projectName),
		checkAfDataSection(cwd, projectName),
		checkTestCasesDataSection(cwd, projectName),
		checkDevOrderDataSection(cwd, projectName),
		checkFingerprintsSection(cwd, projectName),
		checkPhaseConsistencySection(cwd, projectName),
		checkMvpCoverageSection(cwd, projectName),
		checkFeasibilityV2Section(cwd, projectName),
		checkFeasibilityRecordSection(cwd, projectName),
		checkStaleDownstreamSection(cwd, projectName),
		checkFreshnessSection(cwd),
		checkIdCoverageSection(cwd),
		checkGateWiringSection(cwd),
		buildMultiplexerSection(cwd),
		checkSubagentExtension(),
		checkStrayFiles(cwd),
		checkWebToolLock(cwd),
		checkAgentFileIntegrity(cwd),
		checkScoutAgentsSection(cwd),
		checkAgentMappingSection(cwd),
		checkStageSkillsSection(cwd),
		checkSecretScan(cwd),
		checkOfficialReadiness(cwd),
		checkScanOptions(cwd),
		checkSubAgentGeneratorSection(cwd),
		checkAgentFreshnessSection(cwd),
		// C3 — Layer-3 anytime reporting: last known verifier verdicts +
		// verdict-vs-published-artifact freshness (spec 03 §Gate summary).
		checkVerifierVerdictsSection(cwd),
		checkDesignReadiness(loadDesignWorkingContent(cwd)),
		checkShapeCompatibilityAll(cwd),
		// v1.4.0 — cross-cutting discipline command /velpari-design-logging.
		// Audits Doc/observability/logging-plan_<project>.md. Hard error
		// when an active standards overlay requires logging.
		checkLoggingPlanSection(cwd, projectName),
	];

	// Phase 5: prepend an "Action items" callout so errors and warnings
	// survive TUI truncation. Built AFTER the main sections so it sees
	// every actionable item.
	const actionItems = buildActionItemsSection(sections);
	const finalSections = [actionItems, ...sections];

	const { summary, ok } = summarize(finalSections);
	return { ok, summary, sections: finalSections };
}

/**
 * Build a top-of-report "Action items" callout listing every error
 * and warning item with its suggestion. Useful when the full report
 * is truncated by the TUI notify (8000-char cap).
 */
function buildActionItemsSection(sections: DiagnosticSection[]): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	for (const section of sections) {
		for (const item of section.items) {
			if (item.status !== "error" && item.status !== "warning") continue;
			const fix = item.suggestion ? ` → Fix: ${item.suggestion}` : "";
			items.push({
				status: item.status,
				message: `${section.title}: ${item.message}${fix}`,
			});
		}
	}
	if (items.length === 0) {
		return {
			title: "Action items",
			items: [
				{
					status: "ok",
					message: "No errors or warnings — nothing to fix.",
				},
			],
		};
	}
	return { title: "Action items", items };
}

/** Maximum length of the notify that the handler pushes to the TUI. */
const MAX_NOTIFY_LENGTH = 8000;

/**
 * Outcome of an `handleDoctor` call. Returned to the caller
 * (`commands/doctor.ts`) so the optional `--velpari-fix` fix-picker
 * flow can read the report + actionable items without re-running the
 * audit. Picker / dispatch live in L2/L3 (see `ui/fix-picker.ts` and
 * `commands/doctor.ts`); the layer rule forbids `doctor/` (L1) from
 * importing `ui/` (L2), so the audit must hand the report back.
 */
interface HandleDoctorResult {
	/** True if `--velpari-skip-doctor` was honored (audit did not run). */
	skipped: boolean;
	/** The full audit report. `null` when `skipped === true`. */
	report: DiagnosticReport | null;
}

/**
 * /velpari-doctor handler. Runs the audit, writes the report, emits a
 * summary notification, and returns the report so the caller can run
 * an optional interactive fix picker (see `commands/doctor.ts` +
 * `--velpari-fix`). Honors `--velpari-skip-doctor`.
 */
export async function handleDoctor(
	ctx: ExtensionCommandContext,
	pi?: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<HandleDoctorResult> {
	// v0.5.0 Phase I.1: honor the --velpari-skip-doctor flag (registered
	// in index.ts). When set, short-circuit and notify the user instead of
	// running the audit. The `?.` makes this safe in test rig / RPC mode
	// where `pi` is absent.
	if (pi?.getFlag?.("velpari-skip-doctor")) {
		ctx.ui.notify("Doctor checks skipped (--velpari-skip-doctor).", "info");
		return { skipped: true, report: null };
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
	return { skipped: false, report };
}
