/**
 * Doctor freshness-section tests (B4 + A3).
 *
 * Asserts:
 *   - fresh project → ok, nothing tracked
 *   - stamped + untouched → ok summary "0 stale / N tracked"
 *   - input-changed / input-missing → error items + summary line
 *   - legacy artifacts (no stamp / no manifest entry) → warning, not error (D7)
 *   - logging-plan present → info note (D5 known gap)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkFreshnessSection } from "../../src/doctor/checks/freshness.js";
import { hashFileContent } from "../../src/core/fingerprints.js";
import { recordPublish } from "../../src/core/freshness.js";
import { runPublishGate } from "../../src/doctor/gate.js";
import { createRun } from "../../src/core/state.js";

let tmpDir: string;

function publish(rel: string, content: string): string {
	const abs = path.join(tmpDir, "Doc", rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf8");
	return abs;
}

function publishStampedRtm(): { prdPath: string; rtmPath: string } {
	const prdPath = publish("requirements/PRD_TestApp.md", "# PSRS\n");
	const rtmPath = publish("requirements/RTM_TestApp.md", "# RTM\n");
	// Both artifacts stamped — an unstamped disk artifact shows as legacy
	// no-stamp (D7), which is covered by its own test below.
	recordPublish(tmpDir, {
		artifact: "prd",
		projectName: "TestApp",
		path: path.join("Doc", "requirements", "PRD_TestApp.md"),
		publishedAt: "2026-09-20T17:00:00.000Z",
		inputs: {},
	});
	recordPublish(tmpDir, {
		artifact: "rtm",
		projectName: "TestApp",
		path: path.join("Doc", "requirements", "RTM_TestApp.md"),
		publishedAt: "2026-09-20T17:00:00.000Z",
		inputs: { "prd:TestApp": hashFileContent(prdPath)! },
	});
	return { prdPath, rtmPath };
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-freshness-doc-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("checkFreshnessSection", () => {
	it("fresh project → ok, nothing tracked", () => {
		const section = checkFreshnessSection(tmpDir);
		assert.equal(section.title, "Freshness (stale set)");
		const last = section.items.at(-1)!;
		assert.equal(last.status, "ok");
		assert.match(last.message, /No published artifacts tracked yet/);
	});

	it("stamped + untouched → ok '0 stale / N tracked'", () => {
		publishStampedRtm();
		const section = checkFreshnessSection(tmpDir);
		assert.ok(section.items.every((i) => i.status !== "error"));
		const last = section.items.at(-1)!;
		assert.equal(last.status, "ok");
		assert.match(last.message, /0 stale \/ 2 tracked/);
	});

	it("input-changed → error naming the changed input", () => {
		const { prdPath } = publishStampedRtm();
		fs.writeFileSync(prdPath, "# PSRS v2\n", "utf8");
		const section = checkFreshnessSection(tmpDir);
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 1);
		assert.match(errors[0]!.message, /rtm:TestApp: stale \(input-changed\)/);
		assert.match(errors[0]!.message, /prd:TestApp/);
		assert.match(errors[0]!.suggestion ?? "", /Republish/);
		assert.match(errors[0]!.suggestion ?? "", /\/velpari-reconfirm/);
		assert.match(section.items.at(-1)!.message, /1 stale \/ 2 tracked/);
	});

	it("input-missing → error with input-missing reason and the republish-only suggestion (D4)", () => {
		const { prdPath } = publishStampedRtm();
		fs.rmSync(prdPath);
		const section = checkFreshnessSection(tmpDir);
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 1);
		assert.match(errors[0]!.message, /input-missing/);
		assert.match(errors[0]!.suggestion ?? "", /Republish/);
		assert.doesNotMatch(errors[0]!.suggestion ?? "", /velpari-reconfirm`/);
	});

	it("legacy published artifact without a manifest entry → warning, not error (D7)", () => {
		publish("design/design_TestApp.md", "# design\n");
		const section = checkFreshnessSection(tmpDir);
		const warnings = section.items.filter((i) => i.status === "warning");
		assert.equal(warnings.length, 1);
		assert.match(warnings[0]!.message, /design:TestApp: no freshness stamp/);
		assert.ok(section.items.every((i) => i.status !== "error"));
	});

	it("manifest entry without an inputs map → warning no-stamp", () => {
		recordPublish(tmpDir, {
			artifact: "design",
			projectName: "TestApp",
			path: path.join("Doc", "design", "design_TestApp.md"),
			publishedAt: "2026-09-20T17:00:00.000Z",
		});
		const section = checkFreshnessSection(tmpDir);
		const warnings = section.items.filter((i) => i.status === "warning");
		assert.equal(warnings.length, 1);
		assert.match(warnings[0]!.message, /design:TestApp: no freshness stamp/);
	});

	it("logging-plan present → info note (D5), never an error", () => {
		publish("observability/logging-plan_TestApp.md", "# logging plan\n");
		const section = checkFreshnessSection(tmpDir);
		assert.ok(section.items.some((i) => i.status === "info" && /logging-plan/.test(i.message)));
		assert.ok(section.items.every((i) => i.status !== "error"));
		// Excluded from tracking (D5) — no no-stamp warning for it either.
		assert.ok(section.items.every((i) => !/logging-plan.*no freshness stamp/.test(i.message)));
	});
});

describe("runPublishGate — freshness branch (A3)", () => {
	it("refuses to publish when a declared input is missing", () => {
		createRun("Test mission", tmpDir); // state carries the mission for slug resolution
		const result = runPublishGate({
			artifact: "RTM",
			workingContent: "# RTM\n",
			rtmData: null,
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.ok(
			result.errors.some((e) => e.includes("freshness-input-missing") && e.includes("prd:TestApp")),
			`expected freshness-input-missing error, got: ${result.errors.join(" | ")}`,
		);
	});

	it("passes the freshness branch when declared inputs exist", () => {
		createRun("Test mission", tmpDir);
		publish("requirements/PRD_TestApp.md", "# PSRS\n");
		const result = runPublishGate({
			artifact: "RTM",
			workingContent: "# RTM\n",
			rtmData: null,
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.ok(!result.errors.some((e) => e.includes("freshness-input-missing")));
	});

	it("warns about downstream artifacts that will become stale on republish", () => {
		createRun("Test mission", tmpDir);
		const prdPath = publish("requirements/PRD_TestApp.md", "# PSRS\n");
		// RTM was published against the current PRD — republishing the PRD
		// makes it stale.
		recordPublish(tmpDir, {
			artifact: "rtm",
			projectName: "TestApp",
			path: path.join("Doc", "requirements", "RTM_TestApp.md"),
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: { "prd:TestApp": hashFileContent(prdPath)! },
		});
		const result = runPublishGate({
			artifact: "PRD",
			workingContent: "# PSRS v2\n",
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.ok(
			result.warnings.some((w) => w.includes("freshness-downstream") && w.includes("rtm:TestApp")),
			`expected freshness-downstream warning, got: ${result.warnings.join(" | ")}`,
		);
	});
});
