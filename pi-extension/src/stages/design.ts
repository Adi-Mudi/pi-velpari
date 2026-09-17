/**
 * /velpari-architecture-generator handler.
 *
 * Phase B: data-driven via STAGE_REGISTRY. See STAGE_REGISTRY["architecture-generator"].
 *
 * Phase 2 (plan §Phase 2) — sub-life cycle prelude:
 *   1. Load project context (PRD, RTM, feasibility, profiles)
 *   2. Confirm with developer before any write
 *   3. Persist archSubCycle state
 *   4. Hand off to the standard runStage flow (scouts → write → preview)
 *
 * Phase 4 (plan §Phase 4) — ADR capture:
 *   After runStage completes, the parent LLM spawns the conditional
 *   design-conflict-detector scout (skills/agents/design-conflict-detector.md),
 *   parses its report, and uses the helpers in this file to record
 *   decisions as ADRs. The doctor gate refuses to publish when the
 *   `## Architecture Decisions` section is missing or invalid.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage } from "./registry.js";
import { loadArchContext, type ArchContext } from "../core/arch-context.js";
import { confirmWithDeveloper } from "../core/arch-confirm.js";
import { loadState, saveState, type RunState } from "../core/state.js";
import {
	parseADRSection,
	renderADR,
	renderADRSection,
	supersedeADR,
	validateADR,
	type ADR,
} from "../core/adr.js";

export async function handleDesign(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<void> {
	const archCtx = await runSubCyclePrelude(ctx, cwd);
	if (!archCtx) return; // user chose "adjust" or "profile" — stop here
	await runStage("architecture-generator", ctx, pi, cwd);
}

/**
 * Step 2 + 3 of the sub-life cycle: load context, confirm with developer,
 * persist state. Returns the loaded ArchContext if the developer confirmed;
 * `null` otherwise (handler should stop and ask the developer to adjust).
 */
async function runSubCyclePrelude(
	ctx: ExtensionCommandContext,
	cwd: string,
): Promise<ArchContext | null> {
	const state = loadState(cwd);
	const runId = state?.runId ?? "no-run";
	const mission = state?.mission ?? "";
	const archCtx = loadArchContext(runId, mission, cwd);

	const result = await confirmWithDeveloper({ ui: ctx.ui }, archCtx);

	persistSubCycleState(cwd, state, {
		contextLoaded: true,
		confirmOutcome: result.outcome,
		summaryShown: result.summaryShown,
		developerConfirmed: result.confirmed,
	});

	if (!result.confirmed) {
		// Tell the user what to do next.
		const msg =
			result.outcome === "profile"
				? "Architecture paused. Run /velpari-configure-standards to pick a different overlay, then re-run /velpari-architecture-generator."
				: result.outcome === "no-ui"
					? "Architecture paused: no UI available. Re-run in interactive mode to confirm the context."
					: "Architecture paused. Edit the context (configs, profiles, or upstream artifacts) and re-run /velpari-architecture-generator.";
		ctx.ui.notify?.(msg, "info");
		return null;
	}

	return archCtx;
}

function persistSubCycleState(
	cwd: string,
	state: RunState | null,
	patch: Partial<NonNullable<RunState["archSubCycle"]>>,
): void {
	const current = state?.archSubCycle ?? {};
	const next: NonNullable<RunState["archSubCycle"]> = {
		...current,
		...patch,
		updatedAt: new Date().toISOString(),
	};
	saveState({ ...(state ?? ({} as RunState)), archSubCycle: next, updatedAt: new Date().toISOString() }, cwd);
}

// ─── ADR capture (Phase 4) ─────────────────────────────────────────────────
// The parent LLM runs these helpers AFTER the design-conflict-detector scout
// returns its report. The flow is:
//   1. parseConflictReport(reportPath) → ConflictRecord[]
//   2. surfaceConflictsViaUI(ctx, conflicts) → user's choice per conflict
//   3. buildADR(...) → ADR
//   4. appendADRToWorkingCopy(workingCopyPath, adr) → updates design doc
// Re-exports below let the parent LLM import them directly.

export {
	parseADRSection,
	renderADR,
	renderADRSection,
	supersedeADR,
	validateADR,
	type ADR,
};
