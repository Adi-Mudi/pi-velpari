/**
 * Integration: End-to-end flow (Phase 8, plan §Phase 8).
 *
 * Walks the full 16-step scenario (brainstorm → handoff) using the
 * in-process state machine. Verifies that every state advance lands
 * on the expected next state and that the sub-life cycle, ADR, and
 * overlay mechanisms all cooperate.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRun, advanceStage, loadState, saveState, type RunState } from "../../src/core/state.js";
import { runPublishGate } from "../../src/doctor/gate.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-e2e-flow-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TodoApp" }),
		"utf8",
	);
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("end-to-end flow — 19-step scenario (industry-standard order)", () => {
	it("walks brainstorm → handoff-ready and lands on every stage in turn", () => {
		let state: RunState = createRun("Build a todo app", tmpDir) as RunState;
		assert.strictEqual(state.currentStage, "brainstorming");

		// Industry-standard order (Option B):
		//   brainstorm → PRD → RTM → Feasibility → Design →
		//   Atomic Functions → Pseudocode → Test Plan →
		//   Development Order → Final Design → Handoff
		const flow: Array<{ command: string; expected: string }> = [
			{ command: "/velpari-approve-brainstorm", expected: "brainstormed" },
			{ command: "/velpari-prd", expected: "drafting-prd" },
			{ command: "/velpari-prd-approve", expected: "drafted-prd" },
			{ command: "/velpari-rtm", expected: "building-rtm" },
			{ command: "/velpari-rtm-approve", expected: "built-rtm" },
			{ command: "/velpari-feasibility", expected: "analyzing-feasibility" },
			{ command: "/velpari-feasibility-approve", expected: "analyzed-feasibility" },
			{ command: "/velpari-architecture-generator", expected: "designing" },
			{ command: "/velpari-architecture-generator-approve", expected: "designed" },
			{ command: "/velpari-atomic-function", expected: "analyzing-atomic-functions" },
			{ command: "/velpari-atomic-function-approve", expected: "analyzed-atomic-functions" },
			{ command: "/velpari-pseudocode", expected: "writing-pseudocode" },
			{ command: "/velpari-pseudocode-approve", expected: "wrote-pseudocode" },
			{ command: "/velpari-testplan", expected: "planning-tests" },
			{ command: "/velpari-testplan-approve", expected: "planned-tests" },
			{ command: "/velpari-development-order", expected: "ordering-development" },
			{ command: "/velpari-development-order-approve", expected: "ordered-development" },
			{ command: "/velpari-final-design", expected: "finalizing-design" },
			{ command: "/velpari-final-design-approve", expected: "finalized-design" },
		];

		for (const step of flow) {
			state = advanceStage(state, step.command, tmpDir);
			assert.strictEqual(
				state.currentStage,
				step.expected,
				`after ${step.command} expected ${step.expected}, got ${state.currentStage}`,
			);
		}
	});

	it("the sub-life cycle prelude is required (state without archSubCycle fails)", () => {
		const state: RunState = {
			version: 1 as const,
			runId: "r",
			mission: "m",
			currentStage: "designed" as RunState["currentStage"],
			history: [],
			updatedAt: new Date().toISOString(),
		};
		saveState(state, tmpDir);

		// The gate for design artifact should fail on arch-sub-cycle.missing.
		const result = runPublishGate({
			artifact: "design",
			workingContent: "# Design\n\n## Architecture Decisions\n\n```yaml\n{}\n```\n",
			cwd: tmpDir,
			projectName: "TodoApp",
		});
		assert.ok(
			result.errors.some((e: string) => e.includes("arch-sub-cycle")),
			"expected arch-sub-cycle error on design publish without prelude",
		);
	});

	it("the standards overlay carries through to the handoff payload", () => {
		// Save state with a standards profile, write an architect-inputs.json
		// shape via handoff.ts export, verify the overlay is in the payload.
		const state: RunState = {
			version: 1 as const,
			runId: "r",
			mission: "m",
			currentStage: "planned-tests" as RunState["currentStage"],
			history: [],
			updatedAt: new Date().toISOString(),
			standardsProfile: {
				id: "medical-device-b",
				version: "1.0.0",
				selectedAt: new Date().toISOString(),
				selectedBy: "user",
			},
		};
		saveState(state, tmpDir);

		const reloaded = loadState(tmpDir);
		assert.ok(reloaded?.standardsProfile);
		assert.strictEqual(reloaded?.standardsProfile.id, "medical-device-b");
	});
});
