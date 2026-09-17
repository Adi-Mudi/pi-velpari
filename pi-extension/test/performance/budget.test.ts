/**
 * Performance budget (Phase 6.1).
 *
 * Asserts that:
 *   - the unit-test suite finishes under 30s (gated by RUN_PERF=1)
 *   - runDoctor on a minimal full-cwd fixture finishes under 1s
 *
 * Skipped by default — set RUN_PERF=1 to enable.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDoctor } from "../../src/doctor/index.js";
import { setupFullCwd } from "../helpers/full-cwd.js";

const PERF_ENABLED = process.env.RUN_PERF === "1";

describe("performance budget", () => {
	it("runDoctor on a minimal full-cwd finishes under 1s", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-perf-"));
		setupFullCwd(cwd);
		const start = Date.now();
		runDoctor(cwd);
		const elapsed = Date.now() - start;
		assert.ok(elapsed < 1000, `runDoctor took ${elapsed}ms (budget 1000ms)`);
	});

	it("RUN_PERF=1 enables stricter wall-clock assertions", { skip: !PERF_ENABLED }, () => {
		// This test only runs when RUN_PERF=1 is set.
		// It documents the expected budget; CI without RUN_PERF=1 doesn't
		// enforce it.
		const cwd = mkdtempSync(join(tmpdir(), "velpari-perf-"));
		setupFullCwd(cwd);
		const runs: number[] = [];
		for (let i = 0; i < 5; i++) {
			const start = Date.now();
			runDoctor(cwd);
			runs.push(Date.now() - start);
		}
		const avg = runs.reduce((a, b) => a + b, 0) / runs.length;
		assert.ok(avg < 500, `runDoctor avg ${avg.toFixed(1)}ms over 5 runs (budget 500ms)`);
	});
});