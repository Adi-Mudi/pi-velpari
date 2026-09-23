/**
 * /velpari-final-design handler unit tests (Stage 10 — required post-development-order).
 *
 * Verifies the STAGE_REGISTRY entry for final-design matches the
 * industry-standard order (Option B):
 *   - stageEnum: "finalizing-design"
 *   - scouts: design-consistency/coverage/contract/finalizer
 *   - inputs: 6 prior artifacts (design, atomic-functions, pseudocode,
 *     test-plan, test-cases, development-order)
 *   - missing-input error message references Stage 10 + all prior stages
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { STAGE_REGISTRY } from "../../src/stages/registry.js";

describe("/velpari-final-design — Stage 10 registry", () => {
	const entry = STAGE_REGISTRY["final-design"];

	it("stageEnum is finalizing-design", () => {
		assert.equal(entry.stageEnum, "finalizing-design");
	});

	it("skillName is 'design' (the consolidation uses the design skill)", () => {
		assert.equal(entry.skillName, "design");
	});

	it("uses 4 scouts named design-{consistency,coverage,contract,finalizer}", () => {
		assert.deepEqual(
			[...entry.scouts],
			["design-consistency-checker", "design-coverage-checker", "design-contract-checker", "design-finalizer"],
		);
	});

	it("writes final-design.md into <runDir>/final-design/", () => {
		assert.equal(entry.workingCopyCategory, "final-design");
		assert.equal(entry.workingCopyArtifact, "final-design");
	});

	it("reads 6 prior artifacts in deterministic order (incl. dev-order)", () => {
		assert.equal(entry.inputs.length, 6);
		const artifacts = entry.inputs.map((i) => i.artifact);
		assert.deepEqual(artifacts, [
			"design",
			"atomic-functions",
			"pseudocode",
			"test-plan",
			"test-cases",
			"development-order",
		]);
	});

	it("every input is a doc (no brainstorm, no optional)", () => {
		for (const input of entry.inputs) {
			assert.equal(input.kind, "doc");
			assert.notEqual(input.optional, true);
		}
	});

	it("depends on development-order — Stage 10 requires Stage 9 to be approved", () => {
		const artifacts = entry.inputs.map((i) => i.artifact);
		assert.ok(artifacts.includes("development-order"), "final-design MUST depend on development-order (Stage 9)");
	});

	it("missing-input error message names Stage 10 + all prior stages", () => {
		const msg = entry.formatMissingError({
			cwd: "/fake",
			projectName: "TestApp",
			mission: "m",
			topicSlug: "m",
		});
		assert.match(msg, /Cannot run final-design/);
		assert.match(msg, /atomic-function, pseudocode, testplan, development-order/);
		assert.match(msg, /before final-design runs/);
	});
});
