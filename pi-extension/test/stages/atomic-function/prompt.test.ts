/**
 * PHASE 2 — prompt tests (Phase 3 of atomic-function-layer plan).
 *
 * Verifies `stages/atomic-function/prompt.ts:buildAtomicFunctionPrompt`
 * wraps `core/prompt.ts:buildStagePrompt` with the correct
 * atomic-function defaults + forwards the tier / update-mode / profile
 * inputs. Also covers `renderTierFields` for each tier.
 *
 * The buildStagePrompt `## Atomic Profile` block is covered more
 * thoroughly by `test/stages/atomic-function.test.ts`; here we only
 * assert the wrapper integrates correctly with buildStagePrompt and
 * adds no extra content.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
	buildAtomicFunctionPrompt,
	renderTierFields,
	toBuildStagePromptInput,
} from "../../../src/stages/atomic-function/prompt.js";
import { buildStagePrompt } from "../../../src/core/prompt.js";
import { DEFAULT_ATOMIC_PROFILE } from "../../../src/core/atomic-tier.js";
import type { AtomicProfile } from "../../../src/core/atomic-tier.js";

const baseScoutSlots = [
	{ name: "af-source-rtm", reportPath: "/tmp/scouts/af-source-rtm-report.json" },
	{ name: "af-source-design", reportPath: "/tmp/scouts/af-source-design-report.json" },
	{ name: "af-source-prd", reportPath: "/tmp/scouts/af-source-prd-report.json" },
	{ name: "af-source-feas", reportPath: "/tmp/scouts/af-source-feas-report.json" },
];

function withTier(tier: AtomicProfile["tier"]): AtomicProfile {
	return { ...DEFAULT_ATOMIC_PROFILE, tier };
}

const baseInput = {
	stage: "analyzing-atomic-functions" as const,
	mission: "test",
	framework: "typescript",
	runId: "2026-09-17-1200-test",
	scouts: baseScoutSlots,
	inputArtifact: "/tmp/PRD.md",
	workingCopy: "/tmp/atomic-functions.md",
	scoutsDir: "/tmp/scouts",
};

describe("buildAtomicFunctionPrompt — tier blocks", () => {
	it("renders the Entry tier block", () => {
		const prompt = buildAtomicFunctionPrompt({
			...baseInput,
			atomicProfile: withTier("entry"),
		});
		assert.match(prompt, /## Atomic Profile \(ISO\/IEC 29110 \+ IEC 61508\/IEC 62304\)/);
		assert.match(prompt, /Tier: Entry/);
		assert.match(prompt, /Base-core only \(8 fields\)/);
	});

	it("renders the Basic tier block", () => {
		const prompt = buildAtomicFunctionPrompt({
			...baseInput,
			atomicProfile: withTier("basic"),
		});
		assert.match(prompt, /Tier: Basic/);
		assert.match(prompt, /basic-tier refs/);
	});

	it("renders the Intermediate tier block", () => {
		const prompt = buildAtomicFunctionPrompt({
			...baseInput,
			atomicProfile: withTier("intermediate"),
		});
		assert.match(prompt, /Tier: Intermediate/);
		assert.match(prompt, /EARS pattern/);
	});

	it("renders the Advanced tier block", () => {
		const prompt = buildAtomicFunctionPrompt({
			...baseInput,
			atomicProfile: { ...DEFAULT_ATOMIC_PROFILE, tier: "advanced", safetyClass: "C", sil: "3" },
		});
		assert.match(prompt, /Tier: Advanced/);
		assert.match(prompt, /Safety class \(IEC 62304\): C/);
		assert.match(prompt, /SIL \(IEC 61508\): 3/);
		assert.match(prompt, /owner, priority, securityClass/);
	});
});

describe("buildAtomicFunctionPrompt — update mode", () => {
	it("renders Update Mode block when baseline is provided", () => {
		const prompt = buildAtomicFunctionPrompt({
			...baseInput,
			atomicProfile: withTier("basic"),
			updateMode: {
				baselinePath: "/tmp/Doc/atomic-functions_TestApp.md",
				baselineContent: "# baseline",
			},
		});
		assert.match(prompt, /## Update Mode/);
		assert.match(prompt, /Append-only IDs/);
		assert.match(prompt, /baseline/);
	});

	it("omits Update Mode block when baseline is null", () => {
		const prompt = buildAtomicFunctionPrompt({
			...baseInput,
			atomicProfile: withTier("basic"),
			updateMode: null,
		});
		// "Append-only IDs" is unique to the rendered Update Mode block — the
		// skill markdown itself has its own "## Update Mode" header.
		assert.doesNotMatch(prompt, /Append-only IDs/);
		assert.doesNotMatch(prompt, /Deprecate, don't delete/);
	});
});

describe("buildAtomicFunctionPrompt — profile metadata", () => {
	it("forwards profileMetadata to the Profile (compact) block", () => {
		const prompt = buildAtomicFunctionPrompt({
			...baseInput,
			atomicProfile: withTier("basic"),
			profileMetadata: {
				profileId: "core-psrs-v1",
				profileKind: "common-core",
				profileVersion: "1.0.0",
				applicationType: "web",
				domain: "healthcare",
				developmentMethod: "agile",
				regulated: true,
				outputVariant: "standard",
			},
		});
		assert.match(prompt, /## Profile \(compact\)/);
		assert.match(prompt, /Profile id: core-psrs-v1/);
		assert.match(prompt, /Regulated: yes/);
	});

	it("omits Profile (compact) block when profileMetadata is null", () => {
		const prompt = buildAtomicFunctionPrompt({
			...baseInput,
			atomicProfile: withTier("basic"),
			profileMetadata: null,
		});
		assert.doesNotMatch(prompt, /## Profile \(compact\)/);
	});
});

describe("buildAtomicFunctionPrompt — wrapper parity", () => {
	it("produces the same output as buildStagePrompt with the same defaults", () => {
		const atomicProfile = withTier("intermediate");
		const wrapperPrompt = buildAtomicFunctionPrompt({
			...baseInput,
			atomicProfile,
		});
		const directPrompt = buildStagePrompt({
			stage: "analyzing-atomic-functions",
			mission: baseInput.mission,
			framework: baseInput.framework,
			runId: baseInput.runId,
			answers: [],
			webSearchAllowed: false,
			paths: {
				scouts: baseScoutSlots,
				inputArtifact: baseInput.inputArtifact,
				workingCopy: baseInput.workingCopy,
				scoutsDir: baseInput.scoutsDir,
			},
			atomicProfile,
		});
		assert.equal(wrapperPrompt, directPrompt);
	});
});

describe("renderTierFields — full field list per tier", () => {
	it("entry: 8 base-core fields", () => {
		const fields = renderTierFields("entry");
		const list = fields.split(", ");
		assert.equal(list.length, 8);
		for (const required of [
			"afId",
			"name",
			"purpose",
			"signature",
			"source",
			"cohesion",
			"verification",
			"testable",
		]) {
			assert.ok(list.includes(required), `entry missing ${required}`);
		}
	});

	it("basic: 13 fields (8 base + 5 cross-refs)", () => {
		const list = renderTierFields("basic").split(", ");
		assert.equal(list.length, 13);
	});

	it("intermediate: 24 fields (8 + 5 + 11)", () => {
		const list = renderTierFields("intermediate").split(", ");
		assert.equal(list.length, 24);
	});

	it("advanced: 35 fields (8 + 5 + 11 + 11)", () => {
		const list = renderTierFields("advanced").split(", ");
		assert.equal(list.length, 35);
	});
});

describe("toBuildStagePromptInput — shape conversion", () => {
	it("forwards all required fields", () => {
		const result = toBuildStagePromptInput({
			...baseInput,
			atomicProfile: withTier("basic"),
		});
		assert.equal(result.stage, "analyzing-atomic-functions");
		assert.equal(result.mission, baseInput.mission);
		assert.equal(result.framework, baseInput.framework);
		assert.equal(result.runId, baseInput.runId);
		assert.deepEqual(result.answers, []);
		assert.equal(result.webSearchAllowed, false);
		assert.equal(result.atomicProfile?.tier, "basic");
		assert.equal(result.updateMode, null);
		assert.equal(result.profileMetadata, null);
	});
});