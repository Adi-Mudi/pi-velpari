/**
 * Integration: State machine integrity (Phase 8, plan §Phase 8).
 *
 * Walks every transition in STAGE_TRANSITIONS to confirm:
 *   - no state has zero inbound commands (orphans)
 *   - no state is unreachable (every state has at least one outbound edge)
 *   - the final-design stage still uses the Phase 1+2-renamed command
 *     "/velpari-final-design" (renamed 2026-09-14 from /velpari-html-design,
 *     which itself was renamed from /velpari-design per Phase 1)
 *
 * Sequence (industry-standard, Option B): every state in Stages 1–10 has
 * a next-stage outbound transition. handoff-ready is the only terminal.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { STAGE_TRANSITIONS, type Stage } from "../../src/core/constants.js";

describe("state machine integrity — Phase 8 re-verification", () => {
	it("every transition references a valid Stage", () => {
		const knownStages = new Set<Stage>([
			"none",
			"brainstorming",
			"brainstormed",
			"drafting-prd",
			"drafted-prd",
			"building-rtm",
			"built-rtm",
			"analyzing-feasibility",
			"analyzed-feasibility",
			"designing",
			"designed",
			"analyzing-atomic-functions",
			"analyzed-atomic-functions",
			"writing-pseudocode",
			"wrote-pseudocode",
			"planning-tests",
			"planned-tests",
			"ordering-development",
			"ordered-development",
			"finalizing-design",
			"finalized-design",
			"handoff-ready",
		]);
		for (const t of STAGE_TRANSITIONS) {
			assert.ok(knownStages.has(t.from as Stage), `unknown from-state: ${t.from}`);
			assert.ok(knownStages.has(t.to as Stage), `unknown to-state: ${t.to}`);
		}
	});

	it("every transition command starts with /velpari-", () => {
		for (const t of STAGE_TRANSITIONS) {
			assert.ok(
				t.command.startsWith("/velpari-"),
				`transition command "${t.command}" does not start with /velpari-`,
			);
		}
	});

	it("Phase 1 + 2 rename: final-design transition uses /velpari-final-design", () => {
		// In the industry-standard order, final-design runs AFTER development-order
		// (Stage 9 → Stage 10), not from planned-tests.
		const finalDesign = STAGE_TRANSITIONS.find(
			(t) => t.from === "ordered-development" && t.to === "finalizing-design",
		);
		assert.ok(finalDesign, "final-design transition must exist");
		assert.strictEqual(
			finalDesign?.command,
			"/velpari-final-design",
			"final-design transition command must be /velpari-final-design (renamed from /velpari-html-design on 2026-09-14, which itself was Phase 1 rename from /velpari-design)",
		);
	});

	it("industry-standard order: atomic-functions comes BEFORE pseudocode", () => {
		// Stage 6 (atomic-functions) must transition into pseudocode (Stage 7),
		// not be triggered AFTER test-plan as in the legacy optional ordering.
		const atomic = STAGE_TRANSITIONS.find(
			(t) => t.from === "designed" && t.to === "analyzing-atomic-functions",
		);
		assert.ok(atomic, "designed → analyzing-atomic-functions transition must exist");
		assert.strictEqual(atomic?.command, "/velpari-atomic-function");

		const pseudocode = STAGE_TRANSITIONS.find(
			(t) => t.from === "analyzed-atomic-functions" && t.to === "writing-pseudocode",
		);
		assert.ok(pseudocode, "analyzed-atomic-functions → writing-pseudocode transition must exist");
		assert.strictEqual(pseudocode?.command, "/velpari-pseudocode");
	});

	it("industry-standard order: planning-tests → ordering-development (no skip to handoff)", () => {
		// After test-plan is approved, the next required stage is development-order.
		// The legacy `planned-tests → handoff-ready` skip is removed.
		const skip = STAGE_TRANSITIONS.find(
			(t) => t.from === "planned-tests" && t.to === "handoff-ready",
		);
		assert.strictEqual(skip, undefined, "planned-tests must not skip to handoff (Stages 9 + 10 are required)");
	});

	it("no orphan state (every state has at least one inbound transition)", () => {
		// Collect every state that appears as a target.
		const targets = new Set(STAGE_TRANSITIONS.map((t) => t.to));
		// "none" is the initial state with no inbound transition (intentional).
		for (const t of STAGE_TRANSITIONS) {
			if (t.from === "none") continue;
			assert.ok(
				targets.has(t.from) || isInitial(t.from),
				`state "${t.from}" has no inbound transition AND is not initial — orphan`,
			);
		}
	});

	it("every non-terminal state has at least one outbound transition", () => {
		// Collect every state that appears as a source.
		const sources = new Set(STAGE_TRANSITIONS.map((t) => t.from));
		// handoff-ready is the only terminal state.
		const allStages: Stage[] = [
			"none",
			"brainstorming",
			"brainstormed",
			"drafting-prd",
			"drafted-prd",
			"building-rtm",
			"built-rtm",
			"analyzing-feasibility",
			"analyzed-feasibility",
			"designing",
			"designed",
			"analyzing-atomic-functions",
			"analyzed-atomic-functions",
			"writing-pseudocode",
			"wrote-pseudocode",
			"planning-tests",
			"planned-tests",
			"ordering-development",
			"ordered-development",
			"finalizing-design",
			"finalized-design",
			"handoff-ready",
		];
		for (const stage of allStages) {
			if (stage === "handoff-ready") continue;
			assert.ok(
				sources.has(stage),
				`state "${stage}" has no outbound transition — dead end (handoff-ready is the only terminal)`,
			);
		}
	});
});

function isInitial(stage: string): boolean {
	return stage === "none";
}
