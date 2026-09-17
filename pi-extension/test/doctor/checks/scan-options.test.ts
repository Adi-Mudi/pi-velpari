/**
 * Doctor scan-options check tests (Phase C of brainstorm lifecycle v2.1).
 *
 * Covers:
 *   - Code project (codePaths configured + exist) → code "ok", doc "info", community "ok"
 *   - Doc-only project (inputDocuments configured + exist) → doc "ok", code "info"
 *   - Empty project (no config) → code + doc "info", community "ok"
 *   - Section title is "Available scans (SCAN gate)"
 *   - Each item has a status from the DiagnosticStatus union
 *   - Reasons are present when a scan is off
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkScanOptions } from "../../../src/doctor/checks/scan-options.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-doc-scan-options-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(codePaths: string[], inputDocuments: string[]) {
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({
			version: 4,
			projectName: "TestApp",
			framework: {},
			codePaths,
			inputDocuments,
			testPaths: [],
			outputPaths: {},
			excludedPaths: [],
		}),
		"utf8",
	);
}

function statusFor(section: ReturnType<typeof checkScanOptions>, scan: string): string | undefined {
	return section.items.find((i) => i.message.includes(`Scan "${scan}"`))?.status;
}

function reasonFor(section: ReturnType<typeof checkScanOptions>, scan: string): string | undefined {
	const item = section.items.find((i) => i.message.includes(`Scan "${scan}"`));
	if (!item) return undefined;
	const m = item.message.match(/Reason: ([^.]+)\./);
	return m ? m[1] : undefined;
}

describe("checkScanOptions (doctor)", () => {
	it("section title is 'Available scans (SCAN gate)'", () => {
		const section = checkScanOptions(tmpDir);
		assert.equal(section.title, "Available scans (SCAN gate)");
	});

	it("CODE project: code on, doc off, community on", () => {
		mkdirSync(join(tmpDir, "src"));
		writeConfig(["src"], []);

		const section = checkScanOptions(tmpDir);
		assert.equal(statusFor(section, "code"), "ok");
		assert.equal(statusFor(section, "doc"), "info");
		assert.equal(statusFor(section, "community"), "ok");
		assert.match(reasonFor(section, "doc") ?? "", /inputDocuments/);
	});

	it("DOC-ONLY project: doc on, code off, community on", () => {
		mkdirSync(join(tmpDir, "Doc"));
		writeConfig([], ["Doc"]);

		const section = checkScanOptions(tmpDir);
		assert.equal(statusFor(section, "doc"), "ok");
		assert.equal(statusFor(section, "code"), "info");
		assert.equal(statusFor(section, "community"), "ok");
		assert.match(reasonFor(section, "code") ?? "", /codePaths/);
	});

	it("EMPTY project: only community on; code + doc off with reasons", () => {
		writeConfig([], []);

		const section = checkScanOptions(tmpDir);
		assert.equal(statusFor(section, "code"), "info");
		assert.equal(statusFor(section, "doc"), "info");
		assert.equal(statusFor(section, "community"), "ok");
		assert.ok(reasonFor(section, "code"));
		assert.ok(reasonFor(section, "doc"));
	});

	it("config exists but codePaths dir missing → code off, reason mentions disk", () => {
		writeConfig(["missing-dir"], []);

		const section = checkScanOptions(tmpDir);
		assert.equal(statusFor(section, "code"), "info");
		assert.match(reasonFor(section, "code") ?? "", /no configured codePath exists/);
	});

	it("summary line lists what the picker will offer (info status)", () => {
		mkdirSync(join(tmpDir, "src"));
		mkdirSync(join(tmpDir, "Doc"));
		writeConfig(["src"], ["Doc"]);

		const section = checkScanOptions(tmpDir);
		const summary = section.items.find((i) => i.message.includes("SCAN-gate picker"));
		assert.ok(summary);
		assert.equal(summary!.status, "info");
		assert.match(summary!.message, /code, doc, community/);
		assert.match(summary!.message, /always chooses/);
	});

	it("summary line for empty project: only community", () => {
		writeConfig([], []);

		const section = checkScanOptions(tmpDir);
		const summary = section.items.find((i) => i.message.includes("SCAN-gate picker"));
		assert.ok(summary);
		assert.match(summary!.message, /offer: community/);
		assert.match(summary!.message, /v2\.1: no default/);
	});

	it("never reports errors (informational only)", () => {
		mkdirSync(join(tmpDir, "src"));
		writeConfig(["src"], []);

		const section = checkScanOptions(tmpDir);
		const errors = section.items.filter((i) => i.status === "error");
		assert.equal(errors.length, 0);
	});
});