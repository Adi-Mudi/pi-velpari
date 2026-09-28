/**
 * Worktree-binding check — Phase C (G6), N17/N18.
 *
 * The doctor-side view of the session gate. ONE decision matrix: this
 * section and the Phase 4 preflight step (b) both consume
 * `core/plan-binding.ts:sessionGateVerdict` — no duplicated logic.
 *
 *   - not a git folder       → `info` (R4 fail-open, checks skipped);
 *   - no declarations        → `info` (run binding + plan directive +
 *     `state.runWorktree` all absent);
 *   - pass + match           → `ok` + the gate's status line;
 *   - mismatch (a declaration ≠ actual) → **`error`** + N18 hard-stop
 *     reason (correct-path message) + `binding-mismatch` fix hint;
 *   - conflict (two active declarations, different worktrees) →
 *     **`error`** + the stop-and-ask reason + `binding-conflict` fix hint.
 *
 * Detail rows show actual `worktree @ branch` against each declared
 * source. Whole function try/catch-wrapped; read-only (the cached
 * verdict never re-probes — G2).
 */

import { loadState } from "../../core/state.js";
import {
	activeRunBinding,
	findActivePlanDirective,
	sessionGateVerdict,
	type DeclaredBinding,
} from "../../core/plan-binding.js";
import { detectWorktree } from "../../core/worktree.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Worktree binding (N17)";

/** Render one declaration as a detail line. */
function declarationDetail(decl: DeclaredBinding): string {
	return `${decl.source}: ${decl.worktree || "(worktree undeclared)"}${decl.branch ? ` @ ${decl.branch}` : ""} (${decl.origin})`;
}

/**
 * Build the "Worktree binding" section (read-only, cached verdict).
 * @param {string} cwd - Project root (session folder).
 * @returns {DiagnosticSection} One section; failures to resolve are `info`/`warning`, real drift is `error`.
 */
export function checkBindingMatchSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		const probe = detectWorktree(cwd, { skipWorktrees: true, skipUpstream: true });
		if (!probe.isGit) {
			items.push({
				status: "info",
				message: "not a git folder — binding checks skipped (R4 fail-open).",
			});
			return { title: SECTION_TITLE, items };
		}

		const runBinding = activeRunBinding(cwd);
		const planDirective = findActivePlanDirective(cwd);
		const state = loadState(cwd);
		const stateWorktree = state.runWorktree ?? "";
		if (runBinding === null && planDirective === null && stateWorktree === "") {
			items.push({
				status: "info",
				message: "no declared binding — nothing to match against this session.",
			});
			return { title: SECTION_TITLE, items };
		}

		const verdict = sessionGateVerdict(cwd);
		switch (verdict.kind) {
			case "pass": {
				if (verdict.why === "match" && verdict.statusLine) {
					items.push({ status: "ok", message: verdict.statusLine });
				} else if (verdict.why === "not-git") {
					// Probe said isGit — cached verdict can only disagree in a
					// race; render as info, never block (fail-open).
					items.push({ status: "info", message: "not a git folder — binding checks skipped (R4 fail-open)." });
				} else if (runBinding === null && planDirective === null) {
					// Only state.runWorktree declares anything.
					items.push({
						status: "info",
						message: `state.runWorktree declares ${stateWorktree} — no active binding file or plan directive to verify it against.`,
					});
				} else {
					items.push({ status: "ok", message: "Declarations resolve to a passing session gate." });
				}
				break;
			}
			case "mismatch": {
				items.push({
					status: "error",
					message: `binding-mismatch: ${verdict.reason}`,
					details: [
						`actual:   ${verdict.actualWorktree} @ ${verdict.actualBranch}`,
						`declared: ${declarationDetail(verdict.declared)}`,
					],
					suggestion: suggestionFor("binding-mismatch"),
				});
				break;
			}
			case "conflict": {
				items.push({
					status: "error",
					message: `binding-conflict: ${verdict.reason}`,
					details: [declarationDetail(verdict.runBinding), declarationDetail(verdict.planDirective)],
					suggestion: suggestionFor("binding-conflict"),
				});
				break;
			}
		}

		// Detail rows: actual vs each declared source (informational).
		items.push({
			status: "info",
			message: `actual: ${probe.worktree} @ ${probe.branch}${probe.detached ? " (detached HEAD)" : ""}`,
		});
		for (const decl of [runBinding, planDirective]) {
			if (decl) items.push({ status: "info", message: declarationDetail(decl) });
		}
		if (stateWorktree !== "") {
			items.push({ status: "info", message: `state.runWorktree: ${stateWorktree}` });
		}
	} catch (err) {
		items.push({
			status: "warning",
			message: `binding check skipped (${(err as Error)?.message ?? String(err)})`,
		});
	}
	return { title: SECTION_TITLE, items };
}
