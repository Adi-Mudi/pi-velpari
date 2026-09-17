/**
 * Plan D — per-stage reviewer verdict loader tests.
 *
 * Verifies the 3 new per-stage loaders (pseudocode / testplan / design)
 * + the shared `reviewer-verdict.ts` helper. Covers:
 *
 *   - reviewer-not-expected (basic tier + no overlay) -> info (no error)
 *   - reviewer-expected (advanced tier) but missing -> error
 *   - reviewer present with approve verdict -> no errors
 *   - reviewer present with errors -> errors surfaced
 *   - reviewer JSON malformed -> error
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	loadPseudocodeReviewerVerdict,
} from "../../src/doctor/checks/pseudocode-reviewer.js";
import {
	loadTestplanReviewerVerdict,
} from "../../src/doctor/checks/testplan-reviewer.js";
import {
	loadDesignReviewerVerdict,
} from "../../src/doctor/checks/design-reviewer.js";
import {
	REVIEWER_STAGE_SPECS,
} from "../../src/doctor/checks/reviewer-verdict.js";
import {
	DEFAULT_ATOMIC_PROFILE,
	type AtomicProfile,
} from "../../src/core/atomic-tier.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-reviewer-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFilesConfig(opts: { projectName: string; tier: "entry" | "basic" | "intermediate" | "advanced" }): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "files.json"),
		JSON.stringify({
			version: 4,
			framework: { language: "typescript" },
			projectName: opts.projectName,
			codePaths: ["src/**/*.ts"],
			testPaths: ["test/**/*.test.ts"],
			documentPaths: ["Doc/**/*.md"],
			excludedPaths: ["node_modules/**"],
			atomic: { tier: opts.tier },
		}),
		"utf8",
	);
}

/**
 * Write a reviewer verdict at the expected path for a stage. Caller
 * controls the verdict JSON shape.
 */
function writeReviewerVerdict(stageKey: string, verdict: unknown): string {
	const spec = REVIEWER_STAGE_SPECS.find((s: { stageKey: string }) => s.stageKey === stageKey)!;
	const runDir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "2026-09-17-test");
	fs.mkdirSync(runDir, { recursive: true });
	const verdictPath = path.join(runDir, spec.verdictSubpath);
	fs.mkdirSync(path.dirname(verdictPath), { recursive: true });
	fs.writeFileSync(verdictPath, JSON.stringify(verdict, null, 2), "utf8");
	return verdictPath;
}

describe("REVIEWER_STAGE_SPECS — per-stage mapping", () => {
	it("has exactly 4 reviewer stages (atomic-function, pseudocode, testplan, design)", () => {
		assert.equal(REVIEWER_STAGE_SPECS.length, 4);
		const keys = REVIEWER_STAGE_SPECS.map((s: { stageKey: string }) => s.stageKey);
		assert.deepEqual(keys, [
			"atomic-function",
			"pseudocode",
			"testplan",
			"architecture-generator",
		]);
	});

	it("each stage has a unique reviewer role + verdict subpath", () => {
		const roles = REVIEWER_STAGE_SPECS.map((s: { reviewerRole: string }) => s.reviewerRole);
		assert.equal(new Set(roles).size, roles.length, "duplicate reviewer roles");
		const paths = REVIEWER_STAGE_SPECS.map((s: { verdictSubpath: string }) => s.verdictSubpath);
		assert.equal(new Set(paths).size, paths.length, "duplicate verdict subpaths");
	});
});

describe("loadPseudocodeReviewerVerdict", () => {
	const basicProfile: AtomicProfile = { ...DEFAULT_ATOMIC_PROFILE, tier: "basic" };
	const advancedProfile: AtomicProfile = { ...DEFAULT_ATOMIC_PROFILE, tier: "advanced" };

	it("basic tier + missing verdict -> info (reviewer skipped by tier gate)", () => {
		makeFilesConfig({ projectName: "TestApp", tier: "basic" });
		const section = loadPseudocodeReviewerVerdict(tmpDir, basicProfile);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]!.status, "info");
		assert.match(section.items[0]!.message, /Reviewer was skipped for pseudocode/);
	});

	it("advanced tier + missing verdict -> error (reviewer should have run)", () => {
		makeFilesConfig({ projectName: "TestApp", tier: "advanced" });
		const section = loadPseudocodeReviewerVerdict(tmpDir, advancedProfile);
		assert.ok(section.items.some((i: { status: string }) => i.status === "error"));
	});

	it("approve verdict -> no errors", () => {
		makeFilesConfig({ projectName: "TestApp", tier: "advanced" });
		writeReviewerVerdict("pseudocode", {
			verdict: "approve",
			issues: [],
			summary: "0 errors",
			timestamp: "2026-09-17T12:00:00.000Z",
		});
		const section = loadPseudocodeReviewerVerdict(tmpDir, advancedProfile);
		// Summary line is ok; no errors.
		assert.ok(!section.items.some((i: { status: string }) => i.status === "error"));
	});

	it("verdict with errors -> errors surfaced", () => {
		makeFilesConfig({ projectName: "TestApp", tier: "advanced" });
		writeReviewerVerdict("pseudocode", {
			verdict: "block",
			issues: [
				{
					severity: "error",
					rule: "pseudocode-empty",
					location: "AF-3",
					message: "pseudocode body is empty",
				},
			],
			summary: "1 error",
			timestamp: "2026-09-17T12:00:00.000Z",
		});
		const section = loadPseudocodeReviewerVerdict(tmpDir, advancedProfile);
		const errors = section.items.filter((i: { status: string }) => i.status === "error");
		assert.ok(errors.length > 1, "expected summary + at least one issue");
		// errors[0] is the verdict summary line; errors[1] is the actual issue.
		assert.match(errors[1]!.message, /pseudocode-empty.*AF-3/);
	});
});

describe("loadTestplanReviewerVerdict", () => {
	const advancedProfile: AtomicProfile = { ...DEFAULT_ATOMIC_PROFILE, tier: "advanced" };

	it("basic tier + missing verdict -> info", () => {
		makeFilesConfig({ projectName: "TestApp", tier: "basic" });
		const section = loadTestplanReviewerVerdict(tmpDir, {
			...DEFAULT_ATOMIC_PROFILE,
			tier: "basic",
		});
		assert.equal(section.items[0]!.status, "info");
		assert.match(section.items[0]!.message, /Reviewer was skipped for testplan/);
	});

	it("approve verdict -> no errors", () => {
		makeFilesConfig({ projectName: "TestApp", tier: "advanced" });
		writeReviewerVerdict("testplan", {
			verdict: "approve",
			issues: [],
			summary: "0 errors",
			timestamp: "2026-09-17T12:00:00.000Z",
		});
		const section = loadTestplanReviewerVerdict(tmpDir, advancedProfile);
		assert.ok(!section.items.some((i: { status: string }) => i.status === "error"));
	});
});

describe("loadDesignReviewerVerdict", () => {
	const advancedProfile: AtomicProfile = { ...DEFAULT_ATOMIC_PROFILE, tier: "advanced" };

	it("basic tier + missing verdict -> info", () => {
		makeFilesConfig({ projectName: "TestApp", tier: "basic" });
		const section = loadDesignReviewerVerdict(tmpDir, {
			...DEFAULT_ATOMIC_PROFILE,
			tier: "basic",
		});
		assert.equal(section.items[0]!.status, "info");
		assert.match(section.items[0]!.message, /Reviewer was skipped for architecture-generator/);
	});

	it("verdict with section-0-missing error -> error surfaced", () => {
		makeFilesConfig({ projectName: "TestApp", tier: "advanced" });
		writeReviewerVerdict("architecture-generator", {
			verdict: "block",
			issues: [
				{
					severity: "error",
					rule: "section-0-missing",
					message: "## 0. Introduction & Goals not present",
				},
			],
			summary: "1 error",
			timestamp: "2026-09-17T12:00:00.000Z",
		});
		const section = loadDesignReviewerVerdict(tmpDir, advancedProfile);
		const errors = section.items.filter((i: { status: string }) => i.status === "error");
		assert.ok(errors.length > 1);
		// errors[0] is the verdict summary line; errors[1] is the actual issue.
		assert.match(errors[1]!.message, /section-0-missing/);
	});

	it("malformed JSON -> error", () => {
		makeFilesConfig({ projectName: "TestApp", tier: "advanced" });
		const spec = REVIEWER_STAGE_SPECS.find((s: { stageKey: string }) => s.stageKey === "architecture-generator")!;
		const runDir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", "2026-09-17-test");
		fs.mkdirSync(path.dirname(path.join(runDir, spec.verdictSubpath)), { recursive: true });
		fs.writeFileSync(path.join(runDir, spec.verdictSubpath), "NOT JSON {", "utf8");
		const section = loadDesignReviewerVerdict(tmpDir, advancedProfile);
		assert.ok(section.items.some((i: { status: string }) => i.status === "error"));
	});
});