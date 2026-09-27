/**
 * stages/worktree-lock.ts — the worktree-enforcement decision point
 * (Layer 1; Phase 5, N5/N6/N8).
 *
 * Same discipline as `stages/transition-lock.ts`: ONE deterministic place
 * decides "may this command run here?", and every refusal names the exact fix
 * (self-healing, never a dead end). The verdicts:
 *
 *   foreign-line        a second run line is already live in this folder (N5)
 *   worktree-mismatch   this folder is not the run's worktree (N6)
 *   branch-mismatch     this worktree is on another branch than the run's (N6)
 *   branch-moved        the run's branch is checked out in ANOTHER folder (N6)
 *   upstream-moved      a foreign run published a newer upstream revision (N8-B)
 *
 * Fail-open everywhere (R4): no active run, no stamp, a non-git folder or an
 * unreadable store → `{ ok: true }` (plus a note). A gate bug must never wedge
 * a run — the same contract the shipped guards use.
 *
 * Layer 1: imports L0 only.
 */

import type { ChangeReport } from "../core/change-report.js";
import { buildChangeReport } from "../core/change-report.js";
import { foreignLinesInWorktree, readRunBinding } from "../core/run-binding.js";
import type { RunState } from "../core/state.js";
import { branchCheckedOutAt, detectWorktree, samePaths, worktreeAddHint } from "../core/worktree.js";

/** Why a command was refused. */
export type WorktreeBlockKind =
	| "foreign-line"
	| "worktree-mismatch"
	| "branch-mismatch"
	| "branch-moved"
	| "upstream-moved";

/** The verdict: allowed (with notes) or blocked with the exact reason. */
export type WorktreeVerdict = { ok: true; notes: string[] } | { ok: false; kind: WorktreeBlockKind; reason: string };

/** Facts the message builder needs (all optional — the builder tolerates gaps). */
export interface WorktreeBlockInfo {
	/** The run being checked. */
	runId: string;
	/** Worktree the run is bound to. */
	worktree?: string | null;
	/** Branch the run is bound to. */
	branch?: string | null;
	/** Folder we are actually in. */
	currentWorktree?: string;
	/** Branch we are actually on. */
	currentBranch?: string;
	/** The other run line (foreign-line / branch-moved). */
	otherRunId?: string | null;
	/** The other folder (branch-moved). */
	otherWorktree?: string | null;
	/** The foreign moves (upstream-moved). */
	moves?: readonly {
		kind: string;
		runId: string;
		revisionNumber: number;
		commit: string | null;
		myRevisionNumber: number | null;
	}[];
	/** Label used to build the `git worktree add` hint (defaults to the run id). */
	hintLabel?: string;
}

/**
 * The self-healing text for every block kind. Kept in one place so the run
 * start, stage start, publish and the tool guard cannot drift apart.
 * @param {WorktreeBlockKind} kind - Verdict that blocked.
 * @param {WorktreeBlockInfo} info - Facts to print.
 * @returns {string} The full block message (always names a fix).
 */
export function worktreeBlockMessage(kind: WorktreeBlockKind, info: WorktreeBlockInfo): string {
	const hint = worktreeAddHint(info.hintLabel ?? info.runId);
	switch (kind) {
		case "foreign-line":
			return (
				`Run ${info.otherRunId ?? "(unknown)"} is parallel to active run ${info.runId} in this working folder` +
				`${info.currentWorktree ? ` (${info.currentWorktree})` : ""}. ` +
				`Create a separate worktree: ${hint} — then run Velpari there. ` +
				`(One run line per worktree — N5.)`
			);
		case "worktree-mismatch":
			return (
				`Worktree mismatch (N6): run ${info.runId} is bound to worktree ${info.worktree ?? "(unknown)"}` +
				`${info.branch ? ` on branch ${info.branch}` : ""}, but this command runs in ` +
				`${info.currentWorktree || "(unknown)"}${info.currentBranch ? ` on branch ${info.currentBranch}` : ""}. ` +
				`Either work in the run's worktree (cd ${info.worktree ?? "<bound worktree>"}) — or, for a parallel line, ` +
				`create a separate worktree: ${hint}`
			);
		case "branch-mismatch":
			return (
				`Branch mismatch (N6): run ${info.runId} is bound to branch ${info.branch ?? "(unknown)"}, ` +
				`but this worktree is on ${info.currentBranch || "(unknown)"}. ` +
				`Switch back: git checkout ${info.branch ?? "<bound branch>"} — or continue a parallel line in a ` +
				`separate worktree: ${hint}`
			);
		case "branch-moved":
			return (
				`The run's branch ${info.branch ?? "(unknown)"} is now checked out in another worktree ` +
				`${info.otherWorktree ?? ""} (N6). Continue the line there — or, to keep working here, create a new ` +
				`worktree: ${hint}`
			);
		case "upstream-moved": {
			const lines = (info.moves ?? []).map(
				(move) =>
					`  - ${move.kind} rev ${move.revisionNumber} published by run ${move.runId} (commit ${move.commit ?? "n/a"})` +
					`${move.myRevisionNumber === null ? "" : ` — your line is at rev ${move.myRevisionNumber}`}`,
			);
			return (
				`STOP — upstream moved by another run line (N8-B). A different run/worktree published a newer ` +
				`revision of an artifact this run depends on:\n${lines.join("\n")}\n` +
				`Re-read / rebase / re-confirm before continuing, and continue a parallel line in a separate ` +
				`worktree: ${hint}`
			);
		}
	}
}

/** The run's bound pair: the state stamp wins, the binding record is the fallback. */
interface RunBindingPair {
	worktree: string | null;
	branch: string | null;
}

export function boundPairOf(cwd: string, state: RunState): RunBindingPair {
	const binding = readRunBinding(cwd, state.runId);
	return {
		worktree: state.runWorktree ?? binding?.worktree ?? null,
		branch: state.runBranch ?? binding?.branch ?? null,
	};
}

/** True when the run has no stamp yet and could take one here. */
export function shouldLazilyStamp(state: RunState): boolean {
	return state.runId !== "" && (!state.runWorktree || !state.runBranch);
}

/**
 * Per-command worktree/branch verification (N6). The command's cwd worktree and
 * branch must match the run's stamped pair; a mismatch is blocked with the fix.
 * Fail-open: no run, no stamp, a non-git folder or an unreadable binding → ok.
 * @param {RunState} state - Current run state.
 * @param {string} cwd - Folder the command runs in.
 * @returns {WorktreeVerdict} ok (with notes) or the block reason.
 */
export function verifyRunWorktree(state: RunState, cwd: string): WorktreeVerdict {
	if (!state.runId) return { ok: true, notes: [] };
	const info = detectWorktree(cwd);
	if (!info.isGit) {
		return { ok: true, notes: ["not a git worktree — worktree enforcement skipped (N5/N6)"] };
	}
	const bound = boundPairOf(cwd, state);
	if (!bound.worktree && !bound.branch) {
		return { ok: true, notes: [`run ${state.runId} has no worktree stamp yet (N6 — will stamp on this command)`] };
	}

	const notes: string[] = [];
	if (info.behind > 0) {
		notes.push(
			`branch is ${info.behind} commit(s) behind ${info.upstream ?? "upstream"} — run git fetch / git pull, then re-run (N14: local view only)`,
		);
	}

	if (bound.worktree && info.worktree !== "" && !samePaths(info.worktree, bound.worktree)) {
		return {
			ok: false,
			kind: "worktree-mismatch",
			reason: worktreeBlockMessage("worktree-mismatch", {
				runId: state.runId,
				worktree: bound.worktree,
				branch: bound.branch,
				currentWorktree: info.worktree,
				currentBranch: info.branch,
			}),
		};
	}

	if (bound.branch && info.branch !== bound.branch) {
		const otherWorktree = branchCheckedOutAt(info, bound.branch);
		if (otherWorktree) {
			return {
				ok: false,
				kind: "branch-moved",
				reason: worktreeBlockMessage("branch-moved", {
					runId: state.runId,
					branch: bound.branch,
					otherWorktree,
					currentWorktree: info.worktree,
					currentBranch: info.branch,
				}),
			};
		}
		return {
			ok: false,
			kind: "branch-mismatch",
			reason: worktreeBlockMessage("branch-mismatch", {
				runId: state.runId,
				branch: bound.branch,
				currentWorktree: info.worktree,
				currentBranch: info.branch,
			}),
		};
	}

	return { ok: true, notes };
}

/**
 * Run-start line check (N5): refuse to start a run line in a working folder when
 * ANOTHER live binding already claims this folder (a displaced line — e.g. a
 * hand-copied `.pi/velpari` state, or a line whose state was replaced).
 *
 * Scope note (recorded honestly, 2026-09-27): with a per-folder `state.json`,
 * one folder always describes exactly one line — so the DEVELOPER's "I want a
 * second line in this folder" case is caught by the N6 worktree/branch check
 * (`verifyRunWorktree`: you are not in your run's worktree/you carried state
 * into another folder), and this N5 check covers the leftover-claimant case.
 * Both messages print the same `git worktree add` fix, so the developer always
 * learns the way to run a genuinely parallel line.
 *
 * @param {RunState} state - Current run state.
 * @param {string} cwd - Folder the run is starting in.
 * @param {{ incomingRunId?: string }} [opts] - Id of the line being started (defaults to `state.runId`).
 * @returns {WorktreeVerdict} ok, or the foreign-line block.
 */
export function verifyRunStartLine(state: RunState, cwd: string, opts?: { incomingRunId?: string }): WorktreeVerdict {
	const info = detectWorktree(cwd, { skipWorktrees: true, skipUpstream: true });
	if (!info.isGit) return { ok: true, notes: [] };
	const incoming = opts?.incomingRunId ?? state.runId;
	const lines = foreignLinesInWorktree(cwd, incoming, { worktree: info.worktree });
	if (lines.length === 0) return { ok: true, notes: [] };
	const other = lines[0]!;
	return {
		ok: false,
		kind: "foreign-line",
		reason: worktreeBlockMessage("foreign-line", {
			runId: incoming || other.runId,
			otherRunId: other.runId,
			currentWorktree: info.worktree,
			currentBranch: info.branch,
		}),
	};
}

/**
 * Upstream-moved check (N8-B): a foreign run published a newer revision of an
 * artifact this run consumed → STOP, notify (artifact/revision/run/commit),
 * force a separate worktree. Pass an already-built report when the caller needs
 * it anyway (the stage/publish gates do — one probe, one report).
 * @param {RunState} state - Current run state.
 * @param {string} cwd - Project root.
 * @param {{ report?: ChangeReport; kinds?: readonly string[] }} [opts] - Prebuilt report / kind filter.
 * @returns {WorktreeVerdict} ok, or the upstream-moved block.
 */
export function verifyUpstreamMoves(
	state: RunState,
	cwd: string,
	opts?: { report?: ChangeReport; kinds?: readonly string[] },
): WorktreeVerdict {
	if (!state.runId) return { ok: true, notes: [] };
	let report = opts?.report ?? null;
	if (!report) {
		try {
			report = buildChangeReport(cwd, state, { kinds: opts?.kinds });
		} catch {
			return { ok: true, notes: ["upstream check skipped (report unavailable)"] };
		}
	}
	const foreign = report.entries.filter((entry) => entry.classification === "foreign-run");
	if (foreign.length === 0) return { ok: true, notes: [] };
	return {
		ok: false,
		kind: "upstream-moved",
		reason: worktreeBlockMessage("upstream-moved", {
			runId: state.runId,
			currentWorktree: report.worktree.current,
			currentBranch: report.worktree.currentBranch,
			moves: foreign
				.filter((entry) => entry.move !== null)
				.map((entry) => ({
					kind: entry.move!.kind,
					runId: entry.move!.publishedHead.runId,
					revisionNumber: entry.move!.publishedHead.revisionNumber,
					commit: entry.move!.storeLastCommit,
					myRevisionNumber: entry.move!.myRevisionNumber,
				})),
		}),
	};
}
