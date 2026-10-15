import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { PATHS } from "../core/constants.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { exitCodeFor, isCheckMode, isJsonMode } from "../doctor/check-mode.js";
import { handleDoctor } from "../doctor/index.js";
import { dispatchFixChoice, listActionableItems, type ActionableItem } from "../doctor/fix-dispatch.js";
import { runFixFlow, type FixFlowOutcome } from "../doctor/fix-flow.js";
import { runRepairSession, type RepairSessionOutcome } from "../doctor/repair-session.js";
import { JSON_REPORT_PATH, writeDoctorJson } from "../doctor/report-schema.js";

/**
 * Shared outcome reporter — both the gated session (`--velpari-fix`) and
 * the legacy auto batch (`--velpari-auto-fix`) map to the same notify
 * messages (DGR P0, subphase P0.2).
 */
function notifyFixOutcome(
	ctx: ExtensionCommandContext,
	outcome: FixFlowOutcome | RepairSessionOutcome,
	reportPath: string,
): void {
	switch (outcome.action) {
		case "aborted":
			ctx.ui.notify(`Doctor fix stopped: ${outcome.reason}`, "warning");
			break;
		case "no-actionables":
			ctx.ui.notify("Doctor fix: no actionable items — your report is clean. Nothing to fix.", "info");
			break;
		case "fixed":
			if (outcome.remainingManual > 0) {
				ctx.ui.notify(
					`Doctor fix: ${outcome.remainingManual} item(s) still need a manual command — see ${reportPath}.`,
					"warning",
				);
			} else {
				ctx.ui.notify("Doctor fix: batch applied — re-audit clean.", "info");
			}
			break;
	}
}

/**
 * Real handler for /velpari-doctor.
 *
 * Runs the audit (L1: `doctor/index.ts:handleDoctor`), then — when the
 * user opts in via `--velpari-fix` — opens the DGR gated repair flow
 * (L1: `doctor/repair-session.ts:runRepairSession`, the
 * Analyze → Report → GATE A → Plan → GATE B → Apply → Verify stage
 * machine). The legacy one-confirm chat flow (L1:
 * `doctor/fix-flow.ts:runFixFlow`, the AskUserQuestion-parity
 * Fix all / Show details / Abort select; user decision D-C2) is
 * preserved as the explicit `--velpari-auto-fix` path. Both dispatch
 * manual items through the L1 orchestrator
 * `doctor/fix-dispatch.ts:dispatchFixChoice`.
 *
 * Why this orchestration lives here instead of in `handleDoctor`:
 * the layer rule forbids `doctor/` (L1) from importing `ui/` (L2).
 * L3 (this file) may import from both, so the picker flow is wired
 * here. See `.IDE_Plans/doctor-fix-upgrade_plan_20260919_1318_v1.0.md`
 * subphase 1.4. (`ui/fix-picker.ts` stays for its widget tests.)
 */
export function registerDoctorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-doctor", {
		description:
			"Real handler for /velpari-doctor (Phase 7). Use --velpari-fix to open the gated repair flow, or --velpari-auto-fix for the one-confirm batch.",
		handler: async (_args, ctx) => {
			const cwd = process.cwd();
			const result = await handleDoctor(ctx as never, pi as never, cwd);

			// --velpari-skip-doctor short-circuited; no report to act on.
			if (result.skipped || !result.report) return;

			// Doctor upgrade P1 / T1: --velpari-json writes the versioned
			// machine-readable report beside the markdown report.
			const jsonMode = isJsonMode(pi);
			if (jsonMode) {
				writeDoctorJson(result.report, cwd);
				ctx.ui.notify(`Machine-readable report written to ${join(cwd, JSON_REPORT_PATH)}.`, "info");
			}

			// Doctor upgrade P1 / T2: --velpari-check is the non-interactive
			// pass/fail path. Report the verdict and set the process exit code
			// so CI / preflight can gate on it. No picker follows.
			const checkMode = isCheckMode(pi);
			if (checkMode) {
				const code = exitCodeFor(result.report);
				ctx.ui.notify(
					code === 0 ? "Doctor: PASS" : `Doctor: FAIL (${result.report.summary.error} errors)`,
					code === 0 ? "info" : "error",
				);
				process.exitCode = code;
			}

			// --velpari-fix opens the gated repair flow (DGR P0, subphase
			// P0.2); the legacy one-confirm batch moved to
			// --velpari-auto-fix. Both default off, and both are suppressed
			// in the non-interactive check/json modes.
			const wantFix = pi.getFlag?.("velpari-fix") === true;
			const wantAutoFix = pi.getFlag?.("velpari-auto-fix") === true;
			if ((!wantFix && !wantAutoFix) || checkMode || jsonMode) return;

			const items = listActionableItems(result.report);
			if (items.length === 0) {
				ctx.ui.notify("Doctor fix: no actionable items — your report is clean. Nothing to fix.", "info");
				return;
			}

			const reportPath = join(cwd, PATHS.DOCTOR_REPORT);

			// Resolve the projectName for Phase 2 (Level B safe
			// remediates) and any future levels. Missing / invalid →
			// empty string; remediates short-circuit cleanly.
			let projectName = "";
			try {
				const cfg = loadFilesConfig(cwd);
				if (validateFilesConfig(cfg)) projectName = cfg.projectName;
			} catch {
				// ignore — handled by remediate fns returning unchanged
			}

			// Phase C (N22/G7) — the AskUserQuestion-parity batched flow is
			// preserved as the explicit --velpari-auto-fix path. --velpari-fix
			// now opens the DGR gated repair session (Analyze → Report →
			// GATE A → Plan → GATE B → Apply → Verify); nothing is written
			// before GATE B. `ui/fix-picker.ts` itself is untouched.
			const ui = {
				notify: (m: string, k?: string) => ctx.ui.notify(m, k as "info" | "warning" | "error" | undefined),
				select: (t: string, l: string[]) => ctx.ui.select(t, l),
				confirm: (t: string, m?: string) => ctx.ui.confirm(t, m ?? ""),
			};
			/**
			 * Re-audit the project after the batch and reduce the fresh report to
			 * the shape the repair flows need (ok verdict + actionable count).
			 * @returns {Promise<{ ok: boolean; actionableCount: number }>} The fresh verdict and open-item count.
			 */
			const reRun = async () => {
				const fresh = await handleDoctor(ctx as never, pi as never, cwd);
				return {
					ok: fresh.report?.ok ?? false,
					actionableCount: fresh.report ? listActionableItems(fresh.report).length : 0,
				};
			};
			/**
			 * Dispatch one manual actionable item to the parent LLM via the L1
			 * fix dispatcher (`fix-dispatch.ts:dispatchFixChoice`).
			 * @param {ActionableItem} item - The manual item to hand off.
			 * @returns {Promise<void>} Resolves once the dispatch/notify path completes.
			 */
			const dispatchOne = (item: ActionableItem) =>
				dispatchFixChoice({ ctx, pi, cwd, projectName, choice: { kind: "fix-one", item }, reportPath });

			const outcome = wantAutoFix
				? await runFixFlow({
						ui,
						cwd,
						projectName,
						source: { kind: "doctor", report: result.report },
						reRun,
						dispatchOne,
					})
				: await runRepairSession({
						ui,
						cwd,
						projectName,
						source: { kind: "doctor", report: result.report },
						reRun,
						dispatchOne,
					});
			notifyFixOutcome(ctx, outcome, reportPath);
		},
	});
}
