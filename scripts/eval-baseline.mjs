#!/usr/bin/env node
// scripts/eval-baseline.mjs — velpari golden-eval baseline checker (Phase C, Lane C2).
//
// The CI quality gate needs a reference to compare against. This module is that
// reference layer:
//
//   * `record` mode copies a golden-run report JSON to the committed baseline
//     path `Doc/test-fixtures/eval-baselines/<model-slug>/<mission>.baseline.json`.
//     Baselines are captured from the FIRST green dispatch (a human step) and
//     are never auto-written by CI.
//   * `check` mode compares a fresh report against its baseline with
//     per-stage tolerance bands: `floor = baseline.totalScore - band`
//     (band default 0.15, `--band` / `EVAL_BASELINE_BAND`). Within band → exit 0;
//     any stage below floor → exit 1 with a human-readable diff.
//
// G3 — NEVER exact-match on LLM-produced scores. The gate is a floor + band, so
// benign run-to-run variance passes and only a real regression trips it.
// Fail-open: a missing (or unusable/empty) baseline exits 0 with a "no baseline
// yet" note. The gate never blocks before it has a reference. A corrupt report
// or baseline file IS an error (exit 2) — fail-open is about absence, not
// malformed data.
//
// Node built-ins only. Import is side-effect free (main() is guarded), so the
// pure helpers are unit-testable.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repository root (scripts/ lives one level down). */
export const PROJECT_ROOT = resolve(HERE, "..");
/** Committed baseline root. Layout: `<dir>/<model-slug>/<mission>.baseline.json`. */
export const DEFAULT_BASELINE_DIR = join(PROJECT_ROOT, "Doc", "test-fixtures", "eval-baselines");
/** Default per-stage tolerance band (baseline totalScore − band = floor). */
export const DEFAULT_BAND = 0.15;
/** Locked report schema version this checker understands. */
export const REPORT_VERSION = 1;
/** Baseline file suffix. */
export const BASELINE_SUFFIX = ".baseline.json";

// ---------------------------------------------------------------------------
// Path safety + slugs
// ---------------------------------------------------------------------------

/**
 * Sanitize a model id into a single directory-name slug. Never returns a path
 * separator or a traversal segment (`..`); a blank/unsafe id becomes
 * `unknown-model` so the caller can still build a safe path.
 * @param {unknown} model
 * @returns {string}
 */
export function modelSlug(model) {
	const raw = String(model ?? "").trim();
	if (!raw) return "unknown-model";
	const slug = raw
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!slug || slug === "." || slug === ".." || slug.includes("..")) return "unknown-model";
	return slug;
}

/**
 * Sanitize a mission slug into a single filename segment. Returns `null` for a
 * blank/traversal value (caller treats that as a hard error).
 * @param {unknown} mission
 * @returns {string|null}
 */
export function safeMissionSlug(mission) {
	const raw = String(mission ?? "").trim();
	const slug = raw
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!slug || slug === "." || slug === ".." || slug.includes("..")) return null;
	return slug;
}

/**
 * Baseline file path for a model + mission. Returns `null` when the mission
 * slug is invalid (path safety).
 * @param {string} baselineDir
 * @param {unknown} model
 * @param {unknown} mission
 * @returns {string|null}
 */
export function baselinePath(baselineDir, model, mission) {
	const ms = safeMissionSlug(mission);
	if (!ms) return null;
	return join(baselineDir, modelSlug(model), `${ms}${BASELINE_SUFFIX}`);
}

// ---------------------------------------------------------------------------
// Report parsing / IO
// ---------------------------------------------------------------------------

/**
 * Parse a report JSON string and validate the locked contract envelope.
 * @param {string} text
 * @returns {{ ok: true, report: object } | { ok: false, error: string }}
 */
export function parseReportText(text) {
	let report;
	try {
		report = JSON.parse(text);
	} catch (err) {
		return { ok: false, error: `invalid JSON: ${err?.message ?? err}` };
	}
	if (!report || typeof report !== "object" || Array.isArray(report)) {
		return { ok: false, error: "report is not an object" };
	}
	if (report.reportVersion !== REPORT_VERSION) {
		return { ok: false, error: `unsupported reportVersion: ${report.reportVersion}` };
	}
	if (!Array.isArray(report.missions)) {
		return { ok: false, error: "report.missions must be an array" };
	}
	return { ok: true, report };
}

/**
 * Read + parse a report file. Never throws.
 * @param {string|null|undefined} file
 * @returns {{ ok: true, report: object } | { ok: false, error: string }}
 */
export function readReportFile(file) {
	if (!file) return { ok: false, error: "no report path provided" };
	if (!existsSync(file)) return { ok: false, error: `report not found: ${file}` };
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch (err) {
		return { ok: false, error: `cannot read report ${file}: ${err?.message ?? err}` };
	}
	const parsed = parseReportText(text);
	if (!parsed.ok) return { ok: false, error: `${file}: ${parsed.error}` };
	return parsed;
}

// ---------------------------------------------------------------------------
// Comparison (pure)
// ---------------------------------------------------------------------------

/** Coerce to a finite number, else fallback. */
function num(value, fallback = null) {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * Compare ONE fresh mission entry against its baseline mission entry.
 * Per-stage floor = baseline.totalScore − band. A stage present in the baseline
 * but missing from the fresh report is a breach (an incomplete run is a
 * regression). A stage present only in the fresh report is informational
 * (the baseline could not judge it) and never a breach.
 * @param {object} fresh
 * @param {object} baseline
 * @param {number} [band]
 * @returns {object}
 */
export function compareMission(fresh, baseline, band = DEFAULT_BAND) {
	const freshStages = Array.isArray(fresh?.stages) ? fresh.stages : [];
	const baseStages = Array.isArray(baseline?.stages) ? baseline.stages : [];
	const freshByStage = new Map(freshStages.map((s) => [String(s?.stage), s]));
	const baseByStage = new Map(baseStages.map((s) => [String(s?.stage), s]));

	const stages = [];
	let breached = false;
	let detConfigChanged = false;

	for (const [stage, bs] of baseByStage) {
		const baselineScore = num(bs?.totalScore, 0);
		const fs = freshByStage.get(stage);
		if (!fs) {
			breached = true;
			stages.push({
				stage,
				baseline: baselineScore,
				fresh: null,
				floor: baselineScore - band,
				delta: null,
				ok: false,
				missing: true,
				newStage: false,
				detConfigChanged: false,
			});
			continue;
		}
		const freshScore = num(fs?.totalScore, 0);
		const floor = baselineScore - band;
		const ok = freshScore >= floor - 1e-9;
		if (!ok) breached = true;
		const changed = String(fs?.detConfigHash ?? "") !== String(bs?.detConfigHash ?? "");
		if (changed) detConfigChanged = true;
		stages.push({
			stage,
			baseline: baselineScore,
			fresh: freshScore,
			floor,
			delta: freshScore - baselineScore,
			ok,
			missing: false,
			newStage: false,
			detConfigChanged: changed,
		});
	}
	for (const [stage, fs] of freshByStage) {
		if (baseByStage.has(stage)) continue;
		stages.push({
			stage,
			baseline: null,
			fresh: num(fs?.totalScore, 0),
			floor: null,
			delta: null,
			ok: true,
			missing: false,
			newStage: true,
			detConfigChanged: false,
		});
	}

	return {
		mission: fresh?.mission ?? baseline?.mission ?? null,
		stages,
		breached,
		detConfigChanged,
		usable: baseByStage.size > 0,
	};
}

/**
 * Compare a fresh report against the committed baselines (pure apart from the
 * read-only baseline file reads). Fail-open: a missing or unusable baseline is
 * `status: "no-baseline"` and never breaches. A corrupt baseline file is an
 * entry in `errors` (the caller maps that to exit 2).
 * @param {object} freshReport
 * @param {{ baselineDir?: string, band?: number, model?: string|null }} [opts]
 * @returns {object}
 */
export function compareReport(freshReport, opts = {}) {
	const baselineDir = opts.baselineDir ?? DEFAULT_BASELINE_DIR;
	const band = opts.band ?? DEFAULT_BAND;
	const modelId = opts.model ?? freshReport?.model ?? null;

	const missions = [];
	const errors = [];
	let breached = false;
	let hasBaseline = false;

	for (const fresh of freshReport?.missions ?? []) {
		const mission = fresh?.mission;
		const path = baselinePath(baselineDir, modelId, mission);
		if (!path) {
			errors.push(`invalid mission slug: ${JSON.stringify(mission)}`);
			continue;
		}
		if (!existsSync(path)) {
			missions.push({
				mission,
				baselinePath: path,
				status: "no-baseline",
				stages: [],
				breached: false,
				usable: false,
				detConfigChanged: false,
			});
			continue;
		}
		hasBaseline = true;
		const read = readReportFile(path);
		if (!read.ok) {
			errors.push(read.error);
			continue;
		}
		const baseMission = (read.report.missions ?? []).find((m) => String(m?.mission) === String(mission));
		if (!baseMission) {
			errors.push(`baseline ${path} has no mission ${JSON.stringify(mission)}`);
			continue;
		}
		const cmp = compareMission(fresh, baseMission, band);
		if (!cmp.usable) {
			missions.push({
				mission,
				baselinePath: path,
				status: "no-baseline",
				stages: cmp.stages,
				breached: false,
				usable: false,
				detConfigChanged: cmp.detConfigChanged,
			});
			continue;
		}
		if (cmp.breached) breached = true;
		missions.push({
			mission,
			baselinePath: path,
			status: cmp.breached ? "breach" : "pass",
			stages: cmp.stages,
			breached: cmp.breached,
			usable: true,
			detConfigChanged: cmp.detConfigChanged,
		});
	}

	return { reportVersion: REPORT_VERSION, model: modelId, band, baselineDir, missions, breached, errors, hasBaseline };
}

// ---------------------------------------------------------------------------
// Record (write baseline)
// ---------------------------------------------------------------------------

/**
 * Write a report JSON to the committed baseline path(s) — one file per mission.
 * @param {{ report: object, baselineDir?: string, model?: string|null }} args
 * @returns {{ ok: true, written: string[], model: string } | { ok: false, error: string }}
 */
export function recordReport(args) {
	const baselineDir = args.baselineDir ?? DEFAULT_BASELINE_DIR;
	const modelId = args.model ?? args.report?.model ?? null;
	if (!modelId) return { ok: false, error: "report has no model; pass --model <id>" };

	const written = [];
	for (const mission of args.report?.missions ?? []) {
		const path = baselinePath(baselineDir, modelId, mission?.mission);
		if (!path) return { ok: false, error: `invalid mission slug: ${JSON.stringify(mission?.mission)}` };
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(args.report, null, 2)}\n`);
		written.push(path);
	}
	if (written.length === 0) return { ok: false, error: "report has no missions to record" };
	return { ok: true, written, model: modelId };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Fixed 3-decimal display for a score, or `n/a` when null. */
function fmt(value) {
	return value === null || value === undefined || !Number.isFinite(Number(value)) ? "n/a" : Number(value).toFixed(3);
}

/**
 * Human-readable multi-line summary of a `compareReport` result.
 * @param {object} result
 * @returns {string}
 */
export function formatComparison(result) {
	const lines = [];
	lines.push(`eval-baseline: model=${result.model ?? "(none)"} band=${fmt(result.band)}`);
	for (const m of result.missions) {
		const label = m.baselinePath ? ` [${m.baselinePath}]` : "";
		if (m.status === "no-baseline") {
			lines.push(`[${m.mission}] NO BASELINE YET — fail-open, skipping${label}`);
		} else if (m.status === "pass") {
			lines.push(`[${m.mission}] PASS${label}`);
		} else {
			lines.push(`[${m.mission}] FAIL — stage(s) below floor${label}`);
		}
		for (const s of m.stages) {
			const tag = s.missing ? "MISSING" : s.newStage ? "new" : s.ok ? "ok" : "BREACH";
			const extra = s.detConfigChanged ? " (scoring-config changed)" : "";
			lines.push(
				`  ${String(s.stage).padEnd(26)} baseline=${fmt(s.baseline)} fresh=${fmt(s.fresh)} ` +
					`floor=${fmt(s.floor)} delta=${s.delta === null ? "n/a" : `${s.delta >= 0 ? "+" : ""}${fmt(s.delta)}`} ${tag}${extra}`,
			);
		}
	}
	for (const err of result.errors) lines.push(`[error] ${err}`);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse eval-baseline CLI args.
 * @param {string[]} argv
 * @returns {object}
 */
export function parseBaselineArgs(argv) {
	const args = {
		mode: null,
		report: null,
		baselineDir: null,
		model: null,
		band: null,
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
			case "--report":
				args.report = next() ?? null;
				break;
			case "--baseline-dir":
				args.baselineDir = next() ?? null;
				break;
			case "--model":
				args.model = next() ?? null;
				break;
			case "--band":
				args.band = next() ?? null;
				break;
			case "record":
			case "check":
				if (args.mode && args.mode !== a) args.error = `conflicting modes: ${args.mode} and ${a}`;
				else args.mode = a;
				break;
			default:
				if (a.startsWith("--")) args.error = `unknown option: ${a}`;
				else if (!args.mode && (a === "record" || a === "check")) args.mode = a;
				else positionals.push(a);
		}
	}
	if (positionals.length > 0 && !args.error) args.error = `unexpected argument: ${positionals[0]}`;
	return args;
}

/** Usage text. */
export function usage() {
	return [
		"Usage: node scripts/eval-baseline.mjs <record|check> --report <report.json> [options]",
		"",
		"Modes:",
		"  record   copy a golden-run report to the committed baseline path",
		"  check    compare a fresh report against its baseline (tolerance bands)",
		"",
		"Options:",
		"  --report <file>        eval-report JSON to read (required)",
		`  --baseline-dir <dir>   baseline root (default: ${DEFAULT_BASELINE_DIR})`,
		"  --model <id>           override the model id used for the baseline path",
		`  --band <n>             tolerance band, floor = baseline - band (default: ${DEFAULT_BAND})`,
		"  --help                 show this help",
		"",
		"Exit codes: 0 pass / fail-open, 1 breach, 2 usage or IO/parse error.",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function resolveBand(raw) {
	if (raw === null || raw === undefined || raw === "") {
		const env = process.env.EVAL_BASELINE_BAND;
		if (env === undefined || env === "") return DEFAULT_BAND;
		const n = Number(env);
		return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BAND;
	}
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/** CLI entry. Returns an exit code. */
export async function main(argv) {
	const args = parseBaselineArgs(argv);
	if (args.help) {
		process.stdout.write(`${usage()}\n`);
		return 0;
	}
	if (args.error) {
		process.stderr.write(`eval-baseline: ${args.error}\n${usage()}\n`);
		return 2;
	}
	if (!args.mode) {
		process.stderr.write(`eval-baseline: a mode (record|check) is required\n${usage()}\n`);
		return 2;
	}
	if (!args.report) {
		process.stderr.write(`eval-baseline: --report <file> is required\n${usage()}\n`);
		return 2;
	}
	const band = resolveBand(args.band);
	if (band === null) {
		process.stderr.write(`eval-baseline: --band must be a non-negative number, got ${args.band}\n`);
		return 2;
	}
	const read = readReportFile(args.report);
	if (!read.ok) {
		process.stderr.write(`eval-baseline: ${read.error}\n`);
		return 2;
	}
	const baselineDir = args.baselineDir ? resolve(args.baselineDir) : DEFAULT_BASELINE_DIR;

	if (args.mode === "record") {
		const res = recordReport({ report: read.report, baselineDir, model: args.model });
		if (!res.ok) {
			process.stderr.write(`eval-baseline: ${res.error}\n`);
			return 2;
		}
		for (const path of res.written) process.stdout.write(`eval-baseline: recorded ${path}\n`);
		return 0;
	}

	const result = compareReport(read.report, { baselineDir, band, model: args.model });
	process.stdout.write(`${formatComparison(result)}\n`);
	if (result.errors.length > 0) return 2;
	if (result.breached) return 1;
	return 0;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			process.stderr.write(`eval-baseline: unexpected error: ${err?.stack ?? err}\n`);
			process.exit(2);
		},
	);
}
