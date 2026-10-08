/**
 * `bookkeeping-advance` remediate (Phase C, N23 — Subphase 3.3).
 *
 * Auto-safe bookkeeping: closes a detected lost stage-flag advance via
 * `ops/self-heal.ts` — evidence-gated, `advanceStage()` only (the normal
 * audited path writes the history line). Never publishes, never touches
 * content; if the stage moved since detection, the advance no-ops safely.
 *
 * `changedFiles` reports `state.json` — the only file this writes.
 */

import { join } from "node:path";
import { applyBookkeepingAdvance, detectBookkeepingDrift } from "../../../ops/self-heal.js";
import type { RemediateFn } from "./index.js";

export const fingerprint = "bookkeeping-advance" as const;

export const remediate: RemediateFn = async (ctx): Promise<{ changedFiles: string[] }> => {
	const drifts = detectBookkeepingDrift(ctx.cwd);
	if (drifts.length === 0) return { changedFiles: [] };
	const changed = new Set<string>();
	for (const drift of drifts) {
		const result = applyBookkeepingAdvance(ctx.cwd, drift);
		if (result.ok) changed.add(join(ctx.cwd, ".pi", "velpari", "state.json"));
	}
	return { changedFiles: [...changed] };
};
