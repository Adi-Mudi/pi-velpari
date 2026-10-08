/**
 * PHASE 6 — preview tests (Phase 7 of atomic-function-layer plan).
 *
 * Verifies `stages/atomic-function/preview.ts:formatPreviewQuestion`:
 *
 *   - preview-options     — returns the 3 options (yes / no / edit)
 *   - preview-artifact    — returns the working-copy path
 *   - preview-doc-path    — mentions the Doc/ publish target
 *   - PREVIEW_OPTIONS     — exported tuple matches the 3 options
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { formatPreviewQuestion, PREVIEW_OPTIONS } from "../../../src/stages/atomic-function/preview.js";

const deps = {
	cwd: "/tmp/proj",
	runId: "2026-09-17-1200-test",
	projectName: "TestApp",
};

describe("formatPreviewQuestion — preview gate text", () => {
	it("contains the 3 preview options (yes / no / edit)", () => {
		const text = formatPreviewQuestion(deps);
		assert.match(text, /yes/);
		assert.match(text, /no/);
		assert.match(text, /edit/);
	});

	it("contains the working-copy path with project name", () => {
		const text = formatPreviewQuestion(deps);
		assert.match(text, /atomic-functions_TestApp\.md/);
	});

	it("contains the Doc/ publish target for the next stage", () => {
		const text = formatPreviewQuestion(deps);
		assert.match(text, /Doc\/atomic-functions\/atomic-functions_TestApp\.md/);
	});

	it("contains the runId (working-copy lives under <runDir>/)", () => {
		const text = formatPreviewQuestion(deps);
		assert.match(text, /2026-09-17-1200-test/);
	});

	it("contains the publish-tool auto-publish instruction for the yes option", () => {
		const text = formatPreviewQuestion(deps);
		assert.match(text, /parent LLM calls the publish tool/);
	});
});

describe("PREVIEW_OPTIONS — exported tuple", () => {
	it("contains exactly the 3 options in order", () => {
		assert.deepEqual([...PREVIEW_OPTIONS], ["yes", "no", "edit"]);
	});
});
