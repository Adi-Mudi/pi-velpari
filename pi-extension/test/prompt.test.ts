import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStagePrompt, loadStageSkill } from "../src/prompt.js";

test("loadStageSkill returns a string for every stage", () => {
	const stages = [
		"none",
		"discussing",
		"discussed",
		"drafting-prd",
		"drafted-prd",
		"building-rtm",
		"built-rtm",
		"analyzing-feasibility",
		"analyzed-feasibility",
		"designing",
		"designed",
		"writing-pseudocode",
		"wrote-pseudocode",
		"planning-tests",
		"planned-tests",
		"analyzing-atomic-functions",
		"analyzed-atomic-functions",
		"ordering-development",
		"ordered-development",
		"handoff-ready",
	] as const;
	for (const stage of stages) {
		const result = loadStageSkill(stage);
		assert.equal(typeof result, "string");
		assert.ok(result.length > 0);
	}
});

test("buildStagePrompt includes framework info when provided", () => {
	const prompt = buildStagePrompt("discussing", "TypeScript", "user context");
	assert.match(prompt, /TypeScript/);
	assert.match(prompt, /discussing/);
	assert.match(prompt, /user context/);
});

test("buildStagePrompt omits framework line when undefined", () => {
	const prompt = buildStagePrompt("discussing", undefined, "user context");
	assert.doesNotMatch(prompt, /Framework:/);
	assert.match(prompt, /user context/);
});
