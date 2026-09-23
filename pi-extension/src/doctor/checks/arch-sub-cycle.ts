/**
 * Doctor check — Architecture sub-life cycle (Phase 2, plan §Phase 2).
 *
 * Validates that the design stage's sub-life cycle prelude completed:
 *   - contextLoaded: true
 *   - developerConfirmed: true
 *
 * Wired into /velpari-doctor output via doctor/index.ts AND into
 * the publish gate via doctor/gate.ts:runPublishGate.
 *
 * The gate check returns a single error string when developerConfirmed is
 * false; the audit (this file) returns a full DiagnosticSection.
 */

import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import type { RunState } from "../../core/state.js";

interface ArchSubCycleGateError {
	code: string;
	message: string;
}

/**
 * Strict gate check — returns 0 or 1 error. Used by the publish gate.
 * Empty result means publish is allowed.
 */
export function gateArchSubCycle(state: RunState | null): ArchSubCycleGateError[] {
	const errors: ArchSubCycleGateError[] = [];
	if (!state) return errors;

	const sub = state.archSubCycle;
	if (!sub) {
		errors.push({
			code: "arch-sub-cycle.missing",
			message:
				"Architecture sub-life cycle was never executed. Re-run /velpari-architecture-generator in interactive mode.",
		});
		return errors;
	}
	if (!sub.contextLoaded) {
		errors.push({
			code: "arch-sub-cycle.context-not-loaded",
			message: "Architecture sub-life cycle did not load the project context. Re-run /velpari-architecture-generator.",
		});
	}
	if (!sub.developerConfirmed) {
		errors.push({
			code: "arch-sub-cycle.developer-not-confirmed",
			message:
				"Developer did not confirm the architecture context. Re-run /velpari-architecture-generator and pick 'Proceed' on the confirm prompt.",
		});
	}
	return errors;
}

/**
 * Audit check — returns a DiagnosticSection for /velpari-doctor output.
 */
export function checkArchSubCycle(state: RunState | null): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const errors = gateArchSubCycle(state);

	if (errors.length === 0 && state?.archSubCycle) {
		items.push({
			status: "ok",
			message: `Architecture sub-life cycle complete (outcome: ${state.archSubCycle.confirmOutcome ?? "unknown"}, context loaded: ${state.archSubCycle.contextLoaded ?? false}, developer confirmed: ${state.archSubCycle.developerConfirmed ?? false}).`,
		});
	} else if (errors.length === 0) {
		items.push({
			status: "ok",
			message: "Architecture sub-life cycle has not run for this session (no design yet).",
		});
	} else {
		for (const e of errors) {
			items.push({ status: "error", message: e.message });
		}
	}

	return {
		title: "Architecture sub-life cycle (Phase 2)",
		items,
	};
}
