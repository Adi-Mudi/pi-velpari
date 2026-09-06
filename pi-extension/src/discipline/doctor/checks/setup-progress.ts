/**
 * Setup-progress guide (Phase 2).
 *
 * Detects which of the documented setup steps are complete and names
 * the one next command. Mirrors Senai's `checkSetupProgress` adapted
 * to Velpari's setup.
 *
 * Guidance only — never emits `error`, so it cannot change the
 * report's pass/fail verdict. The first-time-user UX is the entire
 * point: a user who reads the report sees the recommended next step
 * even when every other section is clean.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadState } from "../../../core/state.js";
import { loadFilesConfig } from "../../../core/config.js";
import { loadRequirementsProfile } from "../../../core/profile.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";

export function checkSetupProgress(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	// Step 1 — project files configured.
	let filesDone = false;
	try {
		const cfg = loadFilesConfig(cwd);
		filesDone = !!cfg && !!cfg.projectName;
	} catch {
		filesDone = false;
	}
	items.push({
		status: filesDone ? "ok" : "info",
		message: filesDone
			? "1. Project files configured — done"
			: "1. Project files configured — pending",
		suggestion: filesDone ? undefined : "Run `/velpari-configure-inputs`.",
	});

	// Step 2-4 + 6 depend on the run state.
	let state: ReturnType<typeof loadState> | null = null;
	try {
		state = loadState(cwd);
	} catch {
		state = null;
	}
	const stage = state?.currentStage ?? "none";

	items.push({
		status: stage !== "none" && stage !== "discussing" ? "ok" : "info",
		message:
			stage !== "none" && stage !== "discussing"
				? "2. Discussion completed — done"
				: "2. Discussion completed — pending",
		suggestion:
			stage !== "none" && stage !== "discussing"
				? undefined
				: "Run `/velpari-discuss <mission>`.",
	});

	const prdDone =
		stage === "drafted-prd" ||
		stage === "building-rtm" ||
		stage === "built-rtm" ||
		stage === "analyzing-feasibility" ||
		stage === "analyzed-feasibility" ||
		stage === "designing" ||
		stage === "designed" ||
		stage === "writing-pseudocode" ||
		stage === "wrote-pseudocode" ||
		stage === "planning-tests" ||
		stage === "planned-tests" ||
		stage === "handoff-ready";
	items.push({
		status: prdDone ? "ok" : "info",
		message: prdDone ? "3. PRD drafted — done" : "3. PRD drafted — pending",
		suggestion: prdDone ? undefined : "Run `/velpari-prd` (after discussion).",
	});

	const rtmDone =
		stage === "built-rtm" ||
		stage === "analyzing-feasibility" ||
		stage === "analyzed-feasibility" ||
		stage === "designing" ||
		stage === "designed" ||
		stage === "writing-pseudocode" ||
		stage === "wrote-pseudocode" ||
		stage === "planning-tests" ||
		stage === "planned-tests" ||
		stage === "handoff-ready";
	items.push({
		status: rtmDone ? "ok" : "info",
		message: rtmDone ? "4. RTM built — done" : "4. RTM built — pending",
		suggestion: rtmDone ? undefined : "Run `/velpari-rtm` (after PRD).",
	});

	// Step 5 — requirements profile (optional).
	const profile = (() => {
		try {
			return loadRequirementsProfile(cwd);
		} catch {
			return null;
		}
	})();
	items.push({
		status: profile ? "ok" : "info",
		message: profile
			? "5. Requirements profile configured — done"
			: "5. Requirements profile configured — pending (optional)",
		suggestion: profile ? undefined : "Run `/velpari-configure-requirements`.",
	});

	// Step 6 — first approve.
	const approved = stage !== "none" && stage !== "discussing" && stage !== "discussed";
	items.push({
		status: approved ? "ok" : "info",
		message: approved
			? "6. First approve done — ready for the pipeline"
			: "6. First approve — pending",
		suggestion: approved ? undefined : "Run `/velpari-approve-discuss` after discussion.",
	});

	// Top-of-section summary line that names the single next command.
	const nextStep = items.find((it) => it.status === "info" && it.suggestion);
	if (nextStep && nextStep.suggestion) {
		items.push({
			status: "info",
			message: `Next: ${nextStep.suggestion}`,
		});
	} else {
		items.push({
			status: "ok",
			message: "Setup complete — run any pipeline stage or `/velpari-approve-discuss`.",
		});
	}

	return { title: "Setup progress", items };
}

// Helper kept exported for tests; suppresses unused-import warnings.
export function _stateFileExists(cwd: string): boolean {
	return existsSync(join(cwd, ".IDE_Plans", "velpari", "state.json"));
}
