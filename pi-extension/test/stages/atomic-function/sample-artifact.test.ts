/**
 * Gap C — sample artifact schema validation.
 *
 * Validates `Doc/test-fixtures/atomic-functions_TestApp.md` follows the
 * basic-tier schema (8 base-core + 5 cross-ref = 13 columns). This
 * fixture proves the tier-aware schema produces a real, publishable
 * Doc/atomic-functions/<project>.md artifact.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

import { BASE_CORE_FIELDS, requiredFieldsFor, tableHeader } from "../../../src/stages/atomic-function/merge.js";

const fixturePath = path.resolve(
	process.cwd(),
	"Doc/test-fixtures/atomic-functions_TestApp.md",
);

describe("sample atomic-functions artifact (basic tier)", () => {
	const content = fs.readFileSync(fixturePath, "utf8");

	it("exists on disk", () => {
		assert.ok(fs.existsSync(fixturePath));
	});

	it("frontmatter declares tier=basic", () => {
		assert.match(content, /^artifact: atomic-functions$/m);
		assert.match(content, /^atomicTier: basic$/m);
		assert.match(content, /^project: TestApp$/m);
	});

	it("table header has all 14 columns (8 base-core + File Path + 5 basic-tier)", () => {
		// Find the table header line (contains "AF ID | Name | ...")
		const headerLine = content
			.split("\n")
			.find((l) => l.startsWith("| AF ID |"))!;
		const columns = headerLine.split("|").map((c) => c.trim()).filter(Boolean);
		assert.equal(columns.length, 14, `expected 14 columns, got ${columns.length}: ${columns.join(", ")}`);
		// The 9 base-core columns (8 + File Path) come first.
		for (const required of [
			"AF ID",
			"Name",
			"File Path",
			"Signature",
			"Purpose",
			"Source",
			"Cohesion",
			"Verification",
			"Testable",
		]) {
			assert.ok(columns.includes(required), `missing base-core column ${required}`);
		}
		// 5 basic-tier cross-ref columns are present.
		for (const required of [
			"Called by FRs",
			"Design ref",
			"Extracted from",
			"Satisfies FR",
			"Feasibility ref",
		]) {
			assert.ok(columns.includes(required), `missing basic-tier column ${required}`);
		}
	});

	it("contains 3 atomic function rows (AF-1, AF-2, AF-3)", () => {
		assert.match(content, /\| AF-1 \|/);
		assert.match(content, /\| AF-2 \|/);
		assert.match(content, /\| AF-3 \|/);
	});

	it("every AF row populates all 14 columns", () => {
		// Find the main-table body rows (start with "| AF-<digit>" AND
		// have at least 10 pipes = 14 cells). Excludes the cross-reference
		// table which only has 3 cells.
		const allRows = content.split("\n").filter((l) => l.startsWith("| AF-"));
		const rows = allRows.filter((l) => /^\|\s*AF-\d+\s*\|/.test(l) && l.split("|").length >= 10);
		assert.equal(rows.length, 3, `expected 3 main-table AF rows, got ${rows.length}. All AF lines: ${allRows.length}`);

		// Every AF row has all 14 non-empty cells.
		for (const row of rows) {
			const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
			assert.equal(
				cells.length,
				14,
				`AF row has ${cells.length} cells, expected 14: ${row.slice(0, 80)}`,
			);
		}
	});

	it("tableHeader() helper produces 13 columns (the schema math)", () => {
		// tableHeader uses requiredFieldsFor which counts only the 8 BASE_CORE_FIELDS
		// + 5 basic-tier fields = 13. The fixture table uses the same 13 base + cross-ref
		// columns plus "File Path" as a 9th base-core column that the schema math
		// does not yet include (the skill markdown template adds it).
		const header = tableHeader("basic");
		const columns = header.split("|").map((c) => c.trim()).filter(Boolean);
		assert.equal(columns.length, 13);
	});

	it("requiredFieldsFor(basic) returns the 13 column names", () => {
		const fields = requiredFieldsFor("basic");
		assert.equal(fields.length, 13);
		assert.deepEqual(fields.slice(0, 8), [...BASE_CORE_FIELDS]);
	});

	it("Change Log section has at least one entry", () => {
		assert.match(content, /## Change Log/);
		const changeLogSection = content.split("## Change Log")[1] ?? "";
		assert.match(changeLogSection, /\| 1\.0\.0 \|/);
	});

	it("Cross-references section lists AF usage", () => {
		assert.match(content, /## Cross-references/);
		assert.match(content, /\| AF-1 \|/);
	});

	it("cumulative: 8 + 5 = 13 basic-tier fields", () => {
		// Sanity-check the schema math.
		assert.equal(BASE_CORE_FIELDS.length, 8);
		assert.equal(requiredFieldsFor("entry").length, 8);
		assert.equal(requiredFieldsFor("basic").length, 8 + 5);
		assert.equal(requiredFieldsFor("intermediate").length, 8 + 5 + 11);
		assert.equal(requiredFieldsFor("advanced").length, 8 + 5 + 11 + 11);
	});
});