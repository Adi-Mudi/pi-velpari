import { test } from "node:test";
import assert from "node:assert/strict";
import { showStage } from "../src/show.js";

test("showStage returns a string for every documented stage", () => {
	const stages = [
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
		"handoff-ready",
	] as const;
	for (const stage of stages) {
		const out = showStage(stage);
		assert.equal(typeof out, "string");
		assert.ok(out.length > 0);
	}
});

test("showStage acknowledges 'not implemented' in Phase A stub", () => {
	const out = showStage("discussing");
	assert.match(out, /not implemented|Phase A stub/i);
});
