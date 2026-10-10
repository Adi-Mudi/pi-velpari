// scripts/eval-run.test.mjs — local gate for the Phase C Lane C1 eval runner.
//
// LLM-free: covers the pure report builder, the read-only report CLI against a
// synthetic eval DB (schema v1), the golden-mission fixtures, and runner
// argument/mission handling. Run with:
//   node --test scripts/eval-run.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	REPORT_VERSION,
	STAGE_ORDER,
	buildMissionEntry,
	buildReport,
	parseDetScores,
	parseJudgeScores,
} from "./eval-report.mjs";
import {
	DEFAULT_FIXTURES_DIR,
	buildSpawnEnv,
	listMissions,
	loadMission,
	parseMissionMarkdown,
	parseRunArgs,
	resolveUntil,
} from "./eval-run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_CLI = join(HERE, "eval-report.mjs");
const RUN_CLI = join(HERE, "eval-run.mjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A camelCase EvalRow-like row (the pure-builder input shape). */
function row(overrides = {}) {
	return {
		id: 1,
		project: "EvalGoldenApp",
		runId: "run-1",
		stage: "drafting-prd",
		artifactKind: "PRD",
		version: "1",
		model: "test/model",
		durationMs: 1000,
		detScores: [{ name: "freshness", score: 1 }],
		judgeScores: null,
		totalScore: 0.5,
		detConfigHash: "deadbeefdeadbeef",
		attempts: 1,
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

/** A snake_case row (what the SQL reader returns). */
function snakeRow(overrides = {}) {
	return {
		id: 1,
		project: "EvalGoldenApp",
		run_id: "run-1",
		stage: "drafting-prd",
		artifact_kind: "PRD",
		version: "1",
		model: "test/model",
		duration_ms: 1000,
		det_scores: JSON.stringify([{ name: "freshness", score: 0.5 }]),
		judge_scores: null,
		total_score: 0.5,
		det_config_hash: "deadbeefdeadbeef",
		attempts: null,
		created_at: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

/** Create a schema-v1 eval DB and insert rows (then close it — the CLI reads read-only). */
function createEvalDb(dbPath, rows) {
	mkdirSync(dirname(dbPath), { recursive: true });
	const db = new DatabaseSync(dbPath);
	db.exec(`
		CREATE TABLE eval_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE eval_runs (
			id INTEGER PRIMARY KEY,
			project TEXT NOT NULL,
			run_id TEXT NOT NULL,
			stage TEXT NOT NULL,
			artifact_kind TEXT NOT NULL,
			version TEXT,
			model TEXT,
			duration_ms INTEGER,
			det_scores TEXT NOT NULL,
			judge_scores TEXT,
			total_score REAL NOT NULL,
			det_config_hash TEXT NOT NULL,
			attempts INTEGER,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
		);
		CREATE INDEX idx_eval_runs_project_stage ON eval_runs(project, stage, created_at);
	`);
	const insert = db.prepare(
		`INSERT INTO eval_runs
		   (project, run_id, stage, artifact_kind, version, model, duration_ms, det_scores, judge_scores, total_score, det_config_hash, attempts, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const r of rows) {
		insert.run(
			r.project,
			r.run_id,
			r.stage,
			r.artifact_kind,
			r.version,
			r.model,
			r.duration_ms,
			r.det_scores,
			r.judge_scores,
			r.total_score,
			r.det_config_hash,
			r.attempts,
			r.created_at,
		);
	}
	db.close();
}

// ---------------------------------------------------------------------------
// Pure report builder
// ---------------------------------------------------------------------------

test("buildReport: locked contract shape, stage ordering, overallMean", () => {
	const rows = [
		row({ stage: "building-rtm", totalScore: 0.6, createdAt: "2026-01-01T00:05:00.000Z" }),
		row({ stage: "drafting-prd", totalScore: 0.8, createdAt: "2026-01-01T00:00:00.000Z" }),
	];
	const report = buildReport(rows, {
		model: "test/model",
		mission: "cli-todo",
		runId: "run-1",
		generatedAt: "2026-01-02T00:00:00.000Z",
	});
	assert.equal(report.reportVersion, REPORT_VERSION);
	assert.equal(report.generatedAt, "2026-01-02T00:00:00.000Z");
	assert.equal(report.model, "test/model");
	assert.equal(report.missions.length, 1);

	const m = report.missions[0];
	assert.equal(m.mission, "cli-todo");
	assert.equal(m.runId, "run-1");
	assert.equal(m.status, "partial");
	assert.deepEqual(
		m.stages.map((s) => s.stage),
		["drafting-prd", "building-rtm"],
		"stages follow the velpari stage order, not row order",
	);
	assert.ok(Math.abs(m.overallMean - 0.7) < 1e-9, `overallMean ${m.overallMean} should be 0.7`);

	for (const s of m.stages) {
		assert.equal(s.judgeOverall, null);
		assert.equal(s.judgeModel, null);
		assert.equal(s.rubricId, null);
		assert.equal(s.rubricVersion, null);
		assert.equal(s.rubricHash, null);
	}
	assert.deepEqual(m.stages[0].detScores[0], { name: "freshness", score: 1 });
	assert.equal(m.stages[0].detConfigHash, "deadbeefdeadbeef");
	assert.equal(m.stages[0].attempts, 1);
});

test("buildReport: status completed only when every stage row is present", () => {
	const rows = STAGE_ORDER.map((stage, i) =>
		row({ stage, totalScore: 0.5, createdAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z` }),
	);
	const m = buildReport(rows, { mission: "m", runId: "run-1" }).missions[0];
	assert.equal(m.status, "completed");
	assert.equal(m.stages.length, STAGE_ORDER.length);
});

test("buildReport: no rows → status failed, overallMean 0", () => {
	const m = buildReport([], { mission: "m", runId: "r" }).missions[0];
	assert.equal(m.status, "failed");
	assert.equal(m.stages.length, 0);
	assert.equal(m.overallMean, 0);
});

test("buildReport: newest row per stage wins (dedupe)", () => {
	const rows = [
		row({ id: 1, stage: "drafting-prd", totalScore: 0.1, createdAt: "2026-01-01T00:00:00.000Z" }),
		row({ id: 2, stage: "drafting-prd", totalScore: 0.9, createdAt: "2026-01-02T00:00:00.000Z" }),
	];
	const stages = buildReport(rows, {}).missions[0].stages;
	assert.equal(stages.length, 1);
	assert.equal(stages[0].totalScore, 0.9);
});

test("buildReport: judge fields populate from judge_scores (snake_case rows)", () => {
	const rows = [
		snakeRow({
			total_score: 0.9,
			judge_scores: JSON.stringify({
				overall: 0.7,
				judgeModel: "cline-pass/deepseek",
				rubricId: "design",
				rubricVersion: 2,
				rubricHash: "abcd1234",
			}),
		}),
	];
	const s = buildReport(rows, {}).missions[0].stages[0];
	assert.equal(s.totalScore, 0.9);
	assert.equal(s.judgeOverall, 0.7);
	assert.equal(s.judgeModel, "cline-pass/deepseek");
	assert.equal(s.rubricId, "design");
	assert.equal(s.rubricVersion, 2);
	assert.equal(s.rubricHash, "abcd1234");
	assert.equal(s.detScores[0].score, 0.5);
});

test("buildReport: runId filter keeps only matching rows", () => {
	const rows = [
		row({ runId: "run-1", stage: "drafting-prd", totalScore: 0.2 }),
		row({ id: 2, runId: "run-2", stage: "drafting-prd", totalScore: 0.8 }),
	];
	const m = buildReport(rows, { runId: "run-2" }).missions[0];
	assert.equal(m.runId, "run-2");
	assert.equal(m.stages.length, 1);
	assert.equal(m.stages[0].totalScore, 0.8);
});

test("buildReport: multi-mission form builds one entry per mission", () => {
	const report = buildReport([], {
		model: "m",
		missions: [
			{ rows: [row({ stage: "drafting-prd" })], mission: "a", runId: "r-a" },
			{ rows: [row({ stage: "building-rtm" })], mission: "b", runId: "r-b" },
		],
	});
	assert.deepEqual(
		report.missions.map((m) => m.mission),
		["a", "b"],
	);
});

test("parseDetScores / parseJudgeScores tolerate malformed input", () => {
	assert.deepEqual(parseDetScores("not json"), []);
	assert.deepEqual(parseDetScores(null), []);
	assert.deepEqual(parseDetScores(42), []);
	assert.equal(parseJudgeScores(null), null);
	assert.equal(parseJudgeScores("{bad"), null);
	assert.deepEqual(parseJudgeScores({ overall: 1 }), {
		judgeOverall: 1,
		judgeModel: null,
		rubricId: null,
		rubricVersion: null,
		rubricHash: null,
	});
});

test("buildMissionEntry: mission/runId/status overrides win", () => {
	const m = buildMissionEntry([row({ stage: "drafting-prd" })], {
		mission: "custom",
		runId: "run-1",
		status: "failed",
	});
	assert.equal(m.mission, "custom");
	assert.equal(m.runId, "run-1");
	assert.equal(m.status, "failed");
});

// ---------------------------------------------------------------------------
// Mission fixtures
// ---------------------------------------------------------------------------

test("mission fixtures exist, are non-empty, and pin the scope", () => {
	const slugs = listMissions(DEFAULT_FIXTURES_DIR);
	assert.ok(slugs.includes("cli-todo"), `cli-todo fixture missing (found: ${slugs.join(", ")})`);
	assert.ok(slugs.includes("notes-api"), `notes-api fixture missing (found: ${slugs.join(", ")})`);

	for (const slug of ["cli-todo", "notes-api"]) {
		const m = loadMission(slug);
		assert.equal(m.ok, true, `loadMission(${slug}) failed: ${m.error ?? ""}`);
		assert.ok(m.mission.length > 0, `${slug}: empty mission statement`);
		assert.ok(m.scope.length > 0, `${slug}: empty scope boundaries`);
		assert.ok(m.capabilities.length > 0, `${slug}: empty expected capabilities`);
		assert.match(m.raw, /## Scope Boundaries/, `${slug}: pinned-scope section missing`);
		assert.match(m.raw, /## Expected Core Capabilities/, `${slug}: capabilities section missing`);
		const caps = m.capabilities
			.split(/\n/)
			.map((l) => l.trim())
			.filter((l) => /^\d+\./.test(l));
		assert.ok(caps.length >= 3 && caps.length <= 5, `${slug}: expected 3-5 capabilities, found ${caps.length}`);
	}
});

test("parseMissionMarkdown parses frontmatter + sections", () => {
	const md = [
		"---",
		"slug: demo",
		"title: Demo Mission",
		"---",
		"",
		"# Heading",
		"",
		"## Mission",
		"",
		"Do the thing.",
		"",
		"Second paragraph.",
		"",
		"## Scope Boundaries",
		"",
		"- alpha",
		"- beta",
		"",
		"## Expected Core Capabilities",
		"",
		"1. cap one",
		"2. cap two",
		"3. cap three",
	].join("\n");
	const p = parseMissionMarkdown(md, "fallback");
	assert.equal(p.slug, "demo");
	assert.equal(p.title, "Demo Mission");
	assert.equal(p.mission, "Do the thing.");
	assert.match(p.scope, /- alpha/);
	assert.match(p.capabilities, /1\. cap one/);
});

// ---------------------------------------------------------------------------
// Runner argument / mission handling
// ---------------------------------------------------------------------------

test("parseRunArgs: help, unknown option, and values", () => {
	assert.equal(parseRunArgs(["--help"]).help, true);
	assert.equal(parseRunArgs(["-h"]).help, true);
	assert.match(parseRunArgs(["--bogus"]).error, /unknown option/);
	assert.match(parseRunArgs(["stray"]).error, /unexpected argument/);
	const a = parseRunArgs(["--mission", "cli-todo", "--model", "x/y", "--until", "planning-tests", "--out", "r.json"]);
	assert.equal(a.mission, "cli-todo");
	assert.equal(a.model, "x/y");
	assert.equal(a.until, "planning-tests");
	assert.equal(a.out, "r.json");
	assert.equal(parseRunArgs(["--report-only", "/tmp/ws"]).reportOnly, "/tmp/ws");
	assert.equal(parseRunArgs(["--spawn-scouts"]).spawnScouts, true);
});

test("resolveUntil maps stage + handoff", () => {
	assert.equal(resolveUntil(undefined), "handoff-ready");
	assert.equal(resolveUntil("handoff"), "handoff-ready");
	assert.equal(resolveUntil("handoff-ready"), "handoff-ready");
	assert.equal(resolveUntil("planning-tests"), "planned-tests");
	assert.equal(resolveUntil("planned-tests"), "planned-tests");
	assert.equal(resolveUntil("finalizing-design"), "finalized-design");
});

test("loadMission: unknown mission is a clean error naming the fixtures", () => {
	const r = loadMission("does-not-exist");
	assert.equal(r.ok, false);
	assert.match(r.error, /unknown mission/);
	assert.match(r.error, /cli-todo/);
});

test("loadMission: rejects path-traversal slugs", () => {
	const r = loadMission("../etc/passwd");
	assert.equal(r.ok, false);
	assert.match(r.error, /invalid mission slug/);
});

test("buildSpawnEnv scrubs HERDR_* but keeps credentials and defaults the mux", () => {
	const env = buildSpawnEnv({
		HERDR_PANE: "x",
		HERDR_SOCK: "y",
		FOO: "bar",
		KIMI_API_KEY: "secret",
	});
	assert.equal(env.HERDR_PANE, undefined);
	assert.equal(env.HERDR_SOCK, undefined);
	assert.equal(env.PI_SUBAGENT_MUX, "tmux");
	assert.equal(env.VELPARI_EXCALIDRAW, "0");
	assert.equal(env.FOO, "bar");
	assert.equal(env.KIMI_API_KEY, "secret", "model credentials must pass through");
});

test("buildSpawnEnv preserves an explicit mux", () => {
	assert.equal(buildSpawnEnv({ PI_SUBAGENT_MUX: "zellij" }).PI_SUBAGENT_MUX, "zellij");
});

// ---------------------------------------------------------------------------
// CLI: report-only modes against a synthetic DB
// ---------------------------------------------------------------------------

test("eval-report CLI reads a synthetic eval DB read-only and emits the contract", () => {
	const ws = mkdtempSync(join(tmpdir(), "eval-report-test-"));
	try {
		const project = "EvalGoldenApp";
		mkdirSync(join(ws, ".pi", "velpari"), { recursive: true });
		writeFileSync(join(ws, ".pi", "velpari", "files.json"), JSON.stringify({ projectName: project }));
		createEvalDb(join(ws, "Eval", project, "eval.db"), [
			snakeRow({
				stage: "drafting-prd",
				total_score: 0.8,
				det_scores: JSON.stringify([
					{ name: "freshness", score: 1 },
					{ name: "id-coverage", score: 0.6 },
				]),
				created_at: "2026-01-01T00:00:00.000Z",
				attempts: 1,
			}),
			snakeRow({
				id: 2,
				stage: "building-rtm",
				total_score: 0.6,
				det_scores: JSON.stringify([{ name: "freshness", score: 1 }]),
				created_at: "2026-01-01T00:05:00.000Z",
				attempts: null,
			}),
		]);

		const out = join(ws, "report.json");
		const res = spawnSync(process.execPath, [REPORT_CLI, "--workspace", ws, "--out", out], { encoding: "utf8" });
		assert.equal(res.status, 0, `eval-report exited ${res.status}: ${res.stderr}`);
		assert.ok(existsSync(out), "report file not written");

		const report = JSON.parse(readFileSync(out, "utf8"));
		assert.equal(report.reportVersion, 1);
		assert.equal(report.missions.length, 1);
		const m = report.missions[0];
		assert.equal(m.mission, project);
		assert.equal(m.runId, "run-1");
		assert.equal(m.status, "partial");
		assert.deepEqual(
			m.stages.map((s) => s.stage),
			["drafting-prd", "building-rtm"],
		);
		assert.ok(Math.abs(m.overallMean - 0.7) < 1e-9);
		assert.equal(m.stages[0].detScores.length, 2);
		assert.equal(m.stages[0].attempts, 1);
		assert.equal(m.stages[1].attempts, null);
		assert.equal(m.stages[0].judgeOverall, null);
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test("eval-run --report-only builds the report from an existing workspace DB", () => {
	const ws = mkdtempSync(join(tmpdir(), "eval-run-only-test-"));
	try {
		const project = "EvalGoldenApp";
		mkdirSync(join(ws, ".pi", "velpari"), { recursive: true });
		writeFileSync(join(ws, ".pi", "velpari", "files.json"), JSON.stringify({ projectName: project }));
		createEvalDb(join(ws, "Eval", project, "eval.db"), [
			snakeRow({ stage: "drafting-prd", total_score: 0.42, created_at: "2026-01-01T00:00:00.000Z" }),
		]);

		const out = join(ws, "run-report.json");
		const res = spawnSync(
			process.execPath,
			[RUN_CLI, "--report-only", ws, "--mission", "cli-todo", "--model", "test/model", "--out", out],
			{ encoding: "utf8" },
		);
		assert.equal(res.status, 0, `eval-run --report-only exited ${res.status}: ${res.stderr}`);
		const report = JSON.parse(readFileSync(out, "utf8"));
		assert.equal(report.model, "test/model");
		assert.equal(report.missions[0].mission, "cli-todo");
		assert.equal(report.missions[0].stages.length, 1);
		assert.equal(report.missions[0].stages[0].totalScore, 0.42);
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test("eval-report CLI: --help exits 0 and unknown option exits 2", () => {
	const help = spawnSync(process.execPath, [REPORT_CLI, "--help"], { encoding: "utf8" });
	assert.equal(help.status, 0);
	assert.match(help.stdout, /Usage: node scripts\/eval-report\.mjs/);

	const bad = spawnSync(process.execPath, [REPORT_CLI, "--nope"], { encoding: "utf8" });
	assert.equal(bad.status, 2);
	assert.match(bad.stderr, /unknown option/);
});

test("eval-run CLI: --help exits 0; unknown mission exits 2 with a clean error", () => {
	const help = spawnSync(process.execPath, [RUN_CLI, "--help"], { encoding: "utf8" });
	assert.equal(help.status, 0);
	assert.match(help.stdout, /Usage: node scripts\/eval-run\.mjs/);

	const unknown = spawnSync(process.execPath, [RUN_CLI, "--mission", "does-not-exist"], { encoding: "utf8" });
	assert.equal(unknown.status, 2);
	assert.match(unknown.stderr, /unknown mission/);

	const noMission = spawnSync(process.execPath, [RUN_CLI], { encoding: "utf8" });
	assert.equal(noMission.status, 2);
	assert.match(noMission.stderr, /--mission <slug> is required/);
});
