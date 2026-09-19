/**
 * Doctor fix dispatcher — Level A orchestrator (Phase 1, v1.4.x).
 *
 * The doctor runs, writes the report, and (when the `--velpari-fix`
 * flag is set) shows a picker of actionable items. Selecting one item
 * dispatches the parent LLM with a structured prompt containing the
 * section, status, message, and suggestion text. The parent LLM has
 * access to the full report via `.IDE_Plans/velpari/doctor-report.md`,
 * so it picks the right `/velpari-*` command without needing a
 * fingerprint lookup at dispatch time.
 *
 * Phase 2 (Level B — declarative auto-remediate) will extend this with
 * a `kind: "all-safe"` branch and a `RemediateFn` registry per
 * fingerprint. Phase 3 (Level C — agentic fix via parent LLM) will
 * extend `kind: "fix-one"` to use a structured `FixBrief` (see
 * `doctor/fix-brief.ts`) instead of the free-form prompt used here.
 *
 * Hard rule that survives every phase: the doctor NEVER edits
 * `Doc/` directly. Every fix routes through an existing velpari
 * slash command or `pi.sendUserMessage` handoff, so the `tool_call`
 * mutation lock in `hooks/tool-call.ts` continues to gate every write.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DiagnosticReport } from "./_types.js";
import type { FixLevel } from "./checks/fix-suggestions.js";
import { runAllSafeRemediates } from "./remediate.js";
import { writeDoctorReport } from "./report.js";
import { buildFixBrief, renderFixBrief } from "./fix-brief.js";

/**
 * One actionable item shown in the picker. Phase 1 deliberately keeps
 * the shape minimal — there is no `fingerprint` field on
 * `DiagnosticItem` yet, so the dispatcher routes via the suggestion
 * text. Phase 2 will add a `fingerprint?: string` to `DiagnosticItem`
 * and a `RemediateFn` registry keyed off it.
 */
export interface ActionableItem {
	/** 0-based ordinal across the entire report (for picker keys + notifies). */
	index: number;
	section: string;
	status: "error" | "warning";
	message: string;
	suggestion: string;
	/** Phase 1: always `"interactive"` (every fix asks). Phase 2/3
	 *  will populate from `levelFor()` based on `FIX_LEVELS`. */
	level: FixLevel;
}

/**
 * Discriminated union of picker outcomes. Tag for convenience:
 *   - `skip` / `open-report`: terminal actions, no command dispatch.
 *   - `fix-one`: the user picked one item to dispatch.
 *   - `all-safe`: Phase 2 placeholder; v1.4.x notifies "arrives in v1.5".
 */
export type FixChoice =
	| { kind: "fix-one"; item: ActionableItem }
	| { kind: "all-safe" }
	| { kind: "skip" }
	| { kind: "open-report" };

/**
 * Walk a `DiagnosticReport` and produce a flat list of actionable items
 * (`error` + `warning` items with a non-empty `suggestion`). Order is
 * preserved as sections appear in the report; errors and warnings are
 * not re-sorted — the picker's visual order matches the report's
 * action-items callout (top of file, prepended by the orchestrator).
 */
export function listActionableItems(report: DiagnosticReport): ActionableItem[] {
	const items: ActionableItem[] = [];
	let index = 0;
	for (const section of report.sections) {
		for (const item of section.items) {
			if (item.status !== "error" && item.status !== "warning") continue;
			if (!item.suggestion) continue;
			items.push({
				index,
				section: section.title,
				status: item.status,
				message: item.message,
				suggestion: item.suggestion,
				level: "interactive",
			});
			index++;
		}
	}
	return items;
}

/**
 * Convenience: number of actionable items in a report. The doctor's
 * picker skips itself when this is 0, so the user doesn't see an
 * empty menu after a clean audit.
 */
export function actionableItemCount(report: DiagnosticReport): number {
	return listActionableItems(report).length;
}

export interface DispatchFixChoiceOptions {
	ctx: ExtensionCommandContext;
	pi: ExtensionAPI;
	cwd: string;
	/**
	 * Configured project name (Phase 2 / Level B needs this to scope the
	 * safe remediates — e.g. re-stamp frontmatter on the right artifact).
	 * Empty string for projects that haven't run `/velpari-configure-inputs`
	 * yet — the remediates short-circuit on null in that case.
	 */
	projectName: string;
	choice: FixChoice;
	/** Absolute path to `.IDE_Plans/velpari/doctor-report.md`. */
	reportPath: string;
}

/**
 * Translate a picker choice into one of:
 *   - `pi.sendUserMessage` of a structured prompt (fix-one branch);
 *   - `runAllSafeRemediates` + re-audit (all-safe branch — Phase 2);
 *   - `ctx.ui.notify` reporting the report path (open-report branch);
 *   - a no-op (skip branch).
 *
 * Never throws. Every branch returns a `Promise<void>` so the caller
 * can `await` it cleanly from `handleDoctor`.
 */
export async function dispatchFixChoice(
	opts: DispatchFixChoiceOptions,
): Promise<void> {
	switch (opts.choice.kind) {
		case "skip":
			return;

		case "open-report":
			opts.ctx.ui.notify(
				`Doctor report at ${opts.reportPath}. Open it for full context.`,
				"info",
			);
			return;

		case "all-safe": {
			// Phase 2 (Level B). Run every RemediateFn in SAFE_WHITELIST
			// order. Each fn returns a result; we collect them, then
			// re-run runDoctor to confirm clean.
			opts.ctx.ui.notify(
				"Doctor fix: running all safe remediates (Phase 2 / Level B)...",
				"info",
			);
			const results = await runAllSafeRemediates({
				cwd: opts.cwd,
				projectName: opts.projectName,
			});
			for (const r of results) {
				opts.ctx.ui.notify(r.message, r.ok ? "info" : "warning");
			}
			// Re-audit. Importing runDoctor from `./index.js` would
			// create a circular import; re-import here at the call
			// site (tree-shakeable + ESM hoists correctly).
			const { runDoctor } = await import("./index.js");
			const freshReport = runDoctor(opts.cwd);
			writeDoctorReport(freshReport, opts.cwd);
			const summary = `After remediate: ${freshReport.summary.error} errors / ${freshReport.summary.warning} warnings${freshReport.ok ? " — clean." : " — see report for remaining items."}`;
			opts.ctx.ui.notify(summary, freshReport.ok ? "info" : "warning");
			return;
		}

		case "fix-one": {
			const it = opts.choice.item;

			// Phase 3 (Level C) — for "agentic" fingerprints, dispatch a
			// structured FixBrief instead of the Phase 1 free-form prompt.
			// buildFixBrief returns null for items whose level isn't
			// "agentic" (or whose suggestion text doesn't map to a known
			// fingerprint); the dispatcher falls through to the Phase 1
			// generic prompt in that case.
			const brief = buildFixBrief(it);
			if (brief) {
				const prompt = [
					`The doctor flagged an agentic fix to apply. Read the full report at \`${opts.reportPath}\` for context, then follow the brief below.`,
					``,
					renderFixBrief(brief),
				].join("\n");
				opts.pi.sendUserMessage(prompt, { expandPromptTemplates: true });
				opts.ctx.ui.notify(
					`Doctor agentic fix dispatched: ${brief.suggestedCommand} (item #${it.index}, fingerprint: ${brief.fingerprint}).`,
					"info",
				);
				return;
			}

			// Phase 1 fallback: free-form prompt. Used when buildFixBrief
			// returns null (interactive items, or items whose suggestion
			// didn't reverse-map to a known fingerprint).
			const prompt = [
				`The doctor flagged a fix to apply. Read the full report at \`${opts.reportPath}\`, then run the most appropriate /velpari-* command to address the item below. After running, /velpari-doctor to confirm clean.`,
				``,
				`Section: ${it.section}`,
				`Status: ${it.status}`,
				`Message: ${it.message}`,
				`Suggestion: ${it.suggestion}`,
				``,
				`If the suggestion names a /velpari-* command, run it. Otherwise pick the closest stage command that can produce the missing piece and call /velpari-doctor again to verify.`,
			].join("\n");
			opts.pi.sendUserMessage(prompt, { expandPromptTemplates: true });
			opts.ctx.ui.notify(
				`Doctor fix dispatched (item #${it.index}). Parent LLM will run the matching /velpari-* command and re-audit.`,
				"info",
			);
			return;
		}
	}
}
