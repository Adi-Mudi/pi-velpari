import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PATHS } from "../core/constants.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { handleDoctor } from "../doctor/index.js";
import { dispatchFixChoice, listActionableItems } from "../doctor/fix-dispatch.js";
import { runFixPicker } from "../ui/fix-picker.js";

/**
 * Real handler for /velpari-doctor.
 *
 * Runs the audit (L1: `doctor/index.ts:handleDoctor`), then — when the
 * user opts in via `--velpari-fix` — shows a picker of actionable
 * items via the L2 widget `ui/fix-picker.ts:runFixPicker` and
 * dispatches the picked choice via the L1 orchestrator
 * `doctor/fix-dispatch.ts:dispatchFixChoice`.
 *
 * Why this orchestration lives here instead of in `handleDoctor`:
 * the layer rule forbids `doctor/` (L1) from importing `ui/` (L2).
 * L3 (this file) may import from both, so the picker flow is wired
 * here. See `.IDE_Plans/doctor-fix-upgrade_plan_20260919_1318_v1.0.md`
 * subphase 1.4.
 */
export function registerDoctorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-doctor", {
		description:
			"Real handler for /velpari-doctor (Phase 7). Use --velpari-fix to enable the interactive fix picker (Phase 8, Level A).",
		handler: async (_args, ctx) => {
			const cwd = process.cwd();
			const result = await handleDoctor(ctx as never, pi as never, cwd);

			// --velpari-skip-doctor short-circuited; no report to act on.
			if (result.skipped || !result.report) return;

			// --velpari-fix is the opt-in for the interactive picker.
			// Default off so existing behavior is unchanged.
			const wantFix = pi.getFlag?.("velpari-fix") === true;
			if (!wantFix) return;

			const items = listActionableItems(result.report);
			if (items.length === 0) {
				ctx.ui.notify(
					"Doctor fix: no actionable items — your report is clean. Nothing to fix.",
					"info",
				);
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

			const choice = await runFixPicker(ctx, {
				title: "Doctor fix",
				subtitle: `${items.length} actionable item(s). Pick one to dispatch, open the report, or skip.`,
				items,
				reportPath,
			});
			await dispatchFixChoice({
				ctx,
				pi,
				cwd,
				projectName,
				choice,
				reportPath,
			});
		},
	});
}
