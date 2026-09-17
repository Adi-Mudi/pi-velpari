/**
 * /velpari-atomic-function handler unit tests (Stage 6 — required post-design).
 *
 * Verifies the STAGE_REGISTRY entry for atomic-function matches the
 * industry-standard order (Option B):
 *   - stageEnum: "analyzing-atomic-functions"
 *   - scouts: af-source-{rtm,design,prd,feas}
 *   - inputs: brainstorm (optional), PRD, RTM, feasibility, design
 *   - workingCopyCategory: "atomic-function"
 *   - workingCopyArtifact: "atomic-functions"
 *   - missing-input error message references Stage 6 and the prior stages
 *
 * The handler itself is a thin wrapper around runStage(); the registry
 * is where the configuration lives.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { STAGE_REGISTRY } from "../../src/stages/registry.js";

describe("/velpari-atomic-function — Stage 6 registry", () => {
	const entry = STAGE_REGISTRY["atomic-function"];

	it("stageEnum is analyzing-atomic-functions", () => {
		assert.equal(entry.stageEnum, "analyzing-atomic-functions");
	});

	it("skillName matches the bundled skill markdown basename", () => {
		assert.equal(entry.skillName, "atomic-function");
	});

	it("uses 5 scouts named af-source-{rtm,design,prd,feas} + reviewer", () => {
		assert.deepEqual([...entry.scouts], [
			"af-source-rtm",
			"af-source-design",
			"af-source-prd",
			"af-source-feas",
			"reviewer",
		]);
	});

	it("writes atomic-functions.md (not a folder) into <runDir>/atomic-function/", () => {
		assert.equal(entry.workingCopyCategory, "atomic-function");
		assert.equal(entry.workingCopyArtifact, "atomic-functions");
		assert.equal(entry.additionalWorkingCopies, undefined);
	});

	it("reads brainstorm (optional), PRD, RTM, feasibility-study, design — 5 inputs", () => {
		assert.equal(entry.inputs.length, 5);
		const kinds = entry.inputs.map((i) => i.kind);
		const artifacts = entry.inputs.map((i) => i.artifact);
		assert.deepEqual(kinds, ["brainstorm", "doc", "doc", "doc", "doc"]);
		// brainstorm has artifact: undefined (it's not a doc).
		assert.deepEqual(artifacts, [undefined, "PRD", "RTM", "feasibility-study", "design"]);
	});

	it("brainstorm input is optional (atomic-function does not require it)", () => {
		const brainstorm = entry.inputs.find((i) => i.kind === "brainstorm");
		assert.ok(brainstorm);
		assert.equal(brainstorm?.optional, true);
	});

	it("Stage 6 does NOT depend on pseudocode / test-plan / test-cases", () => {
		// Atomic-functions must run BEFORE those stages exist.
		const downstreamArtifacts = ["pseudocode", "test-plan", "test-cases", "atomic-functions"];
		for (const a of downstreamArtifacts) {
			assert.ok(
				!entry.inputs.some((i) => i.artifact === a),
				`atomic-function must not depend on ${a} (it runs BEFORE that stage)`,
			);
		}
	});

	it("missing-input error message names Stage 6 + all prior stages", () => {
		const cwd = "/fake";
		const projectName = "TestApp";
		const msg = entry.formatMissingError({ cwd, projectName, mission: "m", topicSlug: "m" });
		assert.match(msg, /Cannot run atomic-function/);
		assert.match(msg, /All previous stages \(prd, rtm, feasibility, design\)/);
	});
});

/**
 * Atomic-profile injection tests (ISO/IEC 29110 + IEC 61508/IEC 62304).
 *
 * The registry loads the atomic profile from `.pi/velpari/files.json:atomic`
 * and injects it into StageRunConfig.atomicProfile so the stage prompt
 * renders the `## Atomic Profile` block. This file exercises the prompt
 * render path directly — every tier produces the matching block.
 */

import { buildStagePrompt } from "../../src/core/prompt.js";
import {
	DEFAULT_ATOMIC_PROFILE,
	type AtomicProfile,
} from "../../src/core/atomic-tier.js";

describe("/velpari-atomic-function — tier injection", () => {
	const baseInput = {
		stage: "analyzing-atomic-functions" as const,
		mission: "test",
		framework: undefined,
		runId: "2026-09-16-1200-test",
		answers: [] as string[],
		webSearchAllowed: false,
		paths: {
			inputArtifact: "/tmp/PRD.md",
			workingCopy: "/tmp/atomic.md",
			scoutsDir: "/tmp/scouts",
		},
	};

	function withProfile(profile: AtomicProfile | null) {
		return {
			...baseInput,
			atomicProfile: profile,
		};
	}

	it("renders nothing when atomicProfile is null (other stages)", () => {
		const prompt = buildStagePrompt(withProfile(null));
		assert.ok(!/## Atomic Profile \(ISO\/IEC 29110/.test(prompt));
	});

	it("renders the Entry tier block when tier=entry", () => {
		const prompt = buildStagePrompt(withProfile({ ...DEFAULT_ATOMIC_PROFILE, tier: "entry" }));
		assert.match(prompt, /## Atomic Profile \(ISO\/IEC 29110 \+ IEC 61508\/IEC 62304\)/);
		assert.match(prompt, /Tier: Entry/);
		assert.match(prompt, /Safety class \(IEC 62304\): A/);
		assert.match(prompt, /Base-core only \(8 fields\)/);
	});

	it("renders the Basic tier block when tier=basic", () => {
		const prompt = buildStagePrompt(withProfile({ ...DEFAULT_ATOMIC_PROFILE, tier: "basic" }));
		assert.match(prompt, /Tier: Basic/);
		assert.match(prompt, /Base-core \+ basic-tier refs/);
	});

	it("renders the Intermediate tier block when tier=intermediate", () => {
		const prompt = buildStagePrompt(
			withProfile({ ...DEFAULT_ATOMIC_PROFILE, tier: "intermediate" }),
		);
		assert.match(prompt, /Tier: Intermediate/);
		assert.match(prompt, /EARS pattern, inputs, outputs/);
	});

	it("renders the Advanced tier block when tier=advanced", () => {
		const prompt = buildStagePrompt(
			withProfile({
				...DEFAULT_ATOMIC_PROFILE,
				tier: "advanced",
				safetyClass: "C",
				sil: "3",
			}),
		);
		assert.match(prompt, /Tier: Advanced/);
		assert.match(prompt, /Safety class \(IEC 62304\): C/);
		assert.match(prompt, /SIL \(IEC 61508\): 3/);
		assert.match(prompt, /owner, priority, securityClass/);
	});
});
