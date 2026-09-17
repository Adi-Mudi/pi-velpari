/**
 * /velpari-approve-brainstorm handler (Phase 7 update; FR-58, FR-59, NFR-14;
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
 * 4. Compute topic-slug from mission (via paths.ts:slugify).
 * 5. Publish to Doc/brainstorm/brainstorm-<topic-slug>.md (grouped, atomic).
 *    If a legacy flat file already exists, preserve it.
 * 6. Write the brainstorm audit log (best-effort — never blocks approve).
 * 7. Transition state: brainstorming -> brainstormed, then clear the
 *    brainstorm session fields so the mutation lock lifts.
 * 8. Notify the user with the next command to run manually
 *    (v1.6.2+ — no auto-chain to /velpari-prd; user runs the next
 *    command by hand so each stage boundary is an explicit, manual
 *    confirm-then-write step).
 *
 * Idempotency: a second /velpari-approve-brainstorm call for the same run
 * fails at the stage check (currentStage is no longer "brainstorming"), so
 * publish + session-clear run exactly once per brainstorm.
 *
 * Go/Clarify/Kill stays prompt-level in the skill (senai split kept: code
 * enforces the hard blocks, the prompt owns the 3-outcome dialog).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { atomicWriteFile } from "../io/atomic-write.js";
import {
	advanceStage,
	appendStageEntry,
	clearBrainstormSession,
	loadState,
} from "../core/state.js";
import {
	buildBrainstormPath,
	buildGroupedBrainstormPath,
	buildRunDir,
	slugify,
} from "../core/paths.js";
import { guardApproveReadiness, guardNotesContent } from "./brainstorm/guard.js";
import { withArtifactFrontmatter } from "../core/frontmatter.js";
import {
	buildSummary,
	countNotesSections,
	createAuditSession,
	writeAuditLog,
} from "./brainstorm/audit.js";

export async function handleApproveBrainstorm(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
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

	// 5. Compute target path (grouped layout). Append timestamp suffix
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

	// 6. Write published copy (grouped). Atomic write via the io layer
	//    (creates parent dirs itself). Stamp the uniform artifact
	//    frontmatter first (RTM traceability upgrade, Phase 1).
	const stamped = withArtifactFrontmatter(content, {
		artifact: "brainstorm",
		project: topicSlug,
		stage: state.currentStage,
		run: state.runId,
	});
	atomicWriteFile(groupedTarget, stamped, "utf8");
	ctx.ui.notify(`Published to ${groupedTarget}`, "info");

	// 7. Write the audit log (best-effort — a failed audit write must never
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

	// 8. Transition state: brainstorming -> brainstormed (via
	//    /velpari-approve-brainstorm). The next stage command
	//    (/velpari-prd) is NOT auto-invoked — v1.6.2 dropped the
	//    auto-chain so the user manually confirms each stage boundary.
	const next = advanceStage(state, "/velpari-approve-brainstorm", cwd, pi);
	// Clear the brainstorm session fields (understanding confirmed, scans,
	//    questions, dispatch count) on the advanced state — the mutation lock
	//    lifts and a later re-run starts with a clean ledger.
	const cleared = clearBrainstormSession(next, cwd);
	appendStageEntry(pi, cleared);
	// v0.5.1 Phase J.2: reflect the brainstorm-approved stage in the footer
	// status bar via the documented ctx.ui.setStatus(key, text) API.
	ctx.ui.setStatus("velpari", `stage: ${cleared.currentStage} | run: ${cleared.runId}`);

	// 9. Show the user the single next command to run by hand.
	//    No auto-chain: clean, predictable, manual confirm-then-write
	//    discipline at every stage boundary.
	ctx.ui.notify(
		`Brainstorm notes published. Next: run /velpari-prd to start the PRD stage.`,
		"info",
	);

	void buildBrainstormPath;
}
