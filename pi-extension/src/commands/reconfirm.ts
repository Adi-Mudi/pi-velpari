/**
 * /velpari-reconfirm command (A5 — re-confirm path; L3).
 *
 * Picker over the actionable stale set (`input-changed` only — D2/D4),
 * one artifact at a time, showing what changed. On confirm it delegates
 * the write triple (Change Log line + manifest re-stamp + history entry)
 * to `ops/reconfirm.ts:reconfirmArtifact`. A cancelled picker or a
 * declined confirm writes nothing (D2).
 *
 * The picker lives here (L3) because L1 cannot import L2 UI — the doctor
 * fix-picker split is the precedent (D1).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadState } from "../core/state.js";
import type { StaleItem } from "../core/freshness.js";
import { computeReconfirmSet, reconfirmArtifact } from "../ops/reconfirm.js";
import { runSimpleConfirm, runSimplePicker } from "../ui/simple-picker.js";

function pickerItems(items: readonly StaleItem[]) {
	return items.map((item) => ({
		id: item.key,
		label: `${item.key} — ${item.path}`,
		hint: `changed: ${item.changedInputs.join(", ")}`,
	}));
}

export function registerReconfirmCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-reconfirm", {
		description:
			"Re-confirm a stale artifact whose changed inputs have no impact (A5): appends the mandated Change Log line and re-stamps freshness. input-changed items only; input-missing/no-stamp need republish.",
		handler: async (_args, ctx) => {
			const cwd = process.cwd();
			const { actionable, refused } = computeReconfirmSet(cwd);

			if (refused.length > 0) {
				ctx.ui.notify(
					`${refused.length} stale artifact(s) are NOT re-confirmable (republish only):\n` +
						refused.map((s) => `  - ${s.key} (${s.reason})`).join("\n"),
					"warning",
				);
			}
			if (actionable.length === 0) {
				ctx.ui.notify(
					refused.length > 0
						? "Nothing to re-confirm — the stale items above need a republish (stage command in update mode + the matching /velpari-<stage>-approve)."
						: "No stale artifacts — nothing to re-confirm.",
					"info",
				);
				return;
			}

			const state = loadState(cwd);
			const history = state.runId ? { runId: state.runId, stage: state.currentStage } : undefined;

			let remaining = actionable;
			while (remaining.length > 0) {
				const picked = await runSimplePicker(ctx, {
					title: "Re-confirm stale artifact",
					subtitle:
						"Pick one artifact whose changed inputs you have reviewed. " +
						"Confirming appends the Change Log line and re-stamps freshness — esc to stop.",
					items: pickerItems(remaining),
				});
				if (!picked) break; // cancelled — writes nothing (D2)
				const item = remaining.find((s) => s.key === picked);
				if (!item) break;

				const ok = await runSimpleConfirm(
					ctx,
					`Re-confirm ${item.key}?`,
					`Changed inputs: ${item.changedInputs.join(", ")}.\n` +
						`This records "reviewed — no changes required" in the artifact's Change Log. ` +
						`Only confirm when the change has NO impact on this artifact.`,
				);
				if (!ok) {
					// Declined — skip this artifact, keep the loop going.
					remaining = remaining.filter((s) => s.key !== item.key);
					continue;
				}

				const result = reconfirmArtifact(cwd, item, { history });
				ctx.ui.notify(
					`Re-confirmed ${result.key} — Change Log updated and freshness re-stamped ` +
						`(${result.changeLogLines.length} line(s), reconfirmedAt ${result.reconfirmedAt}).`,
					"info",
				);
				remaining = remaining.filter((s) => s.key !== item.key);
			}
		},
	});
}
