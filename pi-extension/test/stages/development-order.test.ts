/**
 * /velpari-development-order handler unit tests (Stage 9 — required post-testplan).
 *
 * Verifies the STAGE_REGISTRY entry for development-order matches the
 * industry-standard order (Option B):
 *   - stageEnum: "ordering-development"
 *   - scouts: do-topology, do-risk, do-test, do-value
 *   - inputs: 8 prior artifacts (design, PRD, RTM, feasibility,
 *     atomic-functions, pseudocode, test-plan, test-cases)
 *   - missing-input error message references Stage 9 + all prior stages
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { STAGE_REGISTRY } from "../../src/stages/registry.js";

describe("/velpari-development-order — Stage 9 registry", () => {
	const entry = STAGE_REGISTRY["development-order"];

	it("stageEnum is ordering-development", () => {
		assert.equal(entry.stageEnum, "ordering-development");
	});

	it("skillName matches the bundled skill markdown basename", () => {
		assert.equal(entry.skillName, "development-order");
	});

	it("uses 4 scouts named do-{topology,risk,test,value}", () => {
		assert.deepEqual([...entry.scouts], ["do-topology", "do-risk", "do-test", "do-value"]);
	});

	it("writes development-order.md into <runDir>/development-order/", () => {
		assert.equal(entry.workingCopyCategory, "development-order");
		assert.equal(entry.workingCopyArtifact, "development-order");
	});

	it("reads all 8 prior artifacts in deterministic order", () => {
		assert.equal(entry.inputs.length, 8);
		const artifacts = entry.inputs.map((i) => i.artifact);
		assert.deepEqual(artifacts, [
			"design",
			"PRD",
			"RTM",
			"feasibility-study",
			"atomic-functions",
			"pseudocode",
			"test-plan",
			"test-cases",
		]);
	});

	it("every input is a doc (no brainstorm, no optional)", () => {
		for (const input of entry.inputs) {
			assert.equal(input.kind, "doc");
			assert.notEqual(input.optional, true);
		}
	});

	it("depends on Stages 6 (atomic-functions) and 7 (pseudocode) — requires Option B order", () => {
		const artifacts = entry.inputs.map((i) => i.artifact);
		assert.ok(artifacts.includes("atomic-functions"), "development-order MUST depend on atomic-functions (Stage 6)");
		assert.ok(artifacts.includes("pseudocode"), "development-order MUST depend on pseudocode (Stage 7)");
	});

	it("missing-input error message names Stage 9 + all prior stages", () => {
		const msg = entry.formatMissingError({
			cwd: "/fake",
			projectName: "TestApp",
			mission: "m",
			topicSlug: "m",
		});
		assert.match(msg, /Cannot run development-order/);
		assert.match(msg, /atomic-function, pseudocode, testplan/);
	});
});
