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

import { loadState } from "../../core/state.js";
import { loadHistory } from "../../core/history.js";
import { loadFilesConfig } from "../../core/config.js";
import { loadRequirementsProfile } from "../../core/profile.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

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
		message: filesDone ? "1. Project files configured — done" : "1. Project files configured — pending",
		suggestion: filesDone ? undefined : suggestionFor("setup-files"),
	});

	// Step 2-4 + 6 depend on the run state.
	let state: ReturnType<typeof loadState> | null = null;
	try {
		state = loadState(cwd);
	} catch {
		state = null;
	}
	const stage = state?.currentStage ?? "none";
	// D2 (audit item c6) — a paused mid-run brainstorm keeps currentStage at
	// "brainstorming"; the run's real progress is the PAUSED stage. Evaluate
	// the gates as of pausedStage when a session is open. History is the
	// fallback "has ever happened" evidence (e.g. an approved brainstorm in
	// this run proves step 2 even when the stage alone reads as pre-brainstorm).
	const effectiveStage = state?.pausedStage ?? stage;
	const history = (() => {
		try {
			return state?.runId ? loadHistory(cwd, state.runId) : [];
		} catch {
			return [];
		}
	})();
	const brainstormEverApproved = history.some((e) => e.command === "/velpari-approve-brainstorm");
	const anyApproveEver = history.some((e) => /approve/.test(e.command));

	const brainstormDone = (effectiveStage !== "none" && effectiveStage !== "brainstorming") || brainstormEverApproved;
	items.push({
		status: brainstormDone ? "ok" : "info",
		message: brainstormDone ? "2. Brainstorm completed — done" : "2. Brainstorm completed — pending",
		suggestion: brainstormDone ? undefined : suggestionFor("setup-brainstorm"),
	});

	const prdDone =
		effectiveStage === "drafted-prd" ||
		effectiveStage === "building-rtm" ||
		effectiveStage === "built-rtm" ||
		effectiveStage === "analyzing-feasibility" ||
		effectiveStage === "analyzed-feasibility" ||
		effectiveStage === "designing" ||
		effectiveStage === "designed" ||
		effectiveStage === "writing-pseudocode" ||
		effectiveStage === "wrote-pseudocode" ||
		effectiveStage === "planning-tests" ||
		effectiveStage === "planned-tests" ||
		effectiveStage === "handoff-ready";
	items.push({
		status: prdDone ? "ok" : "info",
		message: prdDone ? "3. PRD drafted — done" : "3. PRD drafted — pending",
		suggestion: prdDone ? undefined : suggestionFor("setup-prd"),
	});

	const rtmDone =
		effectiveStage === "built-rtm" ||
		effectiveStage === "analyzing-feasibility" ||
		effectiveStage === "analyzed-feasibility" ||
		effectiveStage === "designing" ||
		effectiveStage === "designed" ||
		effectiveStage === "writing-pseudocode" ||
		effectiveStage === "wrote-pseudocode" ||
		effectiveStage === "planning-tests" ||
		effectiveStage === "planned-tests" ||
		effectiveStage === "handoff-ready";
	items.push({
		status: rtmDone ? "ok" : "info",
		message: rtmDone ? "4. RTM built — done" : "4. RTM built — pending",
		suggestion: rtmDone ? undefined : suggestionFor("setup-rtm"),
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
		suggestion: profile ? undefined : suggestionFor("setup-profile"),
	});

	// Step 6 — first approve. Stage position is the primary evidence; history
	// covers the "approved earlier in this run, now back at an early stage"
	// case (e.g. a paused/restarted brainstorm).
	const approved =
		(effectiveStage !== "none" && effectiveStage !== "brainstorming" && effectiveStage !== "brainstormed") ||
		anyApproveEver;
	items.push({
		status: approved ? "ok" : "info",
		message: approved ? "6. First approve done — ready for the pipeline" : "6. First approve — pending",
		suggestion: approved ? undefined : suggestionFor("setup-approve"),
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
			message: "Setup complete — run any pipeline stage or `/velpari-approve-brainstorm`.",
		});
	}

	return { title: "Setup progress", items };
}
