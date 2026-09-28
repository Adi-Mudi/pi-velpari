import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PATHS } from "../core/constants.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { handleDoctor } from "../doctor/index.js";
import { dispatchFixChoice, listActionableItems } from "../doctor/fix-dispatch.js";
import { runFixFlow } from "../doctor/fix-flow.js";

/**
 * Real handler for /velpari-doctor.
 *
 * Runs the audit (L1: `doctor/index.ts:handleDoctor`), then — when the
 * user opts in via `--velpari-fix` — opens the Phase C chat fix flow
 * (L1: `doctor/fix-flow.ts:runFixFlow`, the AskUserQuestion-parity
 * Fix all / Show details / Abort select; user decision D-C2) which
 * dispatches manual items through the L1 orchestrator
 * `doctor/fix-dispatch.ts:dispatchFixChoice`.
 *
 * Why this orchestration lives here instead of in `handleDoctor`:
 * the layer rule forbids `doctor/` (L1) from importing `ui/` (L2).
 * L3 (this file) may import from both, so the picker flow is wired
 * here. See `.IDE_Plans/doctor-fix-upgrade_plan_20260919_1318_v1.0.md`
 * subphase 1.4. (`ui/fix-picker.ts` stays for its widget tests; the
 * `--velpari-fix` entry point now goes through `runFixFlow`.)
 */
export function registerDoctorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-doctor", {
		description:
			"Real handler for /velpari-doctor (Phase 7). Use --velpari-fix to open the batched chat fix flow (Phase C / N22).",
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

			// Phase C (N22/G7) — AskUserQuestion-parity batched flow replaces the
			// single-item picker as the --velpari-fix entry point (user decision
			// 2026-09-28). runFixFlow wraps listActionableItems + confirm-gated
			// runAllSafeRemediates + dispatchFixChoice (manual remainder) + one
			// fresh re-audit. `ui/fix-picker.ts` itself is untouched.
			const outcome = await runFixFlow({
				ui: {
					notify: (m, k) => ctx.ui.notify(m, k as "info" | "warning" | "error" | undefined),
					select: (t, l) => ctx.ui.select(t, l),
					confirm: (t, m) => ctx.ui.confirm(t, m ?? ""),
				},
				cwd,
				projectName,
				source: { kind: "doctor", report: result.report },
				reRun: async () => {
					const fresh = await handleDoctor(ctx as never, pi as never, cwd);
					return {
						ok: fresh.report?.ok ?? false,
						actionableCount: fresh.report ? listActionableItems(fresh.report).length : 0,
					};
				},
				dispatchOne: (item) =>
					dispatchFixChoice({ ctx, pi, cwd, projectName, choice: { kind: "fix-one", item }, reportPath }),
			});
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
		},
	});
}
