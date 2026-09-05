import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGE_TRANSITIONS, PATHS } from "../src/core/constants.js";

test("STAGE_TRANSITIONS is non-empty", () => {
	assert.ok(STAGE_TRANSITIONS.length > 0);
});

test("every transition references a /velpari-* command", () => {
	for (const t of STAGE_TRANSITIONS) {
		assert.ok(t.command.startsWith("/velpari-"), `bad command: ${t.command}`);
	}
});

test("transitions form a connected chain from 'none' to 'handoff-ready'", () => {
	const fromNone = STAGE_TRANSITIONS.filter((t) => t.from === "none");
	assert.equal(fromNone.length, 1, "expected exactly one transition from 'none'");
	assert.equal(fromNone[0]!.to, "discussing");

	const toHandoff = STAGE_TRANSITIONS.filter((t) => t.to === "handoff-ready");
	assert.ok(toHandoff.length >= 1, "no transition ends at handoff-ready");
});

test("PATHS exposes required path constants", () => {
	assert.ok(PATHS.STATE_FILE.endsWith("state.json"));
	assert.ok(PATHS.RUN_STATE_DIR.includes(".IDE_Plans"));
	assert.ok(PATHS.HANDOFF_TARGET.endsWith(".json"));
});
