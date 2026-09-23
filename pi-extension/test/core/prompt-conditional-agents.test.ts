/**
 * Conditional-agents prompt block tests (feasibility v2, Phase 2).
 *
 * Asserts:
 *   - conditionalAgents absent → no `## Conditional Agents` block
 *   - present → role list renders, with resolved spawn name when
 *     agents.json remaps the role
 *   - STAGE_REGISTRY: only feasibility declares conditional agents, and
 *     they are exactly [feasibility-reuse-scout, feasibility-spike]
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildStagePrompt, type BuildStagePromptInput } from "../../src/core/prompt.js";
import { STAGE_KEYS, STAGE_REGISTRY } from "../../src/stages/registry.js";

function baseInput(): BuildStagePromptInput {
	return {
		stage: "analyzing-feasibility",
		mission: "Test mission",
		framework: undefined,
		runId: "run-1",
		answers: [],
		webSearchAllowed: false,
		paths: {},
	};
}

describe("buildStagePrompt — conditional agents block", () => {
	it("renders no block when conditionalAgents is absent", () => {
		const prompt = buildStagePrompt(baseInput());
		// The skill markdown mentions the block by name; the rendered block's
		// unique marker is the parenthesized instruction + "- role" lines.
		assert.ok(!prompt.includes("## Conditional Agents (spawn ONLY"));
		assert.ok(!prompt.includes("- role feasibility-reuse-scout"));
	});

	it("renders roles with default names", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			conditionalAgents: [
				{ role: "feasibility-reuse-scout", agentName: "feasibility-reuse-scout" },
				{ role: "feasibility-spike", agentName: "feasibility-spike" },
			],
		});
		assert.match(prompt, /## Conditional Agents \(spawn ONLY when the skill's conditions are met\)/);
		assert.ok(prompt.includes("- role feasibility-reuse-scout"));
		assert.ok(prompt.includes("- role feasibility-spike"));
	});

	it("renders the resolved spawn name when remapped", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			conditionalAgents: [{ role: "feasibility-spike", agentName: "my-custom-spike" }],
		});
		assert.ok(prompt.includes("- role feasibility-spike (spawn agent: my-custom-spike)"));
	});

	it("renders the block before the skill content", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			conditionalAgents: [{ role: "feasibility-spike", agentName: "feasibility-spike" }],
		});
		const blockIdx = prompt.indexOf("## Conditional Agents");
		const skillIdx = prompt.indexOf("# Feasibility Stage");
		assert.ok(blockIdx > -1 && skillIdx > -1 && blockIdx < skillIdx);
	});
});

describe("STAGE_REGISTRY — conditional agents", () => {
	it("only feasibility declares them, with exactly the 2 v2 roles", () => {
		for (const key of STAGE_KEYS) {
			const extra = STAGE_REGISTRY[key].conditionalAgents ?? [];
			if (key === "feasibility") {
				assert.deepEqual([...extra], ["feasibility-reuse-scout", "feasibility-spike"]);
			} else {
				assert.deepEqual([...extra], [], `${key} must not declare conditional agents`);
			}
		}
	});
});
