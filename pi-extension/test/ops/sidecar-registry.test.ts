/**
 * Sidecar registry shape tests (B3, Subphase 3.2).
 *
 * Guards the registry contract that ops/approve.ts consumes:
 * every entry must carry the full function set, and the RTM entry
 * must round-trip parse → validate → render → serialize with the
 * same behavior the old hardcoded RTM block had (D4 dual-read
 * detect, actionable validation issues).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { SIDECAR_REGISTRY } from "../../src/ops/sidecar-registry.js";

const VALID_RTM = [
	"project: TestApp",
	"version: 1.0.0",
	"rows:",
	"  - id: FR-01",
	"    title: FR-01 title",
	"    phase: 1",
	"    design: ''",
	"    implementation: ''",
	"    tests: []",
	"    status: proposed",
	"    coverage: covered",
	"",
].join("\n");

describe("SIDECAR_REGISTRY shape", () => {
	it("exposes entries keyed by artifact kind", () => {
		assert.deepEqual(Object.keys(SIDECAR_REGISTRY), [
			"RTM",
			"atomic-functions",
			"test-cases",
			"development-order",
		]);
		const entry = SIDECAR_REGISTRY.RTM!;
		assert.equal(entry.artifact, "RTM");
		assert.equal(entry.label, "RTM");
		for (const fn of [
			"detectWorkingSidecar",
			"parseAndValidate",
			"diff",
			"render",
			"sidecarName",
			"serialize",
			"loadPublishedBaseline",
			"postValidate",
		] as const) {
			assert.equal(typeof entry[fn], "function", `${fn} must be a function`);
		}
		const af = SIDECAR_REGISTRY["atomic-functions"]!;
		assert.equal(af.artifact, "atomic-functions");
		assert.equal(typeof af.validateWithCtx, "function");
		assert.equal(af.sidecarName("TestApp"), "atomic-functions_TestApp.yaml");
		assert.equal(
			af.detectWorkingSidecar(["atomic-functions_TestApp.yaml", "x.md"]),
			"atomic-functions_TestApp.yaml",
		);
		assert.equal(af.detectWorkingSidecar(["atomic-functions_TestApp.md"]), null);
	});

	it("detect prefers .yaml over legacy .json (D4)", () => {
		const entry = SIDECAR_REGISTRY.RTM!;
		assert.equal(
			entry.detectWorkingSidecar(["RTM_TestApp.json", "RTM_TestApp.yaml", "notes.md"]),
			"RTM_TestApp.yaml",
		);
		assert.equal(
			entry.detectWorkingSidecar(["RTM_TestApp.json", "RTM_TestApp.md"]),
			"RTM_TestApp.json",
		);
		assert.equal(entry.detectWorkingSidecar(["RTM_TestApp.md"]), null);
	});

	it("parseAndValidate accepts valid data and round-trips render/serialize", () => {
		const entry = SIDECAR_REGISTRY.RTM!;
		const parsed = entry.parseAndValidate(VALID_RTM);
		assert.ok(parsed.ok, `expected ok, got: ${parsed.issues.join("; ")}`);
		const rendered = entry.render(parsed.data);
		assert.match(rendered, /FR-01/);
		const serialized = entry.serialize(parsed.data);
		const reparsed = entry.parseAndValidate(serialized);
		assert.ok(reparsed.ok, "serialized sidecar must re-parse cleanly");
	});

	it("parseAndValidate reports actionable issues on invalid data", () => {
		const entry = SIDECAR_REGISTRY.RTM!;
		const bad = entry.parseAndValidate("project: TestApp\nversion: 1.0.0\nrows: []\n");
		// rows: [] is valid — check a genuinely broken document instead.
		assert.ok(bad.ok, "empty rows are valid");
		const notYaml = entry.parseAndValidate(":\n  - [unclosed");
		assert.equal(notYaml.ok, false);
		assert.ok(notYaml.issues.length > 0, "YAML errors surface as issues");
	});

	it("sidecarName is project-scoped and always .yaml (D4 writes)", () => {
		assert.equal(SIDECAR_REGISTRY.RTM!.sidecarName("TestApp"), "RTM_TestApp.yaml");
	});
});
