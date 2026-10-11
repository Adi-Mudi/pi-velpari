/**
 * Report-schema tests (Doctor upgrade Phase 0 — contract C1/C2).
 *
 * Covers:
 *   - `sectionId` stability (explicit id wins; title slug fallback).
 *   - `toJsonReport` shape + verdict + summary mirrors the report.
 *   - `writeDoctorJson` atomic write path + round-trip fidelity.
 */

import { describe, it, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagnosticReport, DiagnosticSection } from "../../src/doctor/_types.js";
import {
	JSON_REPORT_SCHEMA_VERSION,
	sectionId,
	slugId,
	toJsonReport,
	writeDoctorJson,
} from "../../src/doctor/report-schema.js";

const tmpDirs: string[] = [];

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Create a temp dir that `afterEach` removes.
 * @returns {string} Absolute path to the new temp directory.
 */
function tmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "velpari-report-schema-"));
	tmpDirs.push(dir);
	return dir;
}

/**
 * Build a minimal one-item section, optionally with an explicit id.
 * @param {string} title - Section title.
 * @param {string} [id] - Optional explicit machine id.
 * @returns {DiagnosticSection} The sample section.
 */
function section(title: string, id?: string): DiagnosticSection {
	const base: DiagnosticSection = { title, items: [{ status: "ok", message: `${title} ok` }] };
	return id === undefined ? base : { ...base, id };
}

const REPORT: DiagnosticReport = {
	ok: false,
	summary: { ok: 1, warning: 1, error: 1, info: 0 },
	sections: [
		section("Action items", "action-items"),
		section("RTM↔test-cases link consistency"),
		{ title: "Config", items: [{ status: "error", message: "Config: INVALID", details: ["bad key"], suggestion: "Fix it" }] },
	],
};

// ---------------------------------------------------------------------------
// sectionId
// ---------------------------------------------------------------------------

describe("sectionId", () => {
	it("prefers an explicit section id", () => {
		assert.equal(sectionId(section("Anything at all", "custom-id")), "custom-id");
	});

	it("slugs a title into stable kebab-case", () => {
		assert.equal(sectionId(section("RTM↔test-cases link consistency")), "rtm-test-cases-link-consistency");
		assert.equal(sectionId(section("Scout agents (.pi/agents/)")), "scout-agents-pi-agents");
		assert.equal(sectionId(section("Freshness (stale set)")), "freshness-stale-set");
	});

	it("is stable across repeated calls", () => {
		const s = section("Setup progress");
		assert.equal(sectionId(s), sectionId(s));
		assert.equal(sectionId(s), "setup-progress");
	});

	it("slugId trims and collapses punctuation", () => {
		assert.equal(slugId("  Hello,  World!!  "), "hello-world");
		assert.equal(slugId("N19/N20"), "n19-n20");
	});
});

// ---------------------------------------------------------------------------
// toJsonReport
// ---------------------------------------------------------------------------

describe("toJsonReport", () => {
	it("stamps the current schema version", () => {
		assert.equal(toJsonReport(REPORT).schemaVersion, JSON_REPORT_SCHEMA_VERSION);
	});

	it("emits an ISO generatedAt timestamp", () => {
		const json = toJsonReport(REPORT);
		assert.ok(!Number.isNaN(Date.parse(json.generatedAt)), "generatedAt must be a parseable ISO date");
	});

	it("maps the verdict from report.ok", () => {
		assert.equal(toJsonReport(REPORT).verdict, "error");
		assert.equal(toJsonReport({ ...REPORT, ok: true }).verdict, "ok");
	});

	it("copies the summary counts", () => {
		assert.deepEqual(toJsonReport(REPORT).summary, { ok: 1, warning: 1, error: 1, info: 0 });
	});

	it("carries section ids, titles, and item fields", () => {
		const json = toJsonReport(REPORT);
		assert.equal(json.sections.length, 3);
		assert.equal(json.sections[0]?.id, "action-items");
		assert.equal(json.sections[1]?.id, "rtm-test-cases-link-consistency");
		const config = json.sections[2];
		assert.equal(config?.title, "Config");
		assert.deepEqual(config?.items[0], {
			status: "error",
			message: "Config: INVALID",
			details: ["bad key"],
			suggestion: "Fix it",
		});
	});

	it("omits optional item fields when absent", () => {
		const json = toJsonReport(REPORT);
		assert.deepEqual(json.sections[0]?.items[0], { status: "ok", message: "Action items ok" });
	});
});

// ---------------------------------------------------------------------------
// writeDoctorJson
// ---------------------------------------------------------------------------

describe("writeDoctorJson", () => {
	it("writes .IDE_Plans/velpari/doctor-report.json under cwd", () => {
		const dir = tmpDir();
		const written = writeDoctorJson(REPORT, dir);
		const path = join(dir, ".IDE_Plans", "velpari", "doctor-report.json");
		const onDisk = JSON.parse(readFileSync(path, "utf8"));
		assert.deepEqual(onDisk, written);
	});

	it("leaves no temp file behind (atomic rename)", () => {
		const dir = tmpDir();
		writeDoctorJson(REPORT, dir);
		const entries = readdirSync(join(dir, ".IDE_Plans", "velpari"));
		assert.deepEqual(entries, ["doctor-report.json"]);
	});

	it("returns the exact object written", () => {
		const dir = tmpDir();
		const written = writeDoctorJson(REPORT, dir);
		assert.equal(written.schemaVersion, JSON_REPORT_SCHEMA_VERSION);
		assert.equal(written.verdict, "error");
	});
});
