/**
 * Spike tests (feasibility v2, Phase 3).
 *
 * Covers core/spike.ts:
 *   - validateSpikeResult structural checks
 *   - compareSpikes ranking (pass > build-only > fail; alphabetical tiebreak)
 *   - needsSpikes gating (build + no framework only)
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { compareSpikes, needsSpikes, validateSpikeResult, type SpikeResult } from "../../src/core/spike.js";

function spike(overrides: Partial<SpikeResult> = {}): SpikeResult {
	return {
		language: "typescript",
		coreFunction: "FR-01 save expenses",
		buildOk: true,
		runOk: true,
		notes: "works",
		evidencePath: "spikes/typescript/index.ts",
		...overrides,
	};
}

describe("validateSpikeResult", () => {
	it("accepts a complete result", () => {
		assert.deepEqual(validateSpikeResult(spike()), []);
	});
	it("rejects non-objects", () => {
		assert.deepEqual(validateSpikeResult(null), ["spike result is not an object"]);
	});
	it("flags every missing/wrong field", () => {
		const problems = validateSpikeResult({ language: "", buildOk: "yes" });
		assert.ok(problems.some((p) => p.includes("language")));
		assert.ok(problems.some((p) => p.includes("coreFunction")));
		assert.ok(problems.some((p) => p.includes("buildOk")));
		assert.ok(problems.some((p) => p.includes("runOk")));
		assert.ok(problems.some((p) => p.includes("notes")));
		assert.ok(problems.some((p) => p.includes("evidencePath")));
	});
});

describe("compareSpikes", () => {
	it("ranks pass > build-only > fail", () => {
		const ranked = compareSpikes([
			spike({ language: "rust", buildOk: false, runOk: false }),
			spike({ language: "python", buildOk: true, runOk: false }),
			spike({ language: "go" }),
		]);
		assert.deepEqual(
			ranked.map((r) => r.language),
			["go", "python", "rust"],
		);
	});
	it("breaks ties alphabetically for determinism", () => {
		const ranked = compareSpikes([spike({ language: "typescript" }), spike({ language: "go" })]);
		assert.deepEqual(
			ranked.map((r) => r.language),
			["go", "typescript"],
		);
	});
});

describe("needsSpikes", () => {
	it("true only for build path without a configured framework", () => {
		assert.equal(needsSpikes("build", undefined), true);
		assert.equal(needsSpikes("build", ""), true);
		assert.equal(needsSpikes("build", "TypeScript/Node"), false);
		assert.equal(needsSpikes("reuse", undefined), false);
		assert.equal(needsSpikes("partial", undefined), false);
	});
});
