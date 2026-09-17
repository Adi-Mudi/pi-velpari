/**
 * Tests for doctor/checks/feasibility-v2.ts.
 * Phase 2: closes the 54% coverage gap on the feasibility doctor check.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkFeasibilityV2Section } from "../../../src/doctor/checks/feasibility-v2.js";

function makeCwd(): string {
	return mkdtempSync(join(tmpdir(), "velpari-feas-v2-"));
}

function writeFeasibilityStudy(cwd: string, projectName: string, sections: string[]): void {
	const dir = join(cwd, "Doc", "feasibility");
	mkdirSync(dir, { recursive: true });
	const body = sections
		.map((s, i) => `## ${i + 1}. ${s}\n\n${s === "Overall Verdict" ? "Final: Go" : `${s} content.`}`)
		.join("\n\n");
	writeFileSync(join(dir, `feasibility-study_${projectName}.md`), `# Feasibility\n\n${body}\n`, "utf8");
}

const REQUIRED_SECTIONS = [
	"Executive Summary",
	"Options Analysis",
	"Build-vs-Reuse Comparison",
	"Language Selection",
	"Technical Feasibility",
	"Schedule Feasibility",
	"Cost Feasibility",
	"Risk Feasibility",
	"Overall Verdict",
	"Conditions",
	"Top 5 Risks",
	"Open Questions",
	"Change Log",
];

describe("checkFeasibilityV2Section — no project / no published study", () => {
	it("returns info message when no study is published yet", () => {
		const cwd = makeCwd();
		try {
			const section = checkFeasibilityV2Section(cwd, "TestApp");
			assert.equal(section.title, "Feasibility v2");
			assert.ok(section.items.length >= 1);
			assert.equal(section.items[0]!.status, "info");
			assert.match(section.items[0]!.message, /No published feasibility study yet/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkFeasibilityV2Section — published study validation", () => {
	it("passes when all 13 sections + verdict word are present", () => {
		const cwd = makeCwd();
		try {
			writeFeasibilityStudy(cwd, "TestApp", REQUIRED_SECTIONS);
			const section = checkFeasibilityV2Section(cwd, "TestApp");
			const ok = section.items.find((i) => i.status === "ok");
			assert.ok(ok, "at least one ok item");
			assert.match(ok!.message, /passes the v2 template/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("errors when one section is missing", () => {
		const cwd = makeCwd();
		try {
			const incomplete = REQUIRED_SECTIONS.filter((s) => s !== "Top 5 Risks");
			writeFeasibilityStudy(cwd, "TestApp", incomplete);
			const section = checkFeasibilityV2Section(cwd, "TestApp");
			const errors = section.items.filter((i) => i.status === "error");
			assert.ok(errors.length >= 1, "at least one error item");
			const msg = errors.map((e) => e.message).join("\n");
			assert.match(msg, /Top 5 Risks/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("errors when verdict word is missing", () => {
		const cwd = makeCwd();
		try {
			const dir = join(cwd, "Doc", "feasibility");
			mkdirSync(dir, { recursive: true });
			const body = REQUIRED_SECTIONS
				.map((s, i) => `## ${i + 1}. ${s}\n\n${s === "Overall Verdict" ? "incomplete" : `${s} content.`}`)
				.join("\n\n");
			writeFileSync(join(dir, "feasibility-study_TestApp.md"), `# Feasibility\n\n${body}\n`, "utf8");
			const section = checkFeasibilityV2Section(cwd, "TestApp");
			const errors = section.items.filter((i) => i.status === "error");
			assert.ok(errors.length >= 1, "verdict-missing should error");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkFeasibilityV2Section — open session progress (active stage)", () => {
	it("reports incomplete session during analyzing-feasibility", () => {
		const cwd = makeCwd();
		try {
			// Seed state.json with an active feasibility stage + partial session
			const dir = join(cwd, ".IDE_Plans", "velpari");
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "state.json"),
				JSON.stringify({
					version: 1,
					runId: "2026-01-01-00-00-test",
					mission: "TestApp",
					currentStage: "analyzing-feasibility",
					history: [],
					updatedAt: new Date().toISOString(),
					feasibilitySession: {
						reuseConsent: true,
						decision: undefined,
						languageCandidates: ["typescript", "python"],
						spikeResults: [{ language: "typescript", result: "ok" }],
						selectedLanguage: undefined,
					},
				}),
				"utf8",
			);
			const section = checkFeasibilityV2Section(cwd, "TestApp");
			const warn = section.items.find(
				(i) => i.status === "warning" && /INCOMPLETE/i.test(i.message),
			);
			assert.ok(warn, "incomplete session should be flagged");
			assert.ok(Array.isArray(warn!.details));
			assert.ok(warn!.details!.some((d) => /Decision/i.test(d)));
			assert.ok(warn!.details!.some((d) => /Selected language/i.test(d)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("reports settled session as ok during analyzing-feasibility", () => {
		const cwd = makeCwd();
		try {
			const dir = join(cwd, ".IDE_Plans", "velpari");
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "state.json"),
				JSON.stringify({
					version: 1,
					runId: "2026-01-01-00-00-test",
					mission: "TestApp",
					currentStage: "analyzing-feasibility",
					history: [],
					updatedAt: new Date().toISOString(),
					feasibilitySession: {
						reuseConsent: true,
						decision: "build",
						languageCandidates: ["typescript"],
						spikeResults: [],
						selectedLanguage: "typescript",
						selectedBy: "user",
					},
				}),
				"utf8",
			);
			const section = checkFeasibilityV2Section(cwd, "TestApp");
			const ok = section.items.find((i) => /settled/i.test(i.message));
			assert.ok(ok);
			assert.equal(ok!.status, "ok");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not include session progress when stage is not feasibility", () => {
		const cwd = makeCwd();
		try {
			const dir = join(cwd, ".IDE_Plans", "velpari");
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "state.json"),
				JSON.stringify({
					version: 1,
					runId: "2026-01-01-00-00-test",
					mission: "TestApp",
					currentStage: "brainstorming",
					history: [],
					updatedAt: new Date().toISOString(),
					feasibilitySession: { decision: undefined, selectedLanguage: undefined },
				}),
				"utf8",
			);
			const section = checkFeasibilityV2Section(cwd, "TestApp");
			const sessionItem = section.items.find((i) => /INCOMPLETE|settled/i.test(i.message));
			assert.equal(sessionItem, undefined);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not include session progress when no session exists", () => {
		const cwd = makeCwd();
		try {
			const dir = join(cwd, ".IDE_Plans", "velpari");
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "state.json"),
				JSON.stringify({
					version: 1,
					runId: "2026-01-01-00-00-test",
					mission: "TestApp",
					currentStage: "analyzing-feasibility",
					history: [],
					updatedAt: new Date().toISOString(),
				}),
				"utf8",
			);
			const section = checkFeasibilityV2Section(cwd, "TestApp");
			const sessionItem = section.items.find((i) => /INCOMPLETE|settled/i.test(i.message));
			assert.equal(sessionItem, undefined);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("checkFeasibilityV2Section — combined", () => {
	it("returns both validation + session items when both apply", () => {
		const cwd = makeCwd();
		try {
			writeFeasibilityStudy(cwd, "TestApp", REQUIRED_SECTIONS);
			const dir = join(cwd, ".IDE_Plans", "velpari");
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "state.json"),
				JSON.stringify({
					version: 1,
					runId: "2026-01-01-00-00-test",
					mission: "TestApp",
					currentStage: "analyzing-feasibility",
					history: [],
					updatedAt: new Date().toISOString(),
					feasibilitySession: { decision: "build", selectedLanguage: "typescript" },
				}),
				"utf8",
			);
			const section = checkFeasibilityV2Section(cwd, "TestApp");
			const hasValidation = section.items.some((i) => /passes the v2 template/.test(i.message));
			const hasSession = section.items.some((i) => /settled/.test(i.message));
			assert.ok(hasValidation && hasSession);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});