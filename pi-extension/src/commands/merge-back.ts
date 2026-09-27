/**
 * /velpari-merge-back command (Phase 6, subphase 6.8.1 — D1; L3).
 *
 * The deliberate, discoverable confirmation surface for N12 guided
 * merge-back. Dry-run by default: renders the read-only plan
 * (`ops/merge-back.ts:planMergeBack`) and stops. `--execute` asks for
 * one confirmation (`runSimpleConfirm` — never automatic, G-4) and then
 * delegates the whole 5-step chain to `executeMergeBack`. All logic lives
 * in L1; this file is wiring + rendering only (thin-handler rule).
 *
 * Flow split (`runMergeBackFlow`) follows the `commands/export.ts` /
 * `commands/portfolio.ts` precedent so tests can inject cwd + a mock ctx.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	currentBranch,
	executeMergeBack,
	planMergeBack,
	type MergeBackPlan,
	type MergeBackStep,
} from "../ops/merge-back.js";
import { runSimpleConfirm } from "../ui/simple-picker.js";

/** Notify severity for one planned/executed step status. */
function severityFor(status: MergeBackStep["status"]): "error" | "warning" | "info" {
	if (status === "error") return "error";
	if (status === "warn") return "warning";
	return "info";
}

/** Render the read-only plan: header, overlap/conflicts, doctor, step table. */
function renderPlan(plan: MergeBackPlan): string {
	const lines: string[] = [];
	const head =
		`merge-back plan for ${plan.branch}` +
		(plan.branchSha ? ` @ ${plan.branchSha.slice(0, 7)}` : "") +
		(plan.mergeBase ? ` (merge-base ${plan.mergeBase.slice(0, 7)})` : "");
	lines.push(head);
	if (plan.alreadyMerged) lines.push("already merged — a re-run completes steps 2–5 only.");
	lines.push(
		`overlap: ${plan.overlap.length} file(s)` +
			(plan.storeOverlap.length > 0 ? ` — ${plan.storeOverlap.length} in Doc/store/ (runbook applies)` : ""),
	);
	lines.push(
		plan.conflicts.length > 0
			? `conflicts (${plan.conflicts.length}): ${plan.conflicts.slice(0, 10).join(", ")}${plan.conflicts.length > 10 ? ", …" : ""}`
			: "conflicts: clean",
	);
	if (!plan.conflictsKnown) {
		lines.push("conflict preview unavailable (git < 2.38?) — --execute discovers conflicts live.");
	}
	lines.push(
		`doctor: ${plan.doctorErrors} error(s), ${plan.doctorWarnings} warning(s) · stale consumers: ${plan.staleCount}`,
	);
	lines.push("planned steps:");
	for (const s of plan.steps) {
		lines.push(`  ${s.step}. [${s.status}] ${s.title} — ${s.message}`);
	}
	return lines.join("\n");
}

/** Render one executed step (details indented). */
function renderStep(s: MergeBackStep): string {
	const lines = [`step ${s.step} [${s.status}] ${s.title} — ${s.message}`];
	for (const d of s.details ?? []) lines.push(`    ${d}`);
	return lines.join("\n");
}

/**
 * The merge-back flow, split from the handler so tests inject cwd + a mock
 * ctx (commands/export.ts:runExportFlow precedent).
 * @param {ExtensionContext} ctx - Pi command context (ui.notify / ui.confirm).
 * @param {string} cwd - Project root.
 * @param {string | undefined} args - Raw command args (`<branch> [--execute]`).
 * @returns {Promise<void>} Notifies the outcome; never throws.
 */
export async function runMergeBackFlow(ctx: ExtensionContext, cwd: string, args: string | undefined): Promise<void> {
	// 1. Parse <branch> [--execute].
	const tokens = (args ?? "")
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0);
	const wantsExecute = tokens.includes("--execute");
	const branch = tokens.find((t) => t !== "--execute");
	if (!branch) {
		ctx.ui.notify(
			"usage: /velpari-merge-back <branch> [--execute]\n" +
				"Dry-run by default — prints the plan and stops. Add --execute to ask for confirmation before merging (N12: never automatic).",
			"warning",
		);
		return;
	}

	// 2. Read-only plan + rendering.
	const plan = planMergeBack(cwd, branch);
	ctx.ui.notify(renderPlan(plan), "info");

	// 3. Blocked plans stop here (reasons already rendered by the plan header).
	if (plan.blocked.length > 0) {
		ctx.ui.notify(`merge-back blocked — nothing was changed:\n  - ${plan.blocked.join("\n  - ")}`, "error");
		return;
	}

	// 4. Dry-run default (acceptance row 6's dry-run surface).
	if (!wantsExecute) {
		ctx.ui.notify("Dry-run only — re-run with `--execute` to perform the merge-back (N12: never automatic).", "info");
		return;
	}

	// 5. Confirm, then delegate the whole chain to L1.
	const current = currentBranch(cwd) ?? "HEAD";
	const preview = [
		`Merging ${branch} into ${current}. Planned steps:`,
		...plan.steps.map((s) => `  ${s.step}. [${s.status}] ${s.title} — ${s.message}`),
		plan.conflicts.length > 0
			? `NOTE: ${plan.conflicts.length} conflict(s) expected — the merge will stop for you to resolve (no auto-abort).`
			: "Store audit rows are appended per step and committed explicitly (`velpari(merge-back): <branch> — audit trail`).",
	].join("\n");
	const confirmed = await runSimpleConfirm(ctx, `Merge ${branch} back into ${current}?`, preview);
	if (!confirmed) {
		ctx.ui.notify("cancelled — nothing changed.", "warning");
		return;
	}

	const res = executeMergeBack(cwd, branch, { confirmed: true });
	for (const s of res.steps) {
		ctx.ui.notify(renderStep(s), severityFor(s.status));
	}

	const auditNote =
		res.auditEntries > 0
			? `${res.auditEntries} audit row(s) written${res.auditCommit ? `; audit commit ${res.auditCommit}` : ""}`
			: "no audit rows written";
	if (res.ok) {
		ctx.ui.notify(
			`merge-back complete — merged ${branch}${res.mergeCommit ? ` (${res.mergeCommit})` : ""}; ${auditNote}. ` +
				"Next: /velpari-status to review, or continue the sequence.",
			"info",
		);
	} else {
		const step1Failed = res.steps.find((s) => s.step === 1)?.status === "error";
		ctx.ui.notify(
			step1Failed
				? `merge-back did not complete — resolve the conflict (skills/db-store-merge-runbook.md for store files), ` +
						"then re-run `/velpari-merge-back " +
						branch +
						"` — the already-merged path finishes steps 2–5. Or `git merge --abort` to back out."
				: `merge-back finished with errors — see the step output above (${auditNote}). ` +
						"Store rebuild guidance: skills/db-store-merge-runbook.md.",
			"error",
		);
	}
	for (const w of res.commitWarnings) {
		ctx.ui.notify(`merge-back audit commit warning: ${w}`, "warning");
	}
}

/** Register /velpari-merge-back (Phase 6 — D1). */
export function registerMergeBackCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-merge-back", {
		description:
			"Guided merge-back of a parallel line (N12) — dry-run plan, then --execute: confirm → git merge → store verify → doctor → staleness → F14 flags.",
		handler: async (args, ctx) => {
			await runMergeBackFlow(ctx, process.cwd(), args);
		},
	});
}
