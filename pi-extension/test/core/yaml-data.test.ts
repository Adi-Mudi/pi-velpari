/**
 * YAML sidecar I/O tests (B3 — yaml-data; D1/D2).
 *
 * Covers:
 *   - parseYaml: round-trip of flat schemas, malformed-input error quality
 *     (line/column numbers), comments preserved as parseable input
 *   - readYamlFile: missing → null, malformed → null, valid → data
 *   - writeYamlFile: atomic write, output re-parses to the same data,
 *     long strings are not folded (lineWidth: 0)
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseYaml, readYamlFile, writeYamlFile } from "../../src/core/yaml-data.js";

const FLAT = {
	project: "TestApp",
	version: "1.0.0",
	rows: [
		{ id: "FR-1", title: "Add expense", phase: 1, tests: ["TC-1", "TC-2"] },
		{ id: "FR-2", title: "List expenses", phase: 1, tests: [] },
	],
};

describe("parseYaml", () => {
	it("round-trips a flat schema", () => {
		const text = [
			"project: TestApp",
			"version: 1.0.0",
			"rows:",
			"  - id: FR-1",
			"    title: Add expense",
			"    phase: 1",
			"    tests:",
			"      - TC-1",
			"      - TC-2",
			"  - id: FR-2",
			"    title: List expenses",
			"    phase: 1",
			"    tests: []",
			"",
		].join("\n");
		const result = parseYaml(text);
		assert.ok(result.ok);
		assert.deepEqual(result.data, FLAT);
	});

	it("accepts YAML comments (Q8 — human-authored files)", () => {
		const result = parseYaml("# a comment\nproject: TestApp # inline\nversion: 1.0.0\nrows: []\n");
		assert.ok(result.ok);
		assert.deepEqual(result.data, { project: "TestApp", version: "1.0.0", rows: [] });
	});

	it("reports malformed input with line + column numbers", () => {
		const result = parseYaml("project: TestApp\nrows:\n  - id: FR-1\n   bad: [unclosed\n");
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.match(result.error, /line \d+, column \d+/);
		}
	});

	it("reports a tab-indentation error with a position", () => {
		const result = parseYaml("rows:\n\t- id: FR-1\n");
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.error, /line \d+/);
	});
});

describe("readYamlFile", () => {
	it("returns null for a missing file", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-yaml-"));
		assert.equal(readYamlFile(join(cwd, "nope.yaml")), null);
	});

	it("returns null for a malformed file (loose reader)", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-yaml-"));
		const p = join(cwd, "bad.yaml");
		writeFileSync(p, "rows:\n  - [unclosed\n");
		assert.equal(readYamlFile(p), null);
	});

	it("returns the parsed data for a valid file", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-yaml-"));
		const p = join(cwd, "ok.yaml");
		writeFileSync(p, "project: TestApp\nversion: 1.0.0\nrows: []\n");
		assert.deepEqual(readYamlFile(p), { project: "TestApp", version: "1.0.0", rows: [] });
	});
});

describe("writeYamlFile", () => {
	it("writes atomically and the output re-parses to the same data", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-yaml-"));
		const p = join(cwd, "sub", "dir", "out.yaml");
		writeYamlFile(p, FLAT);
		assert.ok(existsSync(p), "parent dirs created");
		assert.deepEqual(readYamlFile(p), FLAT);
	});

	it("does not fold long strings (lineWidth: 0)", () => {
		const cwd = mkdtempSync(join(tmpdir(), "velpari-yaml-"));
		const long = "x".repeat(200);
		const p = join(cwd, "long.yaml");
		writeYamlFile(p, { note: long });
		const text = readFileSync(p, "utf8");
		assert.ok(text.includes(long), "the long string stays on one line");
		assert.deepEqual(readYamlFile(p), { note: long });
	});
});
