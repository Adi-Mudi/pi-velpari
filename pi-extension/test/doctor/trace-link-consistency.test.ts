/**
 * RTM↔test-cases link consistency tests (audit item c8 — D3).
 *
 * Covers:
 *   - symmetric links → ok summary
 *   - RTM-only link (tests[] lists a test that does not trace back) → warning
 *   - TC-only link (traces a requirement whose RTM row does not list it) → warning
 *   - AF-N traces excluded (no RTM row counterpart)
 *   - either sidecar absent → info skip (legacy)
 *   - invalid sidecar YAML → info skip (per-artifact check owns the error)
 *   - missing project name → info skip
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkTraceLinkConsistencySection } from "../../src/doctor/checks/trace-link-consistency.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-trace-link-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Legacy flat Doc/ layout resolves via resolveDocArtifact's fallback. */
function writeRtm(testsByReq: Record<string, string[]>): void {
	const dir = path.join(tmpDir, "Doc");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "RTM_TestApp.md"), "# RTM\n", "utf8");
	const rows = Object.entries(testsByReq)
		.map(([id, tests]) => `  - id: ${id}\n    title: t\n    phase: 1\n    tests: [${tests.join(", ")}]`)
		.join("\n");
	fs.writeFileSync(path.join(dir, "RTM_TestApp.yaml"), `project: TestApp\nversion: "1.0"\nrows:\n${rows}\n`, "utf8");
}

function writeTestCases(unit: Array<{ id: string; traces: string[] }>, opts: { rawYaml?: string } = {}): void {
	const dir = path.join(tmpDir, "Doc");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "test-cases_TestApp.md"), "# TC\n", "utf8");
	const body =
		opts.rawYaml ??
		`project: TestApp\nversion: "1.0"\nunitTests:\n${unit
			.map(
				(r) =>
					`  - id: ${r.id}\n    name: n\n    target: M-1.f\n    steps: s\n    expected: e\n    traces: [${r.traces.join(", ")}]`,
			)
			.join("\n")}\nintegrationTests: []\n`;
	fs.writeFileSync(path.join(dir, "test-cases_TestApp.yaml"), body, "utf8");
}

describe("checkTraceLinkConsistencySection", () => {
	it("symmetric links → ok summary, no warnings", () => {
		writeRtm({ "FR-1": ["TC-1"] });
		writeTestCases([{ id: "TC-1", traces: ["FR-1"] }]);
		const section = checkTraceLinkConsistencySection(tmpDir, "TestApp");
		assert.equal(section.title, "RTM↔test-cases link consistency");
		assert.equal(section.items.filter((i) => i.status === "warning").length, 0);
		const summary = section.items[section.items.length - 1]!;
		assert.equal(summary.status, "ok");
		assert.match(summary.message, /1 link\(s\) checked, all symmetric/);
	});

	it("RTM-only link → warning naming both directions", () => {
		writeRtm({ "FR-1": ["TC-1", "TC-2"] });
		writeTestCases([{ id: "TC-1", traces: ["FR-1"] }]);
		const section = checkTraceLinkConsistencySection(tmpDir, "TestApp");
		const warnings = section.items.filter((i) => i.status === "warning");
		assert.equal(warnings.length, 1);
		assert.match(warnings[0]!.message, /RTM-only link: RTM row FR-1 tests\[\] lists TC-2/);
		assert.match(warnings[0]!.suggestion ?? "", /authority/);
	});

	it("TC-only link → warning naming both directions", () => {
		writeRtm({ "FR-1": ["TC-1"] });
		writeTestCases([{ id: "TC-1", traces: ["FR-1", "FR-2"] }]);
		const section = checkTraceLinkConsistencySection(tmpDir, "TestApp");
		const warnings = section.items.filter((i) => i.status === "warning");
		assert.equal(warnings.length, 1);
		assert.match(warnings[0]!.message, /TC-only link: TC-1 traces FR-2/);
	});

	it("AF-N traces are excluded (no RTM row counterpart)", () => {
		writeRtm({ "FR-1": ["TC-1"] });
		writeTestCases([{ id: "TC-1", traces: ["FR-1", "AF-3"] }]);
		const section = checkTraceLinkConsistencySection(tmpDir, "TestApp");
		assert.equal(section.items.filter((i) => i.status === "warning").length, 0);
	});

	it("RTM sidecar absent → info skip (legacy)", () => {
		const dir = path.join(tmpDir, "Doc");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "RTM_TestApp.md"), "# RTM\n", "utf8");
		writeTestCases([{ id: "TC-1", traces: ["FR-1"] }]);
		const section = checkTraceLinkConsistencySection(tmpDir, "TestApp");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "info");
		assert.match(section.items[0]!.message, /skipped — RTM sidecar absent/);
	});

	it("test-cases sidecar absent → info skip (legacy)", () => {
		writeRtm({ "FR-1": ["TC-1"] });
		const dir = path.join(tmpDir, "Doc");
		fs.writeFileSync(path.join(dir, "test-cases_TestApp.md"), "# TC\n", "utf8");
		const section = checkTraceLinkConsistencySection(tmpDir, "TestApp");
		assert.equal(section.items.length, 1);
		assert.match(section.items[0]!.message, /test-cases sidecar absent/);
	});

	it("invalid sidecar YAML → info skip (per-artifact check owns the error)", () => {
		writeRtm({ "FR-1": ["TC-1"] });
		writeTestCases([], { rawYaml: ":\n  - broken: [" });
		const section = checkTraceLinkConsistencySection(tmpDir, "TestApp");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "info");
		assert.match(section.items[0]!.message, /not valid YAML/);
	});

	it("missing project name → info skip", () => {
		const section = checkTraceLinkConsistencySection(tmpDir, "");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "info");
		assert.match(section.items[0]!.message, /project name missing/);
	});
});
