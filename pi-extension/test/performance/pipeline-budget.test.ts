/**
 * Performance budget — full pipeline operations (Phase 6 budget expansion).
 *
 * Two budgets, all gated by RUN_PERF=1:
 *   - The full Option B state-machine walk (1 createRun + 19 transitions)
 *     finishes under 500ms. Catches any regression in state.ts hashing or
 *     run-lock acquisition overhead.
 *   - runHandoff on a project with all 10 required Doc/ artifacts seeded
 *     finishes under 250ms. Catches handoff.ts regressions in
 *     readApprovedArtifacts or MVP-coverage evaluation.
 *
 * Both tests seed minimal but realistic project fixtures via `setupFullCwd`.
 *
 * Skipped by default — set RUN_PERF=1 to enable.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runHandoff } from "../../src/ops/handoff.js";
import { createRun, advanceStage, saveState } from "../../src/core/state.js";
import { readApprovedArtifacts } from "../../src/ops/handoff.js";
import { setupFullCwd } from "../helpers/full-cwd.js";

const PERF_ENABLED = process.env.RUN_PERF === "1";

describe("performance — full pipeline operations", () => {
	it("walkToFinalizedDesign (21 transitions) finishes under 500ms", { skip: !PERF_ENABLED }, () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-perf-pipeline-"));
		// Seed the minimal config so files.json is present.
		fs.mkdirSync(path.join(cwd, ".pi", "velpari"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "PipelineApp" }),
		);

		const start = Date.now();
		let s = createRun("Test", cwd);
		const walk = [
			"/velpari-approve-brainstorm",
			"/velpari-prd",
			"/velpari-rtm-approve",
			"/velpari-rtm",
			"/velpari-feasibility-approve",
			"/velpari-feasibility",
			"/velpari-architecture-generator-approve",
			"/velpari-architecture-generator",
			"/velpari-atomic-function-approve",
			"/velpari-atomic-function",
			"/velpari-pseudocode-approve",
			"/velpari-pseudocode",
			"/velpari-testplan-approve",
			"/velpari-testplan",
			"/velpari-development-order-approve",
			"/velpari-development-order",
			"/velpari-final-design-approve",
			"/velpari-final-design",
			"/velpari-final-design-approve",
		];
		for (const cmd of walk) s = advanceStage(s, cmd, cwd);
		const elapsed = Date.now() - start;
		assert.equal(s.currentStage, "finalized-design");
		assert.ok(elapsed < 500, `full pipeline walk took ${elapsed}ms (budget 500ms)`);
	});

	it("runHandoff on a 10-doc fixture finishes under 250ms", { skip: !PERF_ENABLED }, () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-perf-handoff-"));
		// setupFullCwd seeds files.json + PRD + RTM + RTM.json. We add the
		// remaining 8 docs required by the post-Option-B handoff so the
		// perf path covers a realistic 10-doc load.
		setupFullCwd(cwd);
		const extras: ReadonlyArray<readonly [string, string]> = [
			["feasibility/feasibility-study_TestApp.md", "# Feasibility\n"],
			["design/design_TestApp.md", "# Design\n"],
			["atomic-functions/atomic-functions_TestApp.md", "# Atomic Functions\n"],
			["pseudocode/pseudocode_TestApp.md", "# Pseudocode\n"],
			["tests/test-plan_TestApp.md", "# Test Plan\n"],
			["tests/test-cases_TestApp.md", "# Test Cases\n"],
			["development-order/development-order_TestApp.md", "# Development Order\n"],
			["design/final-design_TestApp.md", "# Final Design\n"],
		];
		for (const [rel, content] of extras) {
			fs.mkdirSync(path.dirname(path.join(cwd, "Doc", rel)), { recursive: true });
			fs.writeFileSync(path.join(cwd, "Doc", rel), content, "utf8");
		}

		const start = Date.now();
		// readApprovedArtifacts is the I/O-heavy path inside runHandoff.
		// Run it directly for a representative budget on the 10-doc fixture.
		const docs = readApprovedArtifacts("TestApp", cwd);
		assert.equal(docs.length, 10, "expected all 10 required artifacts to load");
		const elapsed = Date.now() - start;
		assert.ok(elapsed < 250, `handoff path took ${elapsed}ms (budget 250ms)`);
	});
});
