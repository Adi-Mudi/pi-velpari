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

// ---------------------------------------------------------------------------
// Phase B followup — edge tests covering behavior current tests don't reach:
// multi-input concatenation, optional-discussion skip, Doc legacy fallback,
// STAGE_REGISTRY stageEnum ↔ STAGE_TRANSITIONS drift detection.
// ---------------------------------------------------------------------------

test("resolveStageInputs concatenates multi-input sections with ---\\n\\n separators and ## headers", () => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-registry-multi-"));
	try {
		mkdirSync(join(dir, "Doc"), { recursive: true });
		// Stage: development-order has 5 required inputs (design, RTM,
		// feasibility-study, PRD, test-plan). Write all 5 at legacy paths.
		writeFileSync(join(dir, "Doc", "design_TestApp.md"), "DESIGN-CONTENT\n", "utf8");
		writeFileSync(join(dir, "Doc", "RTM_TestApp.md"), "RTM-CONTENT\n", "utf8");
		writeFileSync(join(dir, "Doc", "feasibility-study_TestApp.md"), "FEAS-CONTENT\n", "utf8");
		writeFileSync(join(dir, "Doc", "PRD_TestApp.md"), "PRD-CONTENT\n", "utf8");
		writeFileSync(join(dir, "Doc", "test-plan_TestApp.md"), "TPLAN-CONTENT\n", "utf8");
		const result = resolveStageInputs(STAGE_REGISTRY["development-order"], {
			cwd: dir,
			projectName: "TestApp",
			mission: "TestMission",
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.ok(result.inputArtifactContent, "must populate inputArtifactContent for multi-input");
			// Each section labelled `## label` then content, joined by `\n\n---\n\n`.
			assert.match(result.inputArtifactContent, /## design\n\nDESIGN-CONTENT/);
			assert.match(result.inputArtifactContent, /## RTM\n\nRTM-CONTENT/);
			assert.match(result.inputArtifactContent, /## feasibility-study\n\nFEAS-CONTENT/);
			assert.match(result.inputArtifactContent, /## PRD\n\nPRD-CONTENT/);
			assert.match(result.inputArtifactContent, /## test-plan\n\nTPLAN-CONTENT/);
			assert.match(result.inputArtifactContent, /\n\n---\n\n/);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveStageInputs skips optional discussion when missing but keeps required doc inputs", () => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-registry-discussion-skip-"));
	try {
		mkdirSync(join(dir, "Doc"), { recursive: true });
		// No discussion file. Write PRD only (atomic-function requires PRD, RTM, feasibility-study, design, pseudocode, test-plan, test-cases).
		// Write all 7 required docs at legacy paths.
		writeFileSync(join(dir, "Doc", "PRD_TestApp.md"), "# PRD\n", "utf8");
		writeFileSync(join(dir, "Doc", "RTM_TestApp.md"), "# RTM\n", "utf8");
		writeFileSync(join(dir, "Doc", "feasibility-study_TestApp.md"), "# feas\n", "utf8");
		writeFileSync(join(dir, "Doc", "design_TestApp.md"), "# design\n", "utf8");
		writeFileSync(join(dir, "Doc", "pseudocode_TestApp.md"), "# pseudo\n", "utf8");
		writeFileSync(join(dir, "Doc", "test-plan_TestApp.md"), "# tplan\n", "utf8");
		writeFileSync(join(dir, "Doc", "test-cases_TestApp.md"), "# tcases\n", "utf8");
		const result = resolveStageInputs(STAGE_REGISTRY["atomic-function"], {
			cwd: dir,
			projectName: "TestApp",
			mission: "TestMission",
		});
		assert.equal(result.ok, true, "atomic-function must succeed without discussion when docs are present");
		if (result.ok) {
			assert.ok(result.inputArtifactContent, "must populate inputArtifactContent");
			assert.doesNotMatch(result.inputArtifactContent, /## discussion/, "must NOT include discussion section");
			assert.match(result.inputArtifactContent, /## PRD\n/);
			assert.match(result.inputArtifactContent, /## test-cases\n/);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveStageInputs resolves Doc inputs from the legacy flat path (Phase 7 fallback)", () => {
	// RTM requires `PRD_TestApp.md`. Only legacy flat path exists; grouped path does not.
	const dir = mkdtempSync(join(tmpdir(), "velpari-registry-legacy-"));
	try {
		mkdirSync(join(dir, "Doc"), { recursive: true });
		// Skip Doc/requirements/ — write only the legacy flat Doc/PRD_TestApp.md.
		writeFileSync(join(dir, "Doc", "PRD_TestApp.md"), "# stub\n", "utf8");
		const result = resolveStageInputs(STAGE_REGISTRY.rtm, {
			cwd: dir,
			projectName: "TestApp",
			mission: "TestMission",
		});
		assert.equal(result.ok, true, "RTM must find PRD at the legacy flat path when grouped is absent");
		if (result.ok) {
			assert.match(result.inputArtifactPath, /Doc\/PRD_TestApp\.md$/);
			// Grouped path must NOT be picked (verifies the fallback is structured correctly).
			assert.doesNotMatch(result.inputArtifactPath, /requirements\/PRD_TestApp\.md$/);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("STAGE_REGISTRY stageEnum stays aligned with STAGE_TRANSITIONS (drift detection)", async () => {
	// Lazy-import the constants + state modules so we don't add a static dep
	// between registry.ts and constants.ts. The drift we want to catch:
	// someone changes a stage's stageEnum in registry.ts but forgets to update
	// STAGE_TRANSITIONS in constants.ts (or vice versa).
	const constants = await import("../src/core/constants.js");
	const transitions = constants.STAGE_TRANSITIONS;
	// Build the set of stage values STAGE_TRANSITIONS drives.
	const transitionStages = new Set<string>();
	for (const t of transitions) {
		transitionStages.add(t.from);
		transitionStages.add(t.to);
	}
	// For each registry entry, the stageEnum must equal either `from` or `to`
	// of some transition that mentions the spec's key indirectly. Simpler check:
	// every registry stageEnum must appear in `transitionStages`.
	for (const key of STAGE_KEYS) {
		const spec = STAGE_REGISTRY[key];
		assert.ok(
			transitionStages.has(spec.stageEnum),
			`STAGE_REGISTRY.${key}.stageEnum="${spec.stageEnum}" is not referenced in STAGE_TRANSITIONS; the two tables have drifted`,
		);
	}
});
