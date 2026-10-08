/**
 * Phase 6.4 — performance: the preflight ms budget (plan §6.4, outline
 * risk 2 — the timing measurement lives in CI from the first push).
 *
 * Conventions of `backup-budget.test.ts`, but always-on (no RUN_PERF
 * gate): `runPreflight` must stay under the 500 ms first-CI-safe
 * budget on a warm fixture AND on an active-run fixture where row 7's
 * evidence probe runs one `readLatestPublishedRows` query. The
 * measured `durationMs` is asserted positive and printed so the CI
 * test log carries the ms numbers.
 *
 * Typical local expectation is < 50 ms; the 500 ms ceiling only
 * catches an accidental O(n) scan or subprocess loop creeping into
 * the fast path.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPreflight } from "../../src/doctor/preflight.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { publishArtifact, writeArtifact, type ArtifactEnvelopeInput } from "../../src/io/store.js";

/** First CI-safe budget for one preflight run (ms). */
const BUDGET_MS = 500;

let tmpDir = "";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-preflight-perf-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Write a valid config + minimal state.
 * @param {string} runId - Run id ("" = no active run).
 * @param {string} currentStage - Stage flag.
 * @param {string} projectName - Store/config project name.
 * @returns {void} Nothing.
 */
function writeFixture(runId: string, currentStage: string, projectName: string): void {
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName }),
		"utf8",
	);
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "state.json"),
		JSON.stringify({
			version: 1,
			runId,
			mission: "perf mission",
			currentStage,
			history: [],
			updatedAt: new Date().toISOString(),
		}),
		"utf8",
	);
}

/**
 * Publish a PRD row so row 7's evidence probe has a store to query.
 * @param {string} runId - Run id stamped into the envelope.
 * @param {string} projectName - Store project.
 * @returns {void} Nothing.
 */
function publishPrd(runId: string, projectName: string): void {
	const db = openStoreDb(buildStoreDbPath(projectName, tmpDir));
	try {
		const envelope: ArtifactEnvelopeInput = {
			version: 1,
			stage: "drafting-prd",
			generatedAt: "2026-09-28T00:00:00Z",
			inputs: "{}",
			reviewerVerdict: null,
			changeLog: "[]",
		};
		writeArtifact(db, "prd", runId, envelope, { fr: [] });
		publishArtifact(db, runId, "prd");
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Measure one `runPreflight` wall-clock run.
 * @param {string} cwd - Project root.
 * @returns {{result: ReturnType<typeof runPreflight>, wallMs: number}} Result + wall time.
 */
function measure(cwd: string): { result: ReturnType<typeof runPreflight>; wallMs: number } {
	const t0 = performance.now();
	const result = runPreflight(cwd, { command: "/velpari-prd", mode: "stage-start" });
	return { result, wallMs: performance.now() - t0 };
}

describe("preflight performance budget", () => {
	it(`warm fixture (config + no run) runs under ${BUDGET_MS} ms`, () => {
		writeFixture("", "none", "PerfApp");
		// Warm once (module resolution + first reads), then measure.
		measure(tmpDir);
		const { result, wallMs } = measure(tmpDir);
		console.log(`[perf] preflight warm fixture: wall ${wallMs.toFixed(1)} ms, durationMs ${result.durationMs.toFixed(1)} ms`);
		assert.ok(result.durationMs > 0, "durationMs must be a positive measurement");
		assert.ok(wallMs < BUDGET_MS, `wall ${wallMs.toFixed(1)} ms exceeded ${BUDGET_MS} ms`);
		assert.ok(result.durationMs < BUDGET_MS, `durationMs ${result.durationMs.toFixed(1)} ms exceeded ${BUDGET_MS} ms`);
	});

	it(`active-run fixture (one readLatestPublishedRows query) runs under ${BUDGET_MS} ms`, () => {
		writeFixture("run-perf", "drafting-prd", "PerfApp");
		publishPrd("run-perf", "PerfApp");
		const { result, wallMs } = measure(tmpDir);
		console.log(`[perf] preflight active run: wall ${wallMs.toFixed(1)} ms, durationMs ${result.durationMs.toFixed(1)} ms`);
		assert.ok(result.durationMs > 0, "durationMs must be a positive measurement");
		assert.ok(wallMs < BUDGET_MS, `wall ${wallMs.toFixed(1)} ms exceeded ${BUDGET_MS} ms`);
		assert.ok(result.durationMs < BUDGET_MS, `durationMs ${result.durationMs.toFixed(1)} ms exceeded ${BUDGET_MS} ms`);
		// The bookkeeping probe actually saw the store row (query ran).
		assert.equal(
			result.findings.some((f) => f.fingerprint === "bookkeeping-advance"),
			true,
			"row 7 must reach the store-backed evidence probe",
		);
	});
});
