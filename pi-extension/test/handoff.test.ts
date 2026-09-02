import { test } from "node:test";
import assert from "node:assert/strict";
import { runHandoff, validateSenaiSchema, readApprovedArtifacts } from "../src/handoff.js";
import { createRun, clearRun } from "../src/state.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-handoff-"));
}

test("runHandoff returns 'not implemented' string (Phase A stub)", () => {
	const dir = tempDir();
	try {
		const state = createRun("Handoff Test", dir);
		const result = runHandoff(state, dir);
		assert.match(result, /not implemented/i);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("validateSenaiSchema returns true for any input (Phase A stub)", () => {
	assert.equal(validateSenaiSchema({}), true);
	assert.equal(validateSenaiSchema(null), true);
	assert.equal(validateSenaiSchema("anything"), true);
});

test("readApprovedArtifacts returns an empty object (Phase A stub)", () => {
	const dir = tempDir();
	try {
		const result = readApprovedArtifacts(dir);
		assert.equal(typeof result, "object");
		assert.notEqual(result, null);
		assert.equal(Object.keys(result).length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
