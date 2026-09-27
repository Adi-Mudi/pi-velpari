/**
 * Worktree-removal warning (Phase 6 — N14).
 *
 * Parallel lines run in per-run git worktrees (`state.runWorktree`,
 * stamped by `setRunWorktreeBranch`). Removing that worktree is a bash
 * action outside the tool hooks — it cannot be hard-blocked — so N14
 * rules that doctor/status WARN instead. This check names the run whose
 * bound path vanished.
 *
 * Two sources, both data-level (plan R5 — never imports Phase 5's
 * `core/run-binding.ts`, which may not be merged yet):
 *   1. the active run's `state.runWorktree` (Foundation field);
 *   2. sibling `<runDir>/run-binding.json` records (Phase 5 file
 *      format) with `status: "active"` — parsed defensively; a corrupt
 *      record is skipped silently.
 *
 * State is read only when `state.json` exists (buildStateSection
 * precedent) so a legacy pending migration is never triggered by a
 * read-only check (R3). Writes nothing, never throws (R2).
 *
 * L1 (doctor) → L0 (core/state, core/constants, core/paths) — legal.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../../core/constants.js";
import { loadState } from "../../core/state.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Run worktree (N14)";

/** One sibling binding record as read from disk (Phase 5 format). */
interface BindingRecord {
	runId?: string;
	branch?: string;
	worktree?: string;
	status?: string;
}

/** Read one run-binding.json defensively (null on any problem). */
function readBinding(path: string): BindingRecord | null {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as BindingRecord;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Build the "Run worktree (N14)" section: the active run's binding
 * first, then any sibling active binding whose worktree is gone.
 */
export function checkWorktreeRemovalSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		let reportedRunIds = new Set<string>();

		const statePath = join(cwd, PATHS.STATE_FILE);
		if (!existsSync(statePath)) {
			items.push({
				status: "info",
				message: "No active run — nothing bound to a worktree.",
			});
		} else {
			const state = loadState(cwd);
			if (!state.runId) {
				items.push({
					status: "info",
					message: "No active run — nothing bound to a worktree.",
				});
			} else if (!state.runWorktree) {
				items.push({
					status: "info",
					message: `Run ${state.runId} has no worktree binding (started before worktree stamping) — N14 check not applicable.`,
				});
			} else if (existsSync(state.runWorktree)) {
				items.push({
					status: "ok",
					message: `Run ${state.runId} bound to ${state.runWorktree} (exists${state.runBranch ? `, branch ${state.runBranch}` : ""}).`,
				});
			} else {
				items.push({
					status: "warning",
					message:
						`Run ${state.runId} is bound to ${state.runWorktree}, which no longer exists — ` +
						"the worktree was removed while the run was active (N14).",
					details: [state.runBranch ? `branch=${state.runBranch}` : "branch=(unstamped)", `state=${statePath}`],
					suggestion: suggestionFor("worktree-removal"),
				});
			}
			reportedRunIds = new Set(state.runId ? [state.runId] : []);
		}

		// Sibling scan: Phase 5 binding records for other runs.
		const runsDir = join(cwd, PATHS.RUNS_DIR);
		if (existsSync(runsDir)) {
			for (const entry of readdirSync(runsDir)) {
				const bindingPath = join(runsDir, entry, "run-binding.json");
				if (!existsSync(bindingPath)) continue;
				const binding = readBinding(bindingPath);
				if (!binding) continue;
				const runId = binding.runId ?? entry;
				if (binding.status !== "active") continue;
				if (reportedRunIds.has(runId)) continue;
				if (!binding.worktree) continue;
				if (existsSync(binding.worktree)) continue;
				reportedRunIds.add(runId);
				items.push({
					status: "warning",
					message:
						`Run ${runId} is bound to ${binding.worktree}, which no longer exists — ` +
						"the worktree was removed while the run was active (N14).",
					details: [binding.branch ? `branch=${binding.branch}` : "branch=(unstamped)", `binding=${bindingPath}`],
					suggestion: suggestionFor("worktree-removal"),
				});
			}
		}
	} catch (err) {
		items.push({
			status: "info",
			message: `Worktree check skipped: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
	return { title: SECTION_TITLE, items };
}
