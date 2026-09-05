/**
 * Phase B tests — STAGE_REGISTRY shape and behaviour.
 *
 * Locks in:
 *   - Every StageKey has a StageSpec with the required fields.
 *   - The 4-scout invariant: every spec.scouts has exactly 4 entries.
 *   - Single-input stages have inputs.length === 1.
 *   - Multi-input stages have inputs.length > 1.
 *   - The testplan spec declares its second working copy (test-cases).
 *   - The atomic-function spec marks its discussion input as optional.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	STAGE_KEYS,
	STAGE_REGISTRY,
	resolveStageInputs,
	type StageKey,
} from "../src/stages/registry.js";

test("STAGE_KEYS lists the 8 stage handlers that route through the registry", () => {
	assert.equal(STAGE_KEYS.length, 8);
});

test("every StageKey has a corresponding STAGE_REGISTRY entry", () => {
	for (const key of STAGE_KEYS) {
		assert.ok(STAGE_REGISTRY[key], `STAGE_REGISTRY.${key} missing`);
	}
});

test("every spec declares exactly 4 scout subagents (AGENTS.md principle 4)", () => {
	for (const key of STAGE_KEYS) {
		const spec = STAGE_REGISTRY[key];
		assert.equal(
			spec.scouts.length,
			4,
			`STAGE_REGISTRY.${key}.scouts must have exactly 4 entries`,
		);
	}
});

test("single-input stages (prd, rtm, feasibility, design, pseudocode, testplan) have exactly one input", () => {
	const singleInputKeys: StageKey[] = ["prd", "rtm", "feasibility", "design", "pseudocode", "testplan"];
	for (const key of singleInputKeys) {
		const spec = STAGE_REGISTRY[key];
		assert.equal(
			spec.inputs.length,
			1,
			`STAGE_REGISTRY.${key}.inputs must be length 1 (single-input stage)`,
		);
	}
});

test("multi-input stages (atomic-function, development-order) have multiple inputs", () => {
	const multiInputKeys: StageKey[] = ["atomic-function", "development-order"];
	for (const key of multiInputKeys) {
		const spec = STAGE_REGISTRY[key];
		assert.ok(
			spec.inputs.length > 1,
			`STAGE_REGISTRY.${key}.inputs must be multi-input`,
		);
	}
});

test("testplan spec declares test-cases as the additional working copy", () => {
	const testplan = STAGE_REGISTRY.testplan;
	assert.deepEqual(testplan.additionalWorkingCopies, ["test-cases"]);
});

test("atomic-function spec marks its discussion input as optional", () => {
	const atomic = STAGE_REGISTRY["atomic-function"];
	const discussion = atomic.inputs.find((i) => i.kind === "discussion");
	assert.ok(discussion, "atomic-function must include a discussion input");
	assert.equal(
		discussion.optional,
		true,
		"atomic-function's discussion input must be optional",
	);
});

test("resolveStageInputs returns ok=false when a required input is missing (no files on disk)", () => {
	const result = resolveStageInputs(STAGE_REGISTRY.rtm, {
		cwd: "/nonexistent/path/that/does/not/exist",
		projectName: "TestApp",
		mission: "TestMission",
	});
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.match(result.error, /cannot read PSRS/i);
	}
});

test("resolveStageInputs returns ok=true when at least one input exists on disk", () => {
	// Create temp dir with a discussion file at the legacy flat path.
	const dir = mkdtempSync(join(tmpdir(), "velpari-registry-"));
	try {
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "discussion-testmission.md"), "# stub\n", "utf8");
		const result = resolveStageInputs(STAGE_REGISTRY.prd, {
			cwd: dir,
			projectName: "TestApp",
			mission: "TestMission",
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.match(result.inputArtifactPath, /discussion-testmission\.md$/);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
