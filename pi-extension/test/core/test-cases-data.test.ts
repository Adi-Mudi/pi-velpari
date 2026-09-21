/**
 * core/test-cases-data.ts tests (B3 — test-cases YAML sidecar).
 *
 * Covers: schema validation (TC/IT ids, mandatory traces), revision
 * rules (append-only ids, version bump), render (two-table shape the
 * id-coverage Traces scraping consumes), and the loose sidecar reader.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	diffTestCasesData,
	extractTestCaseTracesFromSidecar,
	renderTestCasesMarkdown,
	resolveTestCasesSidecar,
	validateTestCasesData,
	type TestCasesData,
} from "../../src/core/test-cases-data.js";

function tc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "TC-1",
		name: "createUser with valid input returns userId",
		target: "M-1.createUser",
		steps: "1. call 2. assert",
		expected: "userId (UUID)",
		edgeCases: "valid input",
		traces: ["FR-1", "AF-1"],
		...overrides,
	};
}

function it_(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "IT-1",
		name: "signup flow: auth → email",
		target: "signup",
		modules: ["M-1", "M-2"],
		steps: "...",
		expected: "email sent within 5s",
		traces: ["FR-1", "NFR-2"],
		...overrides,
	};
}

function data(overrides: Record<string, unknown> = {}): TestCasesData {
	return {
		project: "TestApp",
		version: "1.0.0",
		unitTests: [tc()] as unknown as TestCasesData["unitTests"],
		integrationTests: [it_()] as unknown as TestCasesData["integrationTests"],
		...overrides,
	} as TestCasesData;
}

describe("validateTestCasesData", () => {
	it("accepts a valid document", () => {
		const result = validateTestCasesData(data());
		assert.deepEqual(result.issues, []);
		assert.ok(result.ok);
	});

	it("rejects missing lists and top-level fields", () => {
		const result = validateTestCasesData({ project: "P" });
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.startsWith("version:")));
		assert.ok(result.issues.some((i) => i.startsWith("unitTests:")));
		assert.ok(result.issues.some((i) => i.startsWith("integrationTests:")));
	});

	it("flags bad ids and cross-list duplicates", () => {
		const bad = validateTestCasesData(data({ unitTests: [tc({ id: "IT-9" })] }));
		assert.ok(bad.issues.some((i) => i.includes("unitTests[0].id: must match TC-<n>")));
		const dup = validateTestCasesData(data({ integrationTests: [it_({ id: "TC-1" })] }));
		// IT list id must match IT-<n> AND collides with the unit id.
		assert.equal(dup.ok, false);
	});

	it("requires name/target/steps/expected", () => {
		const result = validateTestCasesData(data({ unitTests: [tc({ name: "", steps: 3 })] }));
		assert.ok(result.issues.some((i) => i.includes(".name:")));
		assert.ok(result.issues.some((i) => i.includes(".steps:")));
	});

	it("mandates a non-empty traces list with valid ids (Layer-2)", () => {
		const missing = validateTestCasesData(data({ unitTests: [tc({ traces: [] })] }));
		assert.ok(missing.issues.some((i) => i.includes(".traces: mandatory")));
		const badId = validateTestCasesData(data({ unitTests: [tc({ traces: ["XX-1"] })] }));
		assert.ok(badId.issues.some((i) => i.includes(".traces: every entry must match")));
	});

	it("type-checks edgeCases (unit) and modules (integration)", () => {
		const result = validateTestCasesData(
			data({
				unitTests: [tc({ edgeCases: 5 })],
				integrationTests: [it_({ modules: "M-1" })],
			}),
		);
		assert.ok(result.issues.some((i) => i.includes(".edgeCases: must be a string")));
		assert.ok(result.issues.some((i) => i.includes(".modules: must be an array")));
	});
});

describe("diffTestCasesData", () => {
	it("passes an append + version bump", () => {
		const updated = data({
			version: "1.1.0",
			unitTests: [tc(), tc({ id: "TC-2", name: "second" })] as unknown as TestCasesData["unitTests"],
		});
		assert.deepEqual(diffTestCasesData(data(), updated).issues, []);
	});

	it("blocks deleting a baseline test (append-only)", () => {
		const baseline = data({
			unitTests: [tc(), tc({ id: "TC-2", name: "second" })] as unknown as TestCasesData["unitTests"],
		});
		const result = diffTestCasesData(baseline, data({ version: "1.1.0" }));
		assert.ok(result.issues.some((i) => i.includes("append-only violation") && i.includes("TC-2")));
	});

	it("blocks a revision without a version bump", () => {
		assert.ok(diffTestCasesData(data(), data()).issues.some((i) => i.includes("version must strictly increase")));
	});
});

describe("renderTestCasesMarkdown", () => {
	it("renders the two-table shape the id-coverage Traces scraping consumes", () => {
		const rendered = renderTestCasesMarkdown(data({ changeLog: ["1.0.0 — initial"] }));
		assert.match(rendered, /artifact: test-cases/);
		assert.match(rendered, /## Unit Tests/);
		assert.match(rendered, /\| TC ID \| Name \| Target \| Steps \| Expected \| Edge Cases \| Traces \|/);
		assert.match(rendered, /\| TC-1 \| createUser with valid input returns userId \|/);
		assert.match(rendered, /## Integration Tests/);
		assert.match(rendered, /\| IT-1 \| signup flow/);
		assert.match(rendered, /FR-1, AF-1/);
		assert.match(rendered, /## Change Log/);
	});
});

describe("sidecar resolution (D7 reader)", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-tc-data-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("resolveTestCasesSidecar finds the .yaml next to the markdown", () => {
		const md = path.join(tmpDir, "test-cases_TestApp.md");
		fs.writeFileSync(md, "# TC\n", "utf8");
		assert.equal(resolveTestCasesSidecar(md), null);
		const yaml = path.join(tmpDir, "test-cases_TestApp.yaml");
		fs.writeFileSync(yaml, "project: TestApp\n", "utf8");
		assert.equal(resolveTestCasesSidecar(md), yaml);
	});

	it("extractTestCaseTracesFromSidecar unions both lists, null on junk", () => {
		const md = path.join(tmpDir, "test-cases_TestApp.md");
		assert.equal(extractTestCaseTracesFromSidecar(md), null);
		const yaml = path.join(tmpDir, "test-cases_TestApp.yaml");
		fs.writeFileSync(yaml, "not: [a tc doc]\n", "utf8");
		assert.equal(extractTestCaseTracesFromSidecar(md), null);
		fs.writeFileSync(
			yaml,
			[
				"project: TestApp",
				"version: 1.0.0",
				"unitTests:",
				"  - id: TC-1",
				"    traces: [FR-1, AF-1]",
				"integrationTests:",
				"  - id: IT-1",
				"    traces: [NFR-2, FR-1]",
				"",
			].join("\n"),
			"utf8",
		);
		assert.deepEqual(extractTestCaseTracesFromSidecar(md), ["FR-1", "AF-1", "NFR-2", "FR-1"]);
	});
});
