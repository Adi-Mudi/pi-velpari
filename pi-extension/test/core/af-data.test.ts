/**
 * core/af-data.ts tests (B3 — atomic-functions YAML sidecar).
 *
 * Covers: schema validation (base + tier-required fields), revision
 * rules (append-only ids, version bump, new-function status), render
 * round-trip, and the loose sidecar readers used by id-coverage (D7).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	diffAfData,
	extractAfIdsFromSidecar,
	renderAfMarkdown,
	resolveAfSidecar,
	validateAfData,
	type AfData,
} from "../../src/core/af-data.js";
import { parseYaml } from "../../src/core/yaml-data.js";

function af(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		afId: "AF-1",
		name: "parseInput",
		filePath: "src/parse.ts",
		signature: "function parseInput(s: string): string",
		purpose: "Parses input",
		source: "RTM",
		cohesion: "perfect-atomic",
		verification: "Test",
		testable: "yes",
		...overrides,
	};
}

function data(overrides: Record<string, unknown> = {}): AfData {
	return {
		project: "TestApp",
		version: "1.0.0",
		functions: [af()] as AfData["functions"],
		...overrides,
	} as AfData;
}

describe("validateAfData", () => {
	it("accepts a minimal valid document (base fields only)", () => {
		const result = validateAfData(data());
		assert.deepEqual(result.issues, []);
		assert.ok(result.ok);
	});

	it("rejects non-object documents and missing top-level fields", () => {
		assert.equal(validateAfData([1, 2]).ok, false);
		const result = validateAfData({ functions: [] });
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.startsWith("project:")));
		assert.ok(result.issues.some((i) => i.startsWith("version:")));
	});

	it("rejects a missing functions array", () => {
		const result = validateAfData({ project: "P", version: "1.0.0" });
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.startsWith("functions:")));
	});

	it("flags bad and duplicate afIds", () => {
		const bad = validateAfData(data({ functions: [af({ afId: "XX-1" })] }));
		assert.ok(bad.issues.some((i) => i.includes("afId: must match AF-<n>")));
		const dup = validateAfData(data({ functions: [af(), af()] }));
		assert.ok(dup.issues.some((i) => i.includes("duplicate id")));
	});

	it("flags missing base-core fields", () => {
		const fn = af();
		delete fn.purpose;
		const result = validateAfData(data({ functions: [fn] }));
		assert.ok(result.issues.some((i) => i.includes(".purpose:")));
	});

	it("enforces tier-required fields when a tier is supplied", () => {
		// basic tier adds calledByFrIds/designRef/extractedFrom/
		// satisfactionFrId/feasibilityRef — all missing here.
		const result = validateAfData(data(), { tier: "basic" });
		assert.equal(result.ok, false);
		assert.ok(result.issues.some((i) => i.includes(".calledByFrIds:")));
		assert.ok(result.issues.some((i) => i.includes(".feasibilityRef:")));
		// entry tier requires only the base core — the same doc passes.
		assert.ok(validateAfData(data(), { tier: "entry" }).ok);
	});

	it("accepts tier fields when present (basic)", () => {
		const fn = af({
			calledByFrIds: ["FR-1"],
			designRef: "M-1",
			extractedFrom: "HF-01",
			satisfactionFrId: "FR-1",
			feasibilityRef: "",
		});
		// feasibilityRef empty string → still flagged (present but empty).
		const flagged = validateAfData(data({ functions: [fn] }), { tier: "basic" });
		assert.ok(flagged.issues.some((i) => i.includes(".feasibilityRef:")));
		fn.feasibilityRef = "§4";
		assert.ok(validateAfData(data({ functions: [fn] }), { tier: "basic" }).ok);
	});

	it("type-checks array and number tier fields when present", () => {
		const result = validateAfData(data({ functions: [af({ calledByFrIds: "FR-1", complexity: "high" })] }));
		assert.ok(result.issues.some((i) => i.includes(".calledByFrIds: must be an array")));
		assert.ok(result.issues.some((i) => i.includes(".complexity: must be a number")));
	});

	it("enforces the status vocabulary and deprecated-reason rule", () => {
		const badStatus = validateAfData(data({ functions: [af({ status: "gone" })] }));
		assert.ok(badStatus.issues.some((i) => i.includes(".status: must be one of")));
		const noReason = validateAfData(data({ functions: [af({ status: "deprecated" })] }));
		assert.ok(noReason.issues.some((i) => i.includes(".reason:")));
		const withReason = validateAfData(
			data({ functions: [af({ status: "deprecated", reason: "superseded by AF-2" })] }),
		);
		assert.ok(withReason.ok);
	});

	it("rejects an unknown tier value", () => {
		const result = validateAfData(data({ tier: "gold" as never }));
		assert.ok(result.issues.some((i) => i.startsWith("tier:")));
	});
});

describe("diffAfData", () => {
	it("passes a clean revision (append + version bump)", () => {
		const baseline = data();
		const updated = data({
			version: "1.1.0",
			functions: [af(), af({ afId: "AF-2", name: "b" })] as AfData["functions"],
		});
		assert.deepEqual(diffAfData(baseline, updated).issues, []);
	});

	it("blocks deleting a baseline function (append-only)", () => {
		const baseline = data({
			functions: [af(), af({ afId: "AF-2", name: "b" })] as AfData["functions"],
		});
		const updated = data({ version: "1.1.0" });
		const result = diffAfData(baseline, updated);
		assert.ok(result.issues.some((i) => i.includes("append-only violation") && i.includes("AF-2")));
	});

	it("blocks a new function that starts with a non-proposed status", () => {
		const baseline = data();
		const updated = data({
			version: "1.1.0",
			functions: [af(), af({ afId: "AF-2", name: "b", status: "approved" })] as AfData["functions"],
		});
		const result = diffAfData(baseline, updated);
		assert.ok(result.issues.some((i) => i.includes('"AF-2" must start with status "proposed"')));
	});

	it("blocks a revision without a version bump", () => {
		const result = diffAfData(data(), data());
		assert.ok(result.issues.some((i) => i.includes("version must strictly increase")));
	});
});

describe("renderAfMarkdown", () => {
	it("renders frontmatter, summary, table and change log", () => {
		const rendered = renderAfMarkdown(data({ tier: "entry", changeLog: ["1.0.0 — initial"] }));
		assert.match(rendered, /artifact: atomic-functions/);
		assert.match(rendered, /atomicTier: entry/);
		assert.match(rendered, /# Atomic Functions — TestApp/);
		assert.match(rendered, /\| AF ID \| Name \| File Path \|/);
		assert.match(rendered, /\| AF-1 \| parseInput \|/);
		assert.match(rendered, /## Change Log/);
	});

	it("renders tier columns when the tier adds fields", () => {
		const fn = af({
			calledByFrIds: ["FR-1", "FR-2"],
			designRef: "M-1",
			extractedFrom: "HF-01",
			satisfactionFrId: "FR-1",
			feasibilityRef: "§4",
		});
		const rendered = renderAfMarkdown(data({ tier: "basic", functions: [fn] as AfData["functions"] }));
		assert.match(rendered, /Called by FRs/);
		assert.match(rendered, /FR-1, FR-2/);
	});

	it("keeps extra record fields as columns (no authored data dropped)", () => {
		const rendered = renderAfMarkdown(data({ functions: [af({ owner: "div" })] as AfData["functions"] }));
		assert.match(rendered, /\| Owner \|/);
		assert.match(rendered, /\| div \|/);
	});

	it("round-trips through the YAML parser shape", () => {
		// The rendered table is derived data; the sidecar is the source.
		// A re-validated copy of the input data must still validate.
		const input = data({ tier: "entry" });
		const parsed = parseYaml(JSON.stringify(input));
		assert.ok(parsed.ok);
		assert.ok(validateAfData(parsed.data, { tier: "entry" }).ok);
	});
});

describe("sidecar resolution (D7 readers)", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-af-data-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("resolveAfSidecar finds the .yaml next to the markdown", () => {
		const md = path.join(tmpDir, "atomic-functions_TestApp.md");
		fs.writeFileSync(md, "# AF\n", "utf8");
		assert.equal(resolveAfSidecar(md), null);
		const yaml = path.join(tmpDir, "atomic-functions_TestApp.yaml");
		fs.writeFileSync(yaml, "project: TestApp\n", "utf8");
		assert.equal(resolveAfSidecar(md), yaml);
	});

	it("extractAfIdsFromSidecar returns sorted unique ids, null on junk", () => {
		const md = path.join(tmpDir, "atomic-functions_TestApp.md");
		assert.equal(extractAfIdsFromSidecar(md), null);
		const yaml = path.join(tmpDir, "atomic-functions_TestApp.yaml");
		fs.writeFileSync(yaml, "not: [an af doc]\n", "utf8");
		assert.equal(extractAfIdsFromSidecar(md), null);
		fs.writeFileSync(
			yaml,
			[
				"project: TestApp",
				"version: 1.0.0",
				"functions:",
				"  - afId: AF-2",
				"  - afId: AF-1",
				"  - afId: AF-2",
				"  - afId: bogus",
				"",
			].join("\n"),
			"utf8",
		);
		assert.deepEqual(extractAfIdsFromSidecar(md), ["AF-1", "AF-2"]);
	});
});
