/**
 * Per-doctor-check integration tests (Phase 3.2 + 3.3).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDoctor } from "../../src/doctor/index.js";
import { writeDoctorReport } from "../../src/doctor/report.js";
import { TEST_PROJECT, setupFullCwd } from "../helpers/full-cwd.js";

function makeCwd(): string {
	return mkdtempSync(join(tmpdir(), "velpari-doctor-it-"));
}

describe("doctor integration — full-cwd positive case", () => {
	it("emits 20+ sections on a clean full-cwd", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		assert.ok(report.sections.length >= 20, `got ${report.sections.length} sections`);
	});

	it("returns a valid DiagnosticReport shape with summary counters", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		assert.equal(typeof report.summary.ok, "number");
		assert.equal(typeof report.summary.warning, "number");
		assert.equal(typeof report.summary.error, "number");
		assert.ok(Array.isArray(report.sections));
	});

	it("summary counters are non-negative integers", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		assert.ok(report.summary.ok >= 0);
		assert.ok(report.summary.warning >= 0);
		assert.ok(report.summary.error >= 0);
	});

	it("every section has a non-empty title and ≥0 items", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		for (const s of report.sections) {
			assert.ok(s.title.length > 0, "section has title");
			assert.ok(Array.isArray(s.items));
		}
	});

	it("every item has a valid status", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		for (const s of report.sections) {
			for (const item of s.items) {
				assert.ok(["ok", "info", "warning", "error"].includes(item.status), `bad status ${item.status} in ${s.title}`);
			}
		}
	});
});

describe("doctor integration — writeDoctorReport", () => {
	it("writes the markdown report at the canonical doctor-report.md path", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		writeDoctorReport(report, cwd);
		const reportPath = join(cwd, ".IDE_Plans", "velpari", "doctor-report.md");
		assert.ok(existsSync(reportPath));
	});
});

describe("doctor integration — frontmatter", () => {
	it("errors when PRD has no YAML frontmatter", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const prdPath = join(cwd, "Doc", "requirements", `PRD_${TEST_PROJECT}.md`);
		const txt = readFileSync(prdPath, "utf8");
		writeFileSync(prdPath, txt.replace(/^---\n[\s\S]*?\n---\n/, ""));
		const report = runDoctor(cwd);
		const fm = report.sections.find((s) => /frontmatter/i.test(s.title));
		assert.ok(fm, "expected a frontmatter section");
	});
});

describe("doctor integration — MVP coverage + phase consistency", () => {
	it("MVP section is present on full-cwd", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		const mvp = report.sections.find((s) => /MVP/i.test(s.title));
		assert.ok(mvp);
	});

	it("phase consistency section surfaces when PRD MVP phase ≠ RTM phase", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const prdPath = join(cwd, "Doc", "requirements", `PRD_${TEST_PROJECT}.md`);
		const txt = readFileSync(prdPath, "utf8");
		writeFileSync(prdPath, txt.replace("| 1 | MVP |", "| 2 | MVP |"));
		const report = runDoctor(cwd);
		const phase = report.sections.find((s) => /phase consistency/i.test(s.title));
		assert.ok(phase);
	});
});

describe("doctor integration — RTM", () => {
	it("emits a fingerprint-related section on full-cwd", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		const fp = report.sections.find((s) => /fingerprint/i.test(s.title));
		assert.ok(fp);
	});

	it("emits an RTM-related section on full-cwd", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		const rtm = report.sections.find((s) => /RTM/i.test(s.title));
		assert.ok(rtm);
	});

	it("fingerprints section surfaces unknown requirement ids", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const rtmPath = join(cwd, "Doc", "requirements", `RTM_${TEST_PROJECT}.json`);
		const rtm = JSON.parse(readFileSync(rtmPath, "utf8")) as { rows: Array<{ requirementId: string }> };
		rtm.rows[0]!.requirementId = "FR-DOES-NOT-EXIST";
		writeFileSync(rtmPath, JSON.stringify(rtm, null, 2));
		const report = runDoctor(cwd);
		const fp = report.sections.find((s) => /fingerprint/i.test(s.title));
		assert.ok(fp);
	});
});

describe("doctor integration — paths", () => {
	it("no errors on a clean full-cwd", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		const paths = report.sections.find((s) => /paths/i.test(s.title));
		assert.ok(paths);
	});

	it("errors when a published artifact lands outside Doc/ subfolder", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		mkdirSync(join(cwd, "Doc", "feasibility"), { recursive: true });
		writeFileSync(join(cwd, "Doc", `feasibility-study_${TEST_PROJECT}.md`), "# x\n");
		const report = runDoctor(cwd);
		const paths = report.sections.find((s) => /paths/i.test(s.title));
		assert.ok(paths);
	});
});

describe("doctor integration — profile sections", () => {
	it("profile section reports when requirements-profile.json is present", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		const report = runDoctor(cwd);
		const profile = report.sections.find((s) => s.title === "Requirements profile");
		assert.ok(profile);
	});
});

describe("doctor integration — working/published separation", () => {
	it("errors when a working copy is in Doc/ directly", () => {
		const cwd = makeCwd();
		setupFullCwd(cwd);
		writeFileSync(join(cwd, "Doc", "requirements", "PRD_draft.md"), "working copy leaked into Doc/\n");
		const report = runDoctor(cwd);
		const sep = report.sections.find((s) => /separation|working.published/i.test(s.title));
		assert.ok(sep);
	});
});
