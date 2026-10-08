/**
 * N25 continuity dry-run — Tier-1 CI wrapper.
 *
 * Spawns `node scripts/e2e-continuity-dryrun.js` (the deterministic chain
 * driver: brainstorm → PRD → RTM → feasibility → design → atomic →
 * pseudocode → testplan → development-order → final-design → handoff in a
 * throwaway workspace) and re-derives the N25 assertions from the report
 * files it writes — never from the driver's own console summary:
 *
 *   1. exit code 0 (driver green = every row either ok or KNOWN-FAIL);
 *   2. `assertions.json` reports zero unexpected failures and an empty
 *      stale-ledger list;
 *   3. every id in `Doc/test-fixtures/continuity/expected-failures.json`
 *      was observed as a `knownDefect` on at least one failed row (a
 *      ledger entry nobody reproduces is a stale ledger = fail);
 *   4. the four-assertion core holds per stage: publish advanced, store
 *      rows exported, doctor reported 0 unexpected errors, entry
 *      unblocked — plus the end-of-chain rows (`handoff-advanced`,
 *      `payload-schema`, `hash-chain-verified`);
 *   5. `failures.jsonl` rows all carry `knownDefect` (cross-check of 2)
 *      and `summary.md` exists.
 *
 * Tier 1 only (RUN_E2E=1 + pi on PATH + built dist) — rides the existing
 * `test:e2e` glob with zero workflow edits. No LLM call: the driver mocks
 * ctx/pi in-process.
 *
 * Known-defect ledger ruling (Phase E interview): a failure whose id is
 * in the checked-in ledger is a pass; an unexpected failure or a stale
 * ledger entry fails this test.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";

import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

/** Repo root (cwd for the spawn is the repo root — `npm test` runs from there). */
const REPO_ROOT = process.cwd();

/** Path to the N25 driver script (ESM `.js`, repo `"type": "module"`). */
const DRIVER = join(REPO_ROOT, "scripts", "e2e-continuity-dryrun.js");

/** The checked-in known-defect ledger the run must reproduce exactly. */
const LEDGER_PATH = join(REPO_ROOT, "Doc", "test-fixtures", "continuity", "expected-failures.json");

/** Wrapper-owned report root (removed after the test — keeps `.tmp` clean). */
let reportRoot: string | undefined;

/**
 * Read + parse a JSON report file from the driver's run directory.
 * @param runDir - The `continuity-dryrun-<ts>` run directory.
 * @param name - File name inside the run directory.
 * @returns The parsed JSON value.
 */
function readReport(runDir: string, name: string): unknown {
	const path = join(runDir, name);
	assert.ok(existsSync(path), `driver report missing: ${path}`);
	return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Shape of one recorded assertion row in `assertions.json`.
 */
interface ResultRow {
	stage: string;
	id: string;
	desc: string;
	ok: boolean;
	detail?: string;
	knownDefect?: string;
}

/**
 * The driver's `assertions.json` envelope.
 */
interface AssertionsReport {
	total: number;
	unexpected: number;
	staleLedger: string[];
	results: ResultRow[];
}

/**
 * Find the single `continuity-dryrun-<ts>` run directory under the wrapper
 * report root (the driver creates exactly one per spawn).
 * @param root - Report root passed to the driver as argv[3].
 * @returns Absolute path of the run directory.
 */
function findRunDir(root: string): string {
	const runs = readdirSync(root).filter((e) => e.startsWith("continuity-dryrun-"));
	assert.equal(runs.length, 1, `expected exactly one run dir under ${root}, found: ${runs.join(", ")}`);
	return join(root, runs[0] as string);
}

describe("e2e/continuity-dryrun", () => {
	after(() => {
		if (reportRoot && existsSync(reportRoot)) rmSync(reportRoot, { recursive: true, force: true });
	});

	it("N25 chain driver is green with a clean known-defect ledger", { timeout: 600_000 }, (t) => {
		if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
		assert.ok(existsSync(DRIVER), `driver missing: ${DRIVER}`);

		mkdirSync(join(REPO_ROOT, ".tmp"), { recursive: true });
		reportRoot = mkdtempSync(join(REPO_ROOT, ".tmp", "continuity-e2e-"));
		const run = spawnSync(process.execPath, [DRIVER, "", reportRoot], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			timeout: 540_000,
			maxBuffer: 32 * 1024 * 1024,
		});

		const runDir = existsSync(reportRoot) ? findRunDir(reportRoot) : "";
		const tail = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.slice(-4000);
		assert.equal(run.status, 0, `driver exited ${run.status} — tail:\n${tail}`);

		// 1. Report envelope: zero unexpected, no stale ledger entries.
		const report = readReport(runDir, "assertions.json") as AssertionsReport;
		assert.equal(
			report.unexpected,
			0,
			`unexpected failures: ${JSON.stringify(
				report.results.filter((r) => !r.ok && !r.knownDefect),
				null,
				2,
			)}`,
		);
		assert.deepEqual(
			report.staleLedger,
			[],
			`stale ledger entries (listed but never observed): ${report.staleLedger.join(", ")}`,
		);

		// 2. Every checked-in ledger id was observed on a failed row.
		const ledger = readFileSync(LEDGER_PATH, "utf8");
		const ledgerIds = (JSON.parse(ledger) as { ledger: { id: string }[] }).ledger.map((e) => e.id);
		const observed = new Set(report.results.filter((r) => !r.ok && r.knownDefect).map((r) => r.knownDefect as string));
		const unobserved = ledgerIds.filter((id) => !observed.has(id));
		assert.deepEqual(unobserved, [], `ledger ids not reproduced by this run: ${unobserved.join(", ")}`);

		// 3. Four-assertion core per stage + end-of-chain rows.
		/**
		 * True when the given stage/id assertion row passed.
		 * @param {string} stage - Stage key (or "handoff").
		 * @param {string} id - Assertion id to look up.
		 * @returns {boolean} True when an ok row matches stage + id.
		 */
		const ok = (stage: string, id: string): boolean =>
			report.results.some((r) => r.stage === stage && r.id === id && r.ok);
		const stages = [
			"prd",
			"rtm",
			"feasibility",
			"architecture-generator",
			"atomic-function",
			"pseudocode",
			"testplan",
			"development-order",
			"final-design",
		];
		for (const stage of stages) {
			assert.ok(ok(stage, "publish-advanced"), `${stage}: publish did not advance (publish-advanced not ok)`);
			assert.ok(ok(stage, "store-rows"), `${stage}: store YAML export row missing/not ok`);
			assert.ok(ok(stage, "doctor-errors-other"), `${stage}: doctor reported unexpected errors`);
			assert.ok(ok(stage, "entry-unblocked"), `${stage}: stage entry blocked`);
		}
		assert.ok(ok("handoff", "handoff-advanced"), "handoff did not reach handoff-ready");
		assert.ok(ok("handoff", "payload-schema"), "architect-inputs.json missing or schema-invalid");
		assert.ok(ok("handoff", "hash-chain-verified"), "audit hash chain not verified");

		// 4. failures.jsonl cross-check: every failed row is a known defect.
		const failuresPath = join(runDir, "failures.jsonl");
		assert.ok(existsSync(failuresPath), `failures.jsonl missing: ${failuresPath}`);
		const failureRows = readFileSync(failuresPath, "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.map((l) => JSON.parse(l) as ResultRow);
		const unexpectedRows = failureRows.filter((r) => !r.knownDefect);
		assert.deepEqual(
			unexpectedRows,
			[],
			`failures.jsonl carries rows without knownDefect: ${JSON.stringify(unexpectedRows)}`,
		);

		// 5. summary.md exists (human artifact of the run).
		assert.ok(existsSync(join(runDir, "summary.md")), "summary.md missing");
	});
});
