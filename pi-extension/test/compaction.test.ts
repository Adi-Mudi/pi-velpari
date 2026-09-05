import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCompactionSummary } from "../src/core/compaction.js";
import { createRun, clearRun } from "../src/core/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-compaction-"));
}

test("buildCompactionSummary returns 'No active run' when state is missing", () => {
	const dir = tempDir();
	try {
		const summary = buildCompactionSummary(dir);
		assert.equal(summary, "No active Velpari run.");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("buildCompactionSummary includes runId and currentStage", () => {
	const dir = tempDir();
	try {
		const state = createRun("Compaction Test Mission", dir);
		const summary = buildCompactionSummary(dir);
		assert.match(summary, new RegExp(state.runId));
		assert.match(summary, /Current stage: discussing/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("buildCompactionSummary never throws even with bad state", () => {
	const dir = tempDir();
	try {
		// Corrupt state.json by writing garbage
		const statePath = join(dir, ".IDE_Plans", "velpari");
		mkdirSync(statePath, { recursive: true });
		writeFileSync(join(statePath, "state.json"), "not valid json", "utf8");
		assert.ok(existsSync(join(statePath, "state.json")));

		const summary = buildCompactionSummary(dir);
		assert.equal(typeof summary, "string");
		// Either parses or falls back gracefully.
		assert.ok(summary.length > 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
