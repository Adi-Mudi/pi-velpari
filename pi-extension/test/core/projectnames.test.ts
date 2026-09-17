/**
 * core/projectnames.ts branch coverage tests (closes the v1.3.0+ multi-design
 * rejection branch gaps).
 *
 * The `getEffectiveProjectNames` function has 5 distinct rejection branches:
 *   1. Both projectName and projectNames are set
 *   2. Neither is set
 *   3. projectNames is empty array
 *   4. projectNames contains a non-string entry
 *   5. projectNames contains an empty-string entry
 *
 * The existing config.test.ts covers branches 1 and 2; this file drives
 * branches 3, 4, and 5 plus the dedup-of-empty-string edge case.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { FilesConfig } from "../../src/core/config.js";
import { getEffectiveProjectNames } from "../../src/core/projectnames.js";

/** Build a minimal v4 config; caller sets `projectName` or `projectNames`. */
function cfg(projectName: string, projectNames?: string[]): FilesConfig {
	const out = { ...VALID_V4_BASE, projectName } as FilesConfig;
	if (projectNames !== undefined) {
		(out as unknown as { projectNames?: string[] }).projectNames = projectNames;
	}
	return out;
}

const VALID_V4_BASE = {
	version: 4,
	codePaths: [],
	inputDocuments: [],
	testPaths: [],
	outputPaths: {},
	excludedPaths: [],
};

describe("getEffectiveProjectNames — additional rejection branches", () => {
	it("throws when projectNames is an empty array (and projectName is empty)", () => {
		assert.throws(
			() => getEffectiveProjectNames(cfg("", [])),
			/must set either/,
			"empty projectNames array (with empty projectName) throws as 'neither set'",
		);
	});

	it("throws when a projectNames entry is not a string", () => {
		assert.throws(
			() => getEffectiveProjectNames(cfg("", ["alpha", 42 as unknown as string, "gamma"])),
			/non-empty strings/,
			"non-string entry must throw",
		);
	});

	it("throws when a projectNames entry is an empty string", () => {
		assert.throws(
			() => getEffectiveProjectNames(cfg("", ["alpha", "", "gamma"])),
			/non-empty strings/,
			"empty-string entry must throw",
		);
	});

	it("de-duplicates while preserving first occurrence order", () => {
		const out = getEffectiveProjectNames(cfg("", ["b", "a", "b", "c", "a"]));
		assert.deepEqual(out, ["b", "a", "c"]);
	});

	it("accepts a single-entry multi-design array (legacy single-name + new format)", () => {
		const out = getEffectiveProjectNames(cfg("", ["onlyOne"]));
		assert.deepEqual(out, ["onlyOne"]);
	});
});
