/**
 * core/run-binding.ts — the per-run git binding record (Layer 0; Phase 5, N5).
 *
 * `state.json` is per-FOLDER, so it can only ever describe the run that folder
 * is currently driving: a second run line (or a folder that was copied/moved)
 * is invisible to it. To make "is another run line already using this working
 * folder?" answerable, every run also drops a tiny record inside its own run
 * folder: `.IDE_Plans/velpari/runs/<run-id>/run-binding.json`.
 *
 * A binding is LIVE when all three hold: `status === "active"`, it belongs to a
 * different run than the current one, and that run's `history.jsonl` has not
 * reached the terminal `handoff-ready` stage. An empty/missing history means the
 * run never really started (or `/velpari-reset` cleared it — `clearRun` deletes
 * `history.jsonl`), so it is treated as abandoned and never blocks anything.
 *
 * Fail-open everywhere (R4): no git repo → nothing is written; unreadable or
 * malformed records are skipped; a probe failure never blocks a run.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "../io/atomic-write.js";
import { PATHS } from "./constants.js";
import { loadHistory } from "./history.js";
import { buildRunDir } from "./paths.js";
import type { RunState } from "./state.js";
import { detectWorktree, realpathOrSelf, samePaths } from "./worktree.js";

/** File name inside the run folder. */
export const RUN_BINDING_FILE = "run-binding.json";

/** The stage that marks a run line finished (constants.ts STAGE_TRANSITIONS). */
const TERMINAL_STAGE = "handoff-ready";

/** Who closed a binding (audit-ish, rendered in messages/reports). */
export type RunBindingClosedBy = "handoff" | "reset";

/** One run's worktree + branch binding (N5/N6). */
export interface RunBinding {
	/** Owning run id. */
	runId: string;
	/** Branch the run was started on (mirrors `state.runBranch`). */
	branch: string;
	/** Absolute worktree path (realpath-normalized) the run started in. */
	worktree: string;
	/** ISO timestamp of the stamp. */
	startedAt: string;
	/** "active" until the run finishes (handoff) or is abandoned (reset). */
	status: "active" | "closed";
	/** ISO timestamp of the close. */
	closedAt?: string;
	/** What closed it. */
	closedBy?: RunBindingClosedBy;
}

/** Absolute path of one run's binding record. */
export function bindingPath(cwd: string, runId: string): string {
	return join(buildRunDir(runId, cwd), RUN_BINDING_FILE);
}

/** Narrow an unknown JSON value to a RunBinding (rejects partial records). */
function asBinding(value: unknown): RunBinding | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	const { runId, branch, worktree, startedAt, status } = record;
	if (typeof runId !== "string" || runId === "") return null;
	if (typeof branch !== "string" || typeof worktree !== "string" || worktree === "") return null;
	if (typeof startedAt !== "string") return null;
	if (status !== "active" && status !== "closed") return null;
	const binding: RunBinding = { runId, branch, worktree, startedAt, status };
	if (typeof record.closedAt === "string") binding.closedAt = record.closedAt;
	if (record.closedBy === "handoff" || record.closedBy === "reset") binding.closedBy = record.closedBy;
	return binding;
}

/**
 * Read one run's binding record. Missing/corrupt → null (tolerant read).
 * @param {string} cwd - Project root.
 * @param {string} runId - Run whose record to read.
 * @returns {RunBinding | null} The record, or null.
 */
export function readRunBinding(cwd: string, runId: string): RunBinding | null {
	if (!runId) return null;
	const file = bindingPath(cwd, runId);
	if (!existsSync(file)) return null;
	try {
		return asBinding(JSON.parse(readFileSync(file, "utf8")));
	} catch {
		return null;
	}
}

/**
 * Write (create or overwrite) one run's binding record, atomically.
 * @param {string} cwd - Project root.
 * @param {RunBinding} binding - Record to persist.
 * @returns {void}
 */
export function writeRunBinding(cwd: string, binding: RunBinding): void {
	atomicWriteJson(bindingPath(cwd, binding.runId), binding);
}

/** The run's directory exists on disk (evidence the run line is real). */
function runDirExists(cwd: string, runId: string): boolean {
	try {
		return statSync(buildRunDir(runId, cwd)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Stamp the run's binding if it does not exist yet (N5). Fail-open: outside a
 * git worktree nothing is written and `binding: null` is returned, so non-git
 * projects keep working exactly as before. An existing record is returned
 * untouched (a closed one stays closed — only reset/handoff close records).
 *
 * Callers use `created` to decide whether to notify, and the returned binding's
 * `branch`/`worktree` to call `setRunWorktreeBranch`.
 *
 * @param {string} cwd - Project root (the folder the run is being started in).
 * @param {RunState} state - Current run state (only `runId` is read).
 * @returns {{ binding: RunBinding | null; created: boolean }} Stamp outcome.
 */
export function ensureRunBinding(cwd: string, state: RunState): { binding: RunBinding | null; created: boolean } {
	if (!state.runId) return { binding: null, created: false };
	const existing = readRunBinding(cwd, state.runId);
	if (existing) return { binding: existing, created: false };

	const info = detectWorktree(cwd, { skipWorktrees: true, skipUpstream: true });
	if (!info.isGit || info.worktree === "") return { binding: null, created: false };

	const binding: RunBinding = {
		runId: state.runId,
		branch: info.branch,
		worktree: realpathOrSelf(info.worktree),
		startedAt: new Date().toISOString(),
		status: "active",
	};
	try {
		writeRunBinding(cwd, binding);
	} catch {
		return { binding: null, created: false };
	}
	return { binding, created: true };
}

/**
 * Close a run's binding — the run line is finished (handoff) or abandoned
 * (reset). Idempotent: a missing or already-closed record returns false, so
 * callers notify only on a real transition.
 * @param {string} cwd - Project root.
 * @param {string} runId - Run to close.
 * @param {RunBindingClosedBy} closedBy - Why it closed.
 * @returns {boolean} true when a record was actually closed.
 */
export function closeRunBinding(cwd: string, runId: string, closedBy: RunBindingClosedBy): boolean {
	const existing = readRunBinding(cwd, runId);
	if (!existing || existing.status === "closed") return false;
	try {
		writeRunBinding(cwd, { ...existing, status: "closed", closedAt: new Date().toISOString(), closedBy });
	} catch {
		return false;
	}
	return true;
}

/**
 * Every readable binding record in this folder's run list ([] when none).
 * Unrelated/loose files and malformed records are skipped (fail-open).
 * @param {string} cwd - Project root.
 * @returns {RunBinding[]} Records in directory order.
 */
export function listRunBindings(cwd: string): RunBinding[] {
	const runsDir = join(cwd, PATHS.RUNS_DIR);
	let entries: string[] = [];
	try {
		if (!existsSync(runsDir)) return [];
		entries = readdirSync(runsDir);
	} catch {
		return [];
	}
	const bindings: RunBinding[] = [];
	for (const entry of entries) {
		const dir = join(runsDir, entry);
		try {
			if (!statSync(dir).isDirectory()) continue;
		} catch {
			continue;
		}
		const binding = readRunBinding(cwd, entry);
		if (binding) bindings.push(binding);
	}
	return bindings;
}

/**
 * LIVE foreign run lines in the current working folder (N5): an active binding
 * for a DIFFERENT run whose worktree is this folder and whose history has not
 * reached `handoff-ready`. This is what makes "a second run line in the same
 * worktree" a hard block instead of a silent state.json overwrite.
 *
 * `opts.worktree` lets a caller that already probed git pass the resolved
 * toplevel in — avoiding a second probe on the per-turn/per-command paths.
 *
 * @param {string} cwd - Project root.
 * @param {string} currentRunId - The run currently driving this folder.
 * @param {{ worktree?: string }} [opts] - Pre-resolved toplevel path.
 * @returns {RunBinding[]} Live foreign bindings (empty ⇒ no conflict).
 */
export function foreignLinesInWorktree(cwd: string, currentRunId: string, opts?: { worktree?: string }): RunBinding[] {
	let worktree = opts?.worktree ?? "";
	if (worktree === "") {
		const info = detectWorktree(cwd, { skipWorktrees: true, skipUpstream: true });
		if (!info.isGit) return [];
		worktree = info.worktree;
	}
	if (worktree === "") return [];

	const lines: RunBinding[] = [];
	for (const binding of listRunBindings(cwd)) {
		if (binding.status !== "active") continue;
		if (binding.runId === currentRunId) continue;
		if (!samePaths(binding.worktree, worktree)) continue;
		if (!runDirExists(cwd, binding.runId)) continue;
		const history = loadHistory(cwd, binding.runId);
		const live = history.length > 0 && !history.some((entry) => entry.stage === TERMINAL_STAGE);
		if (live) lines.push(binding);
	}
	return lines;
}
