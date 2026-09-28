/**
 * Worktree-removal warning (Phase 6 — N14).
 *
 * Parallel lines run in per-run git worktrees (`state.runWorktree`,
 * stamped by `setRunWorktreeBranch`). Removing that worktree is a bash
 * action outside the tool hooks — it cannot be hard-blocked — so N14
 * rules that doctor/status WARN instead. This check names the run whose
 * bound path vanished.
 *
 * Two sources:
 *   1. the active run's `state.runWorktree` (Foundation field);
 *   2. sibling run-binding records through Phase 5's L0
 *      `core/run-binding.ts:listRunBindings` (Phase I plan subphase
 *      I3.1 import swap — the R5 soft-dependency rule that forced a
 *      data-level read no longer applies); a corrupt record is
 *      skipped silently by the reader.
 *
 * State is read only when `state.json` exists (buildStateSection
 * precedent) so a legacy pending migration is never triggered by a
 * read-only check (R3). Writes nothing, never throws (R2).
 *
 * L1 (doctor) → L0 (core/state, core/constants, core/paths,
 * core/run-binding) — legal.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../../core/constants.js";
import { bindingPath, listRunBindings } from "../../core/run-binding.js";
import { loadState } from "../../core/state.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Run worktree (N14)";

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
			// Phase C render hardening: corrupt state.json → no binding to
			// compare (the Run state section carries the UNREADABLE error).
			let state: ReturnType<typeof loadState>;
			try {
				state = loadState(cwd);
			} catch {
				items.push({
					status: "info",
					message: "Run state unreadable — worktree-removal check skipped (see the Run state section).",
				});
				return { title: "Worktree removal (N14)", items };
			}
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

		// Sibling scan: Phase 5 binding records for other runs (L0 reader).
		for (const binding of listRunBindings(cwd)) {
			if (binding.status !== "active") continue;
			if (reportedRunIds.has(binding.runId)) continue;
			if (!binding.worktree) continue;
			if (existsSync(binding.worktree)) continue;
			reportedRunIds.add(binding.runId);
			items.push({
				status: "warning",
				message:
					`Run ${binding.runId} is bound to ${binding.worktree}, which no longer exists — ` +
					"the worktree was removed while the run was active (N14).",
				details: [
					binding.branch ? `branch=${binding.branch}` : "branch=(unstamped)",
					`binding=${bindingPath(cwd, binding.runId)}`,
				],
				suggestion: suggestionFor("worktree-removal"),
			});
		}
	} catch (err) {
		items.push({
			status: "info",
			message: `Worktree check skipped: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
	return { title: SECTION_TITLE, items };
}
