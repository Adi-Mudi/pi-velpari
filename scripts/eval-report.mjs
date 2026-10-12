#!/usr/bin/env node
// scripts/eval-report.mjs — velpari quality-evals report builder (Phase C, Lane C1).
//
// Turns rows from a workspace's `Eval/<project>/eval.db` into the LOCKED
// eval-report JSON contract (Phase C plan). The builder is a PURE function
// (`buildReport`, no IO) so it is unit-testable; ALL `node:sqlite` access lives
// in the CLI/IO path and opens the DB READ-ONLY (never writes). Node built-ins
// only — no new dependencies.
//
// CLI:
//   node scripts/eval-report.mjs --db <path> --project <name> [--run-id <id>]
//                                 [--mission <slug>] [--model <id>] [--out <file>]
//   node scripts/eval-report.mjs --workspace <dir> [--project <name>] [--out <file>]
//   node scripts/eval-report.mjs --help
//
// Report contract (reportVersion 1):
//   { reportVersion, generatedAt, model, missions: [ { mission, runId, status,
//     stages: [ { stage, totalScore, detScores, judgeOverall, judgeModel,
//     rubricId, rubricVersion, rubricHash, detConfigHash, attempts } ],
//     overallMean } ] }
// Rules: stages follow velpari stage order; judge fields null until Phase B2
// judged rows exist; overallMean = mean of stage totalScores (unweighted v1);
// missing stage rows → stage omitted + status `partial` (no rows → `failed`).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Locked report schema version. */
export const REPORT_VERSION = 1;

/**
 * Velpari stage keys in publish order. These are the IN-PROGRESS enum values
 * stored in `eval_runs.stage` (ops/approve.ts `STAGE_APPROVE_MAP[*].stages[0]`).
 */
export const STAGE_ORDER = [
	"drafting-prd",
	"building-rtm",
	"analyzing-feasibility",
	"designing",
	"analyzing-atomic-functions",
	"writing-pseudocode",
	"planning-tests",
	"ordering-development",
	"finalizing-design",
];

/** Rank of a stage for ordering; unknown stages sort last (stable). */
function stageRank(stage) {
	const i = STAGE_ORDER.indexOf(stage);
	return i === -1 ? STAGE_ORDER.length : i;
}

/** Read a field from a row that may use camelCase (EvalRow) or snake_case (SQL). */
function field(row, camel, snake) {
	if (row == null) return undefined;
	if (row[camel] !== undefined) return row[camel];
	return row[snake];
}

/** Coerce to a finite number, else `fallback`. */
function numberOr(value, fallback) {
	if (value === null || value === undefined || value === "") return fallback;
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalize a raw `det_scores` value (JSON text or array) to `{ name, score }[]`.
 * @param {unknown} raw
 * @returns {{ name: string, score: number }[]}
 */
export function parseDetScores(raw) {
	let arr = raw;
	if (typeof raw === "string") {
		try {
			arr = JSON.parse(raw);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(arr)) return [];
	return arr
		.filter((x) => x && typeof x === "object")
		.map((x) => ({ name: String(x.name ?? ""), score: numberOr(x.score, 0) }));
}

/**
 * Normalize a raw `judge_scores` value (JSON text, object, or null) to the
 * report's judge fields. Returns null when absent/unparseable (deterministic-only row).
 * @param {unknown} raw
 * @returns {{ judgeOverall: number|null, judgeModel: string|null, rubricId: string|null, rubricVersion: unknown, rubricHash: string|null }|null}
 */
export function parseJudgeScores(raw) {
	if (raw === null || raw === undefined || raw === "") return null;
	let v = raw;
	if (typeof v === "string") {
		try {
			v = JSON.parse(v);
		} catch {
			return null;
		}
	}
	if (!v || typeof v !== "object" || Array.isArray(v)) return null;
	return {
		judgeOverall: numberOr(v.overall, null),
		judgeModel: v.judgeModel == null ? null : String(v.judgeModel),
		rubricId: v.rubricId == null ? null : String(v.rubricId),
		rubricVersion: v.rubricVersion == null ? null : v.rubricVersion,
		rubricHash: v.rubricHash == null ? null : String(v.rubricHash),
	};
}

/** Keep only the newest row per stage (by created_at, then id), preserving input order ties. */
function latestPerStage(rows) {
	const sorted = [...rows].sort((a, b) => {
		const ca = String(field(a, "createdAt", "created_at") ?? "");
		const cb = String(field(b, "createdAt", "created_at") ?? "");
		if (ca !== cb) return ca < cb ? -1 : 1;
		const ia = numberOr(field(a, "id", "id"), 0);
		const ib = numberOr(field(b, "id", "id"), 0);
		return ia - ib;
	});
	const map = new Map();
	for (const row of sorted) map.set(String(row.stage), row);
	return map;
}

/** Unweighted mean; empty → 0. */
function mean(values) {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Build ONE mission entry from eval rows (pure).
 * @param {Array<Record<string, unknown>>} rows - Rows (camelCase or snake_case).
 * @param {{ mission?: string|null, runId?: string|null, status?: string|null }} [opts]
 * @returns {object} The mission entry per the locked contract.
 */
export function buildMissionEntry(rows, opts = {}) {
	const all = Array.isArray(rows) ? rows : [];
	const requestedRunId = opts.runId == null ? null : String(opts.runId);
	const filtered = requestedRunId
		? all.filter((r) => String(field(r, "runId", "run_id")) === requestedRunId)
		: all;

	const byStage = latestPerStage(filtered);
	const orderedStages = [...byStage.keys()].sort((a, b) => stageRank(a) - stageRank(b));

	const derivedRunId =
		requestedRunId ??
		(filtered.length > 0 ? String(field(filtered[0], "runId", "run_id") ?? "") || null : null);

	const stages = orderedStages.map((stage) => {
		const row = byStage.get(stage);
		const judge = parseJudgeScores(field(row, "judgeScores", "judge_scores"));
		return {
			stage,
			totalScore: numberOr(field(row, "totalScore", "total_score"), 0),
			detScores: parseDetScores(field(row, "detScores", "det_scores")),
			judgeOverall: judge ? judge.judgeOverall : null,
			judgeModel: judge ? judge.judgeModel : null,
			rubricId: judge ? judge.rubricId : null,
			rubricVersion: judge ? judge.rubricVersion : null,
			rubricHash: judge ? judge.rubricHash : null,
			detConfigHash: String(field(row, "detConfigHash", "det_config_hash") ?? ""),
			attempts: field(row, "attempts", "attempts") ?? null,
		};
	});

	// Status: explicit override wins; else completed (all known stages present),
	// partial (some rows), failed (no rows).
	let computedStatus;
	if (stages.length === 0) {
		computedStatus = "failed";
	} else {
		const knownPresent = stages.filter((s) => STAGE_ORDER.includes(s.stage)).length;
		computedStatus = knownPresent === STAGE_ORDER.length ? "completed" : "partial";
	}

	return {
		mission: opts.mission ?? null,
		runId: derivedRunId,
		status: opts.status ?? computedStatus,
		stages,
		overallMean: mean(stages.map((s) => s.totalScore)),
	};
}

/**
 * Build the full locked report (pure). Primary form:
 * `buildReport(rows, { model, mission, runId })`. Pass `missions` (array of
 * `{ rows, mission, runId, status }`) to emit several mission entries at once.
 * @param {Array<Record<string, unknown>>} rows - Eval rows (any shape).
 * @param {object} [opts]
 * @returns {object} Locked report JSON object.
 */
export function buildReport(rows, opts = {}) {
	const entries = Array.isArray(opts.missions)
		? opts.missions.map((m) =>
				buildMissionEntry(m.rows ?? rows, { mission: m.mission, runId: m.runId, status: m.status }),
			)
		: [buildMissionEntry(rows, { mission: opts.mission, runId: opts.runId, status: opts.status })];
	return {
		reportVersion: REPORT_VERSION,
		generatedAt: opts.generatedAt ?? new Date().toISOString(),
		model: opts.model ?? null,
		missions: entries,
	};
}

// ---------------------------------------------------------------------------
// IO — CLI path only (read-only)
// ---------------------------------------------------------------------------

/**
 * Read eval rows from an eval DB, READ-ONLY. `node:sqlite` is imported lazily
 * so the pure builder can be imported without loading the experimental module.
 * @param {string} dbPath
 * @param {{ project?: string|null, runId?: string|null }} [opts]
 * @returns {Promise<Array<Record<string, unknown>>>} Raw snake_case rows, oldest first.
 */
export async function readEvalRows(dbPath, opts = {}) {
	const { DatabaseSync } = await import("node:sqlite");
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const clauses = [];
		const params = [];
		if (opts.project) {
			clauses.push("project = ?");
			params.push(opts.project);
		}
		if (opts.runId) {
			clauses.push("run_id = ?");
			params.push(opts.runId);
		}
		const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
		return db.prepare(`SELECT * FROM eval_runs${where} ORDER BY created_at ASC, id ASC`).all(...params);
	} finally {
		db.close();
	}
}

/** Read `projectName` from a workspace's `.pi/velpari/files.json` (null when absent). */
export function readProjectName(workspace) {
	try {
		const file = join(workspace, ".pi", "velpari", "files.json");
		const json = JSON.parse(readFileSync(file, "utf8"));
		return json.projectName ? String(json.projectName) : null;
	} catch {
		return null;
	}
}

/** Find `Eval/<project>/eval.db` files under a workspace (absolute paths). */
export function scanEvalDbs(workspace) {
	const root = join(workspace, "Eval");
	if (!existsSync(root)) return [];
	const out = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const db = join(root, entry.name, "eval.db");
		try {
			if (statSync(db).isFile()) out.push(db);
		} catch {
			// not a file — skip
		}
	}
	return out;
}

/**
 * Resolve the target DB path + project from CLI args. Never throws.
 * @returns {{ dbPath: string|null, project: string|null, error: string|null }}
 */
export function resolveTarget(args) {
	if (args.dbPath) return { dbPath: args.dbPath, project: args.project ?? null, error: null };
	if (!args.workspace) {
		return { dbPath: null, project: null, error: "provide --db <path> or --workspace <dir>" };
	}
	const project = args.project ?? readProjectName(args.workspace);
	if (project) {
		const dbPath = join(args.workspace, "Eval", project, "eval.db");
		return { dbPath, project, error: null };
	}
	const found = scanEvalDbs(args.workspace);
	if (found.length === 1) return { dbPath: found[0], project: basename(dirname(found[0])), error: null };
	if (found.length === 0) return { dbPath: null, project: null, error: `no eval DB found under ${join(args.workspace, "Eval")}` };
	return { dbPath: null, project: null, error: `multiple eval DBs found — pass --project (${found.join(", ")})` };
}

/**
 * Parse eval-report CLI args.
 * @param {string[]} argv
 * @returns {object} Parsed args (with `help`/`error`).
 */
export function parseReportArgs(argv) {
	const args = {
		dbPath: null,
		workspace: null,
		project: null,
		runId: null,
		mission: null,
		model: null,
		out: null,
		help: false,
		error: null,
	};
	const positionals = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		switch (a) {
			case "--help":
			case "-h":
				args.help = true;
				break;
			case "--db":
			case "--eval-db":
				args.dbPath = next() ?? null;
				break;
			case "--workspace":
				args.workspace = next() ?? null;
				break;
			case "--project":
				args.project = next() ?? null;
				break;
			case "--run-id":
				args.runId = next() ?? null;
				break;
			case "--mission":
				args.mission = next() ?? null;
				break;
			case "--model":
				args.model = next() ?? null;
				break;
			case "--out":
				args.out = next() ?? null;
				break;
			default:
				if (a.startsWith("--")) args.error = `unknown option: ${a}`;
				else positionals.push(a);
		}
	}
	if (!args.help && !args.error && !args.dbPath && positionals.length === 1) args.dbPath = positionals[0];
	else if (!args.help && !args.error && positionals.length > 1) args.error = `unexpected arguments: ${positionals.join(" ")}`;
	return args;
}

/** Usage text. */
export function usage() {
	return [
		"Usage: node scripts/eval-report.mjs [options]",
		"",
		"Input (one of):",
		"  --db <path>          path to Eval/<project>/eval.db",
		"  --workspace <dir>    workspace root; resolves Eval/<project>/eval.db",
		"",
		"Options:",
		"  --project <name>     eval DB project name (filter / DB resolution)",
		"  --run-id <id>        restrict rows to one velpari run id",
		"  --mission <slug>     mission slug stamped into the report",
		"  --model <id>         parent model id stamped into the report",
		"  --out <file>         write the report JSON to a file (default: stdout)",
		"  --help               show this help",
	].join("\n");
}

/** CLI entry. Returns an exit code. */
export async function main(argv) {
	const args = parseReportArgs(argv);
	if (args.help) {
		process.stdout.write(`${usage()}\n`);
		return 0;
	}
	if (args.error) {
		process.stderr.write(`eval-report: ${args.error}\n${usage()}\n`);
		return 2;
	}
	const target = resolveTarget(args);
	if (target.error) {
		process.stderr.write(`eval-report: ${target.error}\n`);
		return 2;
	}
	if (!existsSync(target.dbPath)) {
		process.stderr.write(`eval-report: eval DB not found: ${target.dbPath}\n`);
		return 2;
	}
	let rows;
	try {
		rows = await readEvalRows(target.dbPath, { project: target.project, runId: args.runId });
	} catch (err) {
		process.stderr.write(`eval-report: failed to read ${target.dbPath}: ${err?.message ?? err}\n`);
		return 2;
	}
	const report = buildReport(rows, {
		model: args.model,
		mission: args.mission ?? target.project,
		runId: args.runId,
	});
	const json = `${JSON.stringify(report, null, 2)}\n`;
	if (args.out) {
		mkdirSync(dirname(resolve(args.out)), { recursive: true });
		writeFileSync(resolve(args.out), json);
		process.stderr.write(
			`eval-report: wrote ${args.out} (${report.missions[0]?.stages.length ?? 0} stage rows)\n`,
		);
	} else {
		process.stdout.write(json);
	}
	return 0;
}

const isMain =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			process.stderr.write(`eval-report: unexpected error: ${err?.stack ?? err}\n`);
			process.exit(2);
		},
	);
}
