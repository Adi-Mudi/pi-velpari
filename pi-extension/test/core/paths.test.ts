/**
 * Path helper tests for the feasibility-skip detection.
 *
 * Covers hasPublishedFeasibility:
 *   - true when the grouped Doc/feasibility/ artifact exists
 *   - true when only the legacy flat Doc/ artifact exists (fallback)
 *   - false when neither exists
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hasPublishedFeasibility } from "../../src/core/paths.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-paths-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("hasPublishedFeasibility", () => {
	it("returns true when the grouped feasibility doc exists", () => {
		const dir = path.join(tmpDir, "Doc", "feasibility");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "feasibility-study_TestApp.md"), "# Feasibility\n");
		assert.equal(hasPublishedFeasibility(tmpDir, "TestApp"), true);
	});

	it("returns true when only the legacy flat doc exists", () => {
		const dir = path.join(tmpDir, "Doc");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "feasibility-study_TestApp.md"), "# Feasibility\n");
		assert.equal(hasPublishedFeasibility(tmpDir, "TestApp"), true);
	});

	it("returns false when no feasibility doc exists", () => {
		assert.equal(hasPublishedFeasibility(tmpDir, "TestApp"), false);
	});
});
