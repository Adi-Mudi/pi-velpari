/**
 * buildStagePrompt update-mode block tests (living documents).
 *
 * Asserts:
 *   - updateMode absent  → no `## Update Mode` block (regression: fresh
 *     draft prompts stay unchanged)
 *   - updateMode present → baseline path + the 5 revision rules + the
 *     fenced baseline content render, BEFORE the skill content
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	buildStagePrompt,
	type BuildStagePromptInput,
} from "../../src/core/prompt.js";

function baseInput(): BuildStagePromptInput {
	return {
		stage: "drafting-prd",
		mission: "Test mission",
		framework: undefined,
		runId: "run-1",
		answers: [],
		webSearchAllowed: false,
		paths: {},
	};
}

const BASELINE = "# PSRS\n\n## 9. Functional Requirements\n\n| FR-01 | Login | approved |\n";

describe("buildStagePrompt — update mode block", () => {
	it("renders no Update Mode block when updateMode is absent (regression)", () => {
		const prompt = buildStagePrompt(baseInput());
		// The prd skill itself describes the Update Mode section; assert on
		// the marker that only the rendered block produces.
		assert.ok(!prompt.includes("Baseline (published, read-only reference):"));
	});

	it("renders baseline path, the 5 revision rules, and the fenced baseline", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			updateMode: {
				baselinePath: "/proj/Doc/requirements/PRD_TodoApp.md",
				baselineContent: BASELINE,
			},
		});
		assert.match(prompt, /## Update Mode/);
		assert.match(prompt, /Baseline \(published, read-only reference\): \/proj\/Doc\/requirements\/PRD_TodoApp\.md/);
		// The 5 revision rules.
		assert.match(prompt, /1\. Append-only IDs/);
		assert.match(prompt, /2\. Deprecate, don't delete/);
		assert.match(prompt, /3\. Version bump: minor/);
		assert.match(prompt, /4\. Change Log: add a new entry/);
		assert.match(prompt, /5\. New rows start with status `proposed`/);
		// Fenced baseline content (join adds a newline before the closing fence).
		assert.ok(prompt.includes(`\`\`\`markdown\n${BASELINE}\n\`\`\``));
	});

	it("renders the block after the flags and before the skill content", () => {
		const prompt = buildStagePrompt({
			...baseInput(),
			updateMode: { baselinePath: "/p/PRD_X.md", baselineContent: BASELINE },
		});
		const flagsIdx = prompt.indexOf("## Flags");
		const updateIdx = prompt.indexOf("## Update Mode");
		const skillIdx = prompt.indexOf("# PRD Stage");
		assert.ok(flagsIdx >= 0, "flags section present");
		assert.ok(updateIdx > flagsIdx, "update block after flags");
		assert.ok(skillIdx > updateIdx, "update block before skill content");
	});
});
