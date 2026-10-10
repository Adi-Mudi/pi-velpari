// scripts/eval-baseline.test.mjs — local gate for the Phase C Lane C2 baseline checker.
//
// LLM-free: covers the pure band math, the model/mission path safety, the
// fail-open "no baseline yet" path, the record→check round trip, and the CLI
// error handling. Run with:
//   node --test scripts/eval-baseline.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	BASELINE_SUFFIX,
	DEFAULT_BAND,
	baselinePath,
	compareMission,
	compareReport,
	formatComparison,
	main,
	modelSlug,
	parseBaselineArgs,
	parseReportText,
	recordReport,
	safeMissionSlug,
} from "./eval-baseline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "eval-baseline.mjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A stage entry for the locked report contract. */
function stage(name, totalScore, overrides = {}) {
	return {
		stage: name,
		totalScore,
		detScores: [{ name: "freshness", score: 1 }],
		judgeOverall: null,
		judgeModel: null,
		rubricId: null,
		rubricVersion: null,
		rubricHash: null,
		detConfigHash: "deadbeefdeadbeef",
		attempts: 1,
		...overrides,
	};
}

/** A report with one mission. */
function report({ model = "cline-pass/deepseek-v4.1-flash", mission = "cli-todo", runId = "run-1", stages = [] } = {}) {
	return {
		reportVersion: 1,
		generatedAt: "2026-01-01T00:00:00.000Z",
		model,
		missions: [{ mission, runId, status: stages.length > 0 ? "completed" : "failed", stages, overallMean: 0 }],
	};
}

/** Write a report JSON to a temp file and return its path. */
function writeReport(dir, name, value) {
	const file = join(dir, name);
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
	return file;
}

// ---------------------------------------------------------------------------
// Slugs + path safety
// ---------------------------------------------------------------------------

test("modelSlug sanitizes ids and blocks traversal", () => {
	assert.equal(modelSlug("cline-pass/deepseek-v4.1-flash"), "cline-pass-deepseek-v4.1-flash");
	assert.equal(modelSlug("Kimi Coding Model"), "kimi-coding-model");
	assert.equal(modelSlug(""), "unknown-model");
	assert.equal(modelSlug(null), "unknown-model");
	assert.equal(modelSlug(".."), "unknown-model");
	assert.equal(modelSlug("../../etc"), "unknown-model");
	assert.ok(!modelSlug("..\\..\\x").includes(".."));
});

test("safeMissionSlug rejects traversal and accepts normal slugs", () => {
	assert.equal(safeMissionSlug("cli-todo"), "cli-todo");
	assert.equal(safeMissionSlug("notes-api"), "notes-api");
	assert.equal(safeMissionSlug(""), null);
	assert.equal(safeMissionSlug(".."), null);
	assert.equal(safeMissionSlug("../etc/passwd"), null);
	assert.equal(safeMissionSlug("a/b"), "a-b");
});

test("baselinePath builds <dir>/<model-slug>/<mission>.baseline.json and rejects bad missions", () => {
	const p = baselinePath("/base", "cline-pass/deepseek-v4.1-flash", "cli-todo");
	assert.equal(p, join("/base", "cline-pass-deepseek-v4.1-flash", `cli-todo${BASELINE_SUFFIX}`));
	assert.equal(baselinePath("/base", "m", "../evil"), null);
});

// ---------------------------------------------------------------------------
// parseReportText
// ---------------------------------------------------------------------------

test("parseReportText validates the locked envelope", () => {
	assert.equal(parseReportText("{bad").ok, false);
	assert.equal(parseReportText("42").ok, false);
	assert.equal(parseReportText(JSON.stringify({ reportVersion: 2, missions: [] })).ok, false);
	assert.equal(parseReportText(JSON.stringify({ reportVersion: 1 })).ok, false);
	const ok = parseReportText(JSON.stringify({ reportVersion: 1, missions: [] }));
	assert.equal(ok.ok, true);
});

// ---------------------------------------------------------------------------
// Band math (pure)
// ---------------------------------------------------------------------------

test("compareMission: within band passes, below floor breaches (never exact-match)", () => {
	const baseline = { mission: "m", stages: [stage("drafting-prd", 0.8)] };
	// A small drop inside the default 0.15 band must pass (G3).
	const within = compareMission({ mission: "m", stages: [stage("drafting-prd", 0.7)] }, baseline, DEFAULT_BAND);
	assert.equal(within.breached, false);
	assert.equal(within.stages[0].ok, true);

	// A drop past the floor must breach.
	const below = compareMission({ mission: "m", stages: [stage("drafting-prd", 0.5)] }, baseline, DEFAULT_BAND);
	assert.equal(below.breached, true);
	assert.equal(below.stages[0].ok, false);
	assert.ok(Math.abs(below.stages[0].floor - 0.65) < 1e-9);
});

test("compareMission: exact floor passes, one tick below breaches", () => {
	const baseline = { mission: "m", stages: [stage("drafting-prd", 0.8)] };
	const at = compareMission({ mission: "m", stages: [stage("drafting-prd", 0.65)] }, baseline, 0.15);
	assert.equal(at.breached, false, "fresh == floor is within band");
	const justBelow = compareMission({ mission: "m", stages: [stage("drafting-prd", 0.6499)] }, baseline, 0.15);
	assert.equal(justBelow.breached, true);
});

test("compareMission: a missing baseline stage breaches; a new fresh stage is informational", () => {
	const baseline = { mission: "m", stages: [stage("drafting-prd", 0.8), stage("building-rtm", 0.8)] };
	const fresh = { mission: "m", stages: [stage("drafting-prd", 0.8), stage("designing", 0.5)] };
	const cmp = compareMission(fresh, baseline, 0.15);
	const byStage = Object.fromEntries(cmp.stages.map((s) => [s.stage, s]));
	assert.equal(cmp.breached, true, "building-rtm is missing → breach");
	assert.equal(byStage["building-rtm"].missing, true);
	assert.equal(byStage["designing"].newStage, true);
	assert.equal(byStage["designing"].ok, true);
	assert.equal(cmp.usable, true);
});

test("compareMission: detConfigHash change is surfaced without breaching", () => {
	const baseline = { mission: "m", stages: [stage("drafting-prd", 0.8)] };
	const fresh = { mission: "m", stages: [stage("drafting-prd", 0.8, { detConfigHash: "cafef00d" })] };
	const cmp = compareMission(fresh, baseline, 0.15);
	assert.equal(cmp.detConfigChanged, true);
	assert.equal(cmp.breached, false);
});

test("compareMission: a baseline with no stages is not usable", () => {
	const cmp = compareMission({ mission: "m", stages: [stage("drafting-prd", 0.8)] }, { mission: "m", stages: [] }, 0.15);
	assert.equal(cmp.usable, false);
	assert.equal(cmp.breached, false);
});

// ---------------------------------------------------------------------------
// compareReport — fail-open + breach
// ---------------------------------------------------------------------------

test("compareReport: missing baseline is fail-open (no-baseline, not breached)", () => {
	const dir = mkdtempSync(join(tmpdir(), "eval-baseline-noref-"));
	try {
		const fresh = report({ stages: [stage("drafting-prd", 0.8)] });
		const res = compareReport(fresh, { baselineDir: dir });
		assert.equal(res.hasBaseline, false);
		assert.equal(res.breached, false);
		assert.equal(res.missions[0].status, "no-baseline");
		assert.equal(res.errors.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("compareReport: corrupt baseline is an error, not a silent pass", () => {
	const dir = mkdtempSync(join(tmpdir(), "eval-baseline-corrupt-"));
	try {
		const model = "cline-pass/deepseek-v4.1-flash";
		const p = baselinePath(dir, model, "cli-todo");
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, "{not json");
		const fresh = report({ model, stages: [stage("drafting-prd", 0.8)] });
		const res = compareReport(fresh, { baselineDir: dir });
		assert.ok(res.errors.length > 0, "corrupt baseline must surface as an error");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("compareReport: breach when the fresh total is below the baseline floor", () => {
	const dir = mkdtempSync(join(tmpdir(), "eval-baseline-breach-"));
	try {
		const model = "cline-pass/deepseek-v4.1-flash";
		const baseline = report({ model, stages: [stage("drafting-prd", 0.9), stage("building-rtm", 0.9)] });
		const rec = recordReport({ report: baseline, baselineDir: dir });
		assert.equal(rec.ok, true);
		const fresh = report({ model, stages: [stage("drafting-prd", 0.88), stage("building-rtm", 0.4)] });
		const res = compareReport(fresh, { baselineDir: dir });
		assert.equal(res.hasBaseline, true);
		assert.equal(res.breached, true);
		assert.equal(res.missions[0].status, "breach");
		const byStage = Object.fromEntries(res.missions[0].stages.map((s) => [s.stage, s]));
		assert.equal(byStage["drafting-prd"].ok, true);
		assert.equal(byStage["building-rtm"].ok, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

test("recordReport writes <model-slug>/<mission>.baseline.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "eval-baseline-record-"));
	try {
		const rep = report({ model: "cline-pass/deepseek-v4.1-flash", mission: "cli-todo", stages: [stage("drafting-prd", 0.8)] });
		const res = recordReport({ report: rep, baselineDir: dir });
		assert.equal(res.ok, true);
		assert.equal(res.written.length, 1);
		assert.equal(res.written[0], join(dir, "cline-pass-deepseek-v4.1-flash", "cli-todo.baseline.json"));
		assert.ok(existsSync(res.written[0]));
		const written = JSON.parse(readFileSync(res.written[0], "utf8"));
		assert.equal(written.reportVersion, 1);
		assert.equal(written.missions[0].mission, "cli-todo");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("recordReport requires a model", () => {
	const rep = report({ model: null, stages: [stage("drafting-prd", 0.8)] });
	const res = recordReport({ report: rep, baselineDir: "/tmp/x" });
	assert.equal(res.ok, false);
	assert.match(res.error, /model/);
});

// ---------------------------------------------------------------------------
// formatComparison
// ---------------------------------------------------------------------------

test("formatComparison prints a readable diff", () => {
	const dir = mkdtempSync(join(tmpdir(), "eval-baseline-fmt-"));
	try {
		const model = "m";
		recordReport({ report: report({ model, stages: [stage("drafting-prd", 0.8)] }), baselineDir: dir });
		const res = compareReport(report({ model, stages: [stage("drafting-prd", 0.5)] }), { baselineDir: dir });
		const text = formatComparison(res);
		assert.match(text, /cli-todo/);
		assert.match(text, /BREACH/);
		assert.match(text, /drafting-prd/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test("CLI record → check round trip: within band exits 0", () => {
	const ws = mkdtempSync(join(tmpdir(), "eval-baseline-cli-ok-"));
	try {
		const baselineDir = join(ws, "baselines");
		const baseline = report({ stages: [stage("drafting-prd", 0.8), stage("building-rtm", 0.8)] });
		const baselineReport = writeReport(ws, "baseline-in.json", baseline);

		const rec = spawnSync(
			process.execPath,
			[CLI, "record", "--report", baselineReport, "--baseline-dir", baselineDir],
			{ encoding: "utf8" },
		);
		assert.equal(rec.status, 0, rec.stderr);

		const fresh = report({ stages: [stage("drafting-prd", 0.78), stage("building-rtm", 0.7)] });
		const freshReport = writeReport(ws, "fresh.json", fresh);
		const check = spawnSync(
			process.execPath,
			[CLI, "check", "--report", freshReport, "--baseline-dir", baselineDir],
			{ encoding: "utf8" },
		);
		assert.equal(check.status, 0, check.stdout + check.stderr);
		assert.match(check.stdout, /PASS/);
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test("CLI check: breach exits 1 with the diff", () => {
	const ws = mkdtempSync(join(tmpdir(), "eval-baseline-cli-fail-"));
	try {
		const baselineDir = join(ws, "baselines");
		recordReport({
			report: report({ stages: [stage("drafting-prd", 0.9)] }),
			baselineDir,
		});
		const fresh = writeReport(ws, "fresh.json", report({ stages: [stage("drafting-prd", 0.3)] }));
		const check = spawnSync(
			process.execPath,
			[CLI, "check", "--report", fresh, "--baseline-dir", baselineDir],
			{ encoding: "utf8" },
		);
		assert.equal(check.status, 1, check.stdout + check.stderr);
		assert.match(check.stdout, /FAIL/);
		assert.match(check.stdout, /BREACH/);
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test("CLI check: no baseline exits 0 with a fail-open note", () => {
	const ws = mkdtempSync(join(tmpdir(), "eval-baseline-cli-noref-"));
	try {
		const fresh = writeReport(ws, "fresh.json", report({ stages: [stage("drafting-prd", 0.1)] }));
		const check = spawnSync(
			process.execPath,
			[CLI, "check", "--report", fresh, "--baseline-dir", join(ws, "empty")],
			{ encoding: "utf8" },
		);
		assert.equal(check.status, 0, check.stdout + check.stderr);
		assert.match(check.stdout, /NO BASELINE YET/);
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test("CLI check: --band widens/tightens the floor", () => {
	const ws = mkdtempSync(join(tmpdir(), "eval-baseline-cli-band-"));
	try {
		const baselineDir = join(ws, "baselines");
		recordReport({ report: report({ stages: [stage("drafting-prd", 0.8)] }), baselineDir });
		const fresh = writeReport(ws, "fresh.json", report({ stages: [stage("drafting-prd", 0.6)] }));

		// Default band 0.15: floor 0.65 → 0.60 breaches.
		const tight = spawnSync(process.execPath, [CLI, "check", "--report", fresh, "--baseline-dir", baselineDir], {
			encoding: "utf8",
		});
		assert.equal(tight.status, 1);

		// Wide band 0.25: floor 0.55 → 0.60 passes.
		const wide = spawnSync(
			process.execPath,
			[CLI, "check", "--report", fresh, "--baseline-dir", baselineDir, "--band", "0.25"],
			{ encoding: "utf8" },
		);
		assert.equal(wide.status, 0, wide.stdout + wide.stderr);
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test("CLI check: malformed report exits 2; missing report exits 2; bad band exits 2", () => {
	const ws = mkdtempSync(join(tmpdir(), "eval-baseline-cli-err-"));
	try {
		const bad = writeReport(ws, "bad.json", { reportVersion: 9, missions: [] });
		const badRes = spawnSync(process.execPath, [CLI, "check", "--report", bad], { encoding: "utf8" });
		assert.equal(badRes.status, 2, badRes.stdout + badRes.stderr);

		const missing = spawnSync(process.execPath, [CLI, "check", "--report", join(ws, "nope.json")], {
			encoding: "utf8",
		});
		assert.equal(missing.status, 2);

		const good = writeReport(ws, "good.json", report({ stages: [stage("drafting-prd", 0.8)] }));
		const band = spawnSync(process.execPath, [CLI, "check", "--report", good, "--band", "abc"], { encoding: "utf8" });
		assert.equal(band.status, 2);
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test("CLI: --help exits 0; missing mode exits 2; unknown option exits 2", () => {
	const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
	assert.equal(help.status, 0);
	assert.match(help.stdout, /Usage: node scripts\/eval-baseline\.mjs/);

	const noMode = spawnSync(process.execPath, [CLI, "--report", "x"], { encoding: "utf8" });
	assert.equal(noMode.status, 2);

	const bogus = spawnSync(process.execPath, [CLI, "check", "--report", "x", "--nope"], { encoding: "utf8" });
	assert.equal(bogus.status, 2);
});

// ---------------------------------------------------------------------------
// parseBaselineArgs + main (direct)
// ---------------------------------------------------------------------------

test("parseBaselineArgs parses modes and values", () => {
	const a = parseBaselineArgs(["check", "--report", "r.json", "--band", "0.2", "--baseline-dir", "/d"]);
	assert.equal(a.mode, "check");
	assert.equal(a.report, "r.json");
	assert.equal(a.band, "0.2");
	assert.equal(a.baselineDir, "/d");
	assert.equal(parseBaselineArgs(["record", "--report", "r.json"]).mode, "record");
	assert.match(parseBaselineArgs(["check", "record"]).error, /conflicting modes/);
});

test("main returns 0 for help and 2 for a missing report", async () => {
	assert.equal(await main(["--help"]), 0);
	assert.equal(await main(["check", "--report", join(tmpdir(), "definitely-missing-baseline.json")]), 2);
});
