/**
 * /velpari-approve-brainstorm handler (Phase 7 update; v3 added graceful close; FR-58, FR-59, NFR-14;
 * lifecycle v2 gated approve).
 *
 * Bespoke by design — Phase B refactor left this handler outside
 * STAGE_REGISTRY because /velpari-approve-brainstorm is the only handler that
 * writes to a per-brainstorm grouped path with an optional timestamp
 * suffix so re-runs of the same topic don't clobber earlier notes (FR-69).
 *
 * Flow:
 * 1. Read working copy from `.IDE_Plans/velpari/runs/<run-id>/brainstorm/brainstorm-notes.md`.
 *    If only the legacy flat working-copy layout exists, read from there.
 * 2. HARD BLOCK: guardApproveReadiness — understanding must be confirmed and
 *    every brainstorm question must be terminal (agreed / not-wanted /
 *    replaced). "draft" and "discussing" block.
 * 3. HARD BLOCK: guardNotesContent — every required notes section must exist
 *    and be filled (no missing / empty / `_TBD_` sections).
 * 4. v3 — GRACEFUL CLOSE: when state.activeSubagents has both handles,
 *    send a brief prompt to the parent LLM asking it to fire
 *    `subagent_interrupt` on both sessions and call
 *    `velpari_brainstorm_session({ action: "close-sessions" })` to
 *    persist the cleanup. The prompt is fire-and-forget; the handler
 *    continues immediately. Pane close is async — state is the source
 *    of truth and is cleared by the session clear at step 8.
 * 5. Compute topic-slug from mission (via paths.ts:slugify).
 * 6. Publish to Doc/brainstorm/brainstorm-<topic-slug>.md (grouped, atomic).
 *    If a legacy flat file already exists, preserve it.
 * 7. Write the brainstorm audit log (best-effort — never blocks approve).
 * 8. Transition state. Two cases (brainstorm-anytime, D3):
 *    a. First run (no pausedStage): brainstorming -> brainstormed, then
 *       clear the brainstorm session fields (incl. v3 activeSubagents) so
 *       the mutation lock lifts and a later re-run starts with a clean
 *       ledger.
 *    b. Paused run (pausedStage set — the brainstorm was opened from a
 *       later stage): door selection — `--restart-prd` argument wins, else
 *       a picker when the TUI is available, default continue. Door 1
 *       (continue) resumes the paused stage; door 2 (restart-prd) lands at
 *       `brainstormed` so the PRD chain restarts. `resumeFromBrainstorm`
 *       performs the transition and clears the session fields.
 * 9. Notify the user with the next command to run manually
 *    (v1.6.2+ — no auto-chain to /velpari-prd; user runs the next
 *    command by hand so each stage boundary is an explicit, manual
 *    confirm-then-write step). Door 1 names nextCommandsFor(resumed
 *    stage); door 2 and first runs name /velpari-prd.
 *
 * Idempotency: a second /velpari-approve-brainstorm call for the same run
 * fails at the stage check (currentStage is no longer "brainstorming"), so
 * publish + session-clear run exactly once per brainstorm.
 *
 * Go/Clarify/Kill stays prompt-level in the skill (senai split kept: code
 * enforces the hard blocks, the prompt owns the 3-outcome dialog).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { atomicWriteFile } from "../io/atomic-write.js";
import {
	advanceStage,
	appendStageEntry,
	clearBrainstormSession,
	loadState,
	resumeFromBrainstorm,
	type RunState,
} from "../core/state.js";
import { nextCommandsFor } from "../core/constants.js";
import { generationHintForPhase } from "../core/agent-freshness.js";
import {
	buildBrainstormPath,
	buildGroupedBrainstormPath,
	buildRunDir,
	slugify,
} from "../core/paths.js";
import { computeBrainstormInputHashes, recordPublish } from "../core/freshness.js";
import { hashFileContentNormalized } from "../core/fingerprints.js";
import { guardApproveReadiness, guardNotesContent } from "./brainstorm/guard.js";
import { withArtifactFrontmatter } from "../core/frontmatter.js";

/** Generator v2 (D5): prepend the Phase 2 generation step to a "Next: ..."
 *  hint when the phase lacks fresh generated agents. Informational only —
 *  the bundled scouts remain the permanent fallback. */
function withGenerationHint(cwd: string, hint: string): string {
	const genHint = generationHintForPhase(cwd, 2);
	if (!genHint) return hint;
	const rest = hint.startsWith("Next: ") ? hint.slice("Next: ".length) : hint;
	return `Next: ${genHint}, then ${rest}`;
}
import {
	buildSummary,
	countNotesSections,
	createAuditSession,
	writeAuditLog,
} from "./brainstorm/audit.js";

/**
 * v3 — Send a brief prompt to the parent LLM asking it to fire
 * `subagent_interrupt` on each persistent session + persist the close
 * via the `close-sessions` tool action. Best-effort — failure here does
 * NOT block approve; state.activeSubagents is cleared synchronously
 * later in the flow by clearBrainstormSession, which is the source of
 * truth for the dispatcher.
 */
function gracefulClosePrompt(
	handles: { web?: string; docCode?: string },
	mission: string,
): string {
	const webHandle = handles.web ?? "web";
	const docCodeHandle = handles.docCode ?? "doc-code";
	return [
		`The brainstorm for "${mission}" was just approved.`,
		``,
		`Please close the 2 persistent sub-agent sessions now by running:`,
		``,
		`1. subagent_interrupt({ session: "${webHandle}" })  — web-research pane`,
		`2. subagent_interrupt({ session: "${docCodeHandle}" })  — doc-code-analyst pane`,
		`3. velpari_brainstorm_session({ action: "close-sessions" })`,
		``,
		`If subagent_interrupt errors with "session not found", the session`,
		`already closed — proceed to step 3.`,
	].join("\n");
}

export async function handleApproveBrainstorm(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
	rawArgs: string = "",
): Promise<void> {
	// 1. Load state
	const state = loadState(cwd);
	if (!state.runId || state.currentStage === "none") {
		ctx.ui.notify("No active brainstorm to approve.", "error");
		return;
	}
	if (state.currentStage !== "brainstorming") {
		ctx.ui.notify(
			`Cannot approve brainstorm: current stage is "${state.currentStage}". ` +
				`Expected "brainstorming".`,
			"error",
		);
		return;
	}

	// 2. Read working copy from grouped working-copy dir first, then legacy.
	const runDir = buildRunDir(state.runId, cwd);
	const groupedWorkingPath = join(runDir, "brainstorm", "brainstorm-notes.md");
	const legacyWorkingPath = join(runDir, "brainstorm-notes.md");
	const workingPath = existsSync(groupedWorkingPath)
		? groupedWorkingPath
		: legacyWorkingPath;
	if (!existsSync(workingPath)) {
		ctx.ui.notify(`Brainstorm working copy not found at ${workingPath}.`, "error");
		return;
	}
	const content = readFileSync(workingPath, "utf8");

	// 3. HARD BLOCK: lifecycle readiness (understanding confirmed + no open
	//    questions). Checked BEFORE notes content so the user fixes the
	//    conversation first, the document second.
	const readiness = guardApproveReadiness(state);
	if (!readiness.ok) {
		ctx.ui.notify(readiness.reason!, "error");
		return;
	}

	// 4. HARD BLOCK: notes content (missing / empty / _TBD_ sections).
	const notesGuard = guardNotesContent(content);
	if (!notesGuard.ok) {
		ctx.ui.notify(notesGuard.reason!, "error");
		return;
	}

	// 5. v3 — GRACEFUL CLOSE. Snapshot the handles before we proceed
	// (the session clear at step 9 will remove them from state).
	const subagentsToClose = state.activeSubagents?.web && state.activeSubagents?.docCode
		? {
				web: state.activeSubagents.web,
				docCode: state.activeSubagents.docCode,
			}
		: null;

	// 6. Compute target path (grouped layout). Append timestamp suffix
	//    on re-runs so existing files are preserved (FR-69).
	const topicSlug = slugify(state.mission);
	let groupedTarget = join(cwd, buildGroupedBrainstormPath(topicSlug));
	if (existsSync(groupedTarget)) {
		const now = new Date();
		const stamp =
			now.getFullYear().toString() +
			String(now.getMonth() + 1).padStart(2, "0") +
			String(now.getDate()).padStart(2, "0") +
			"-" +
			String(now.getHours()).padStart(2, "0") +
			String(now.getMinutes()).padStart(2, "0") +
			String(now.getSeconds()).padStart(2, "0");
		groupedTarget = join(cwd, buildGroupedBrainstormPath(topicSlug, stamp));
	}

	// 7. Write published copy (grouped). Atomic write via the io layer
	//    (creates parent dirs itself). Stamp the uniform artifact
	//    frontmatter first (RTM traceability upgrade, Phase 1).
	//    B4 freshness stamp: brainstorm's declared inputs are the
	//    configured input documents (files.json inputDocuments) — an
	//    empty map when none are configured. D8: the manifest entry is
	//    keyed on the BASE slug (`brainstorm:<slug>` — one entry per
	//    topic, upserted on every re-run) while `path` points at the
	//    file just published (suffixed or not), so a re-brainstorm
	//    stales downstream artifacts through the A3 machinery.
	const publishNow = new Date().toISOString();
	const brainstormInputs = computeBrainstormInputHashes(cwd, hashFileContentNormalized);
	const stamped = withArtifactFrontmatter(content, {
		artifact: "brainstorm",
		project: topicSlug,
		stage: state.currentStage,
		run: state.runId,
		now: publishNow,
		inputs: JSON.stringify(brainstormInputs),
	});
	atomicWriteFile(groupedTarget, stamped, "utf8");
	try {
		recordPublish(cwd, {
			artifact: "brainstorm",
			slug: topicSlug,
			path: relative(cwd, groupedTarget),
			publishedAt: publishNow,
			inputs: brainstormInputs,
			hashv: 2,
		});
	} catch {
		ctx.ui.notify(
			"Freshness manifest write failed for brainstorm — the publish is intact, only the stamp was skipped.",
			"warning",
		);
	}
	ctx.ui.notify(`Published to ${groupedTarget}`, "info");

	// 8. Write the audit log (best-effort — a failed audit write must never
	//    block approve). Captures the final notes coverage; the dispatch
	//    decisions live in the parent's session, so wall-clock is 0 here.
	try {
		const session = createAuditSession(state.runId, state.mission);
		const coverage = countNotesSections(content);
		writeAuditLog(
			cwd,
			session,
			buildSummary(session, {
				wallClockMs: 0,
				notesSectionsFilled: coverage.filled,
				notesSectionsTotal: coverage.total,
			}),
		);
	} catch {
		// best-effort: audit failures never block approve
	}

	// 9. Transition state. Two cases (brainstorm-anytime, D3):
	//    a. No pausedStage (first run): brainstorming -> brainstormed via
	//       advanceStage, then clearBrainstormSession on the advanced state.
	//    b. pausedStage set (brainstorm opened from a later stage): door
	//       selection — `--restart-prd` argument wins; otherwise a picker
	//       when the TUI is available; default continue. resumeFromBrainstorm
	//       performs the transition and clears the session fields itself.
	//    In both cases the next stage command is NOT auto-invoked — v1.6.2
	//    dropped the auto-chain so the user manually confirms each stage
	//    boundary.
	let cleared: RunState;
	let nextHint: string;
	if (state.pausedStage) {
		let door: "continue" | "restart-prd";
		if (/--restart-prd\b/.test(rawArgs)) {
			door = "restart-prd";
		} else if (ctx.hasUI !== false && typeof ctx.ui.select === "function") {
			const continueLabel = `Continue at "${state.pausedStage}"`;
			const restartLabel = "Restart at the PRD stage";
			const choice = await ctx.ui.select(
				`Brainstorm approved — the run was paused at "${state.pausedStage}". Where should it resume?`,
				[continueLabel, restartLabel],
			);
			door = choice === restartLabel ? "restart-prd" : "continue";
		} else {
			door = "continue";
		}
		cleared = resumeFromBrainstorm(cwd, door);
		if (door === "restart-prd") {
			// Lands on "brainstormed" — a Phase 2 entry (D5 hint applies).
			nextHint = withGenerationHint(cwd, "Next: run /velpari-prd to restart the PRD stage.");
		} else {
			const nextCommands = nextCommandsFor(cleared.currentStage);
			nextHint = nextCommands.length === 1
				? `Next: run ${nextCommands[0]}.`
				: `Next: run one of: ${nextCommands.join(", ")}.`;
		}
	} else {
		const next = advanceStage(state, "/velpari-approve-brainstorm", cwd, pi);
		// Clear the brainstorm session fields (understanding confirmed, scans,
		//    questions, dispatch count, v3 activeSubagents) on the advanced
		//    state — the mutation lock lifts and a later re-run starts with
		//    a clean ledger.
		cleared = clearBrainstormSession(next, cwd);
		// Lands on "brainstormed" — a Phase 2 entry (D5 hint applies).
		nextHint = withGenerationHint(cwd, "Next: run /velpari-prd to start the PRD stage.");
	}
	appendStageEntry(pi, cleared, cwd);
	// v0.5.1 Phase J.2: reflect the brainstorm-approved stage in the footer
	// status bar via the documented ctx.ui.setStatus(key, text) API.
	ctx.ui.setStatus("velpari", `stage: ${cleared.currentStage} | run: ${cleared.runId}`);

	// 10. v3 — fire the graceful-close prompt to the parent LLM so the
	//     2 multiplexer panes get interrupted. Fire-and-forget; the LLM
	//     processes it on its next turn. State.activeSubagents has
	//     already been cleared by the session clear above, so the
	//     dispatcher will reject any further routed subagent() calls
	//     even if the panes are still open.
	if (subagentsToClose) {
		try {
			pi.sendUserMessage(gracefulClosePrompt(subagentsToClose, state.mission));
		} catch {
			// Best-effort — the panes stay open until the user closes
			// them manually. State is the source of truth and is clean.
		}
	}

	// 11. Show the user the single next command to run by hand.
	//     No auto-chain: clean, predictable, manual confirm-then-write
	//     discipline at every stage boundary.
	ctx.ui.notify(`Brainstorm notes published. ${nextHint}`, "info");

	void buildBrainstormPath;
}
