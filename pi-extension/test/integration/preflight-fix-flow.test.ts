/**
 * Phase 6.1 — integration: broken config → preflight → fix flow repairs →
 * original command proceeds (plan §6.1, instruction §6.2 mandatory block).
 *
 * Three in-process scenarios (conventions of `publish-gate.test.ts`,
 * temp git repos via `mkdtempSync`):
 *   1. corrupt tracked files.json → preflight row 4 blocking → `runFixFlow`
 *      (Fix all + confirm) → `config-restore-git` restores HEAD → re-run clean.
 *   2. lost stage-flag advance → preflight row 7 blocking → Fix all →
 *      `bookkeeping-advance` → state advanced with history line; negative:
 *      evidence from a DIFFERENT runId → no advance offered.
 *   3. digest contract fixture via `setContractForTests` — `checkDigestGitSection`
 *      reports ok / digest-mismatch per seeded stamp rows (no wait for B).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
	mkdirSync,
	mkdtempSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPreflight, type PreflightResult } from "../../src/doctor/preflight.js";
import { runFixFlow, type PreflightUi } from "../../src/doctor/fix-flow.js";
import { checkDigestGitSection } from "../../src/doctor/checks/digest-git.js";
import { setContractForTests, resetContractForTests, type DigestApi } from "../../src/doctor/contract.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { loadState } from "../../src/core/state.js";
import { loadHistory } from "../../src/core/history.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { publishArtifact, writeArtifact, type ArtifactEnvelopeInput } from "../../src/io/store.js";

/** Minimal DB handle the fixture stamp reader needs (no inline arrow types). */
interface FixtureStoreDb {
	/**
	 * Prepare the one-row stamp SELECT.
	 * @param {string} sql - The SELECT statement.
	 * @returns {{get: () => unknown}} A statement whose `get()` yields the row.
	 */
	prepare(sql: string): { get(): unknown };
}

let tmpDir = "";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-preflight-fix-"));
});

afterEach(() => {
	resetContractForTests();
	rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Run one git command in the fixture repo, throwing on error.
 * @param {...string} args - Arguments after `git` (e.g. `init`, `-q`).
 * @returns {void} Nothing; throws when the command fails.
 */
const git = (...args: string[]): void => {
	const r = spawnSync("git", args, { cwd: tmpDir, encoding: "utf8" });
	if (r.error) throw r.error;
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
};

/**
 * Write the minimal run state.
 * @param {string} runId - Run id to stamp.
 * @param {string} currentStage - Stage flag to write.
 * @returns {void} Nothing.
 */
function writeState(runId: string, currentStage: string): void {
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "state.json"),
		JSON.stringify({
			version: 1,
			runId,
			mission: "fix flow mission",
			currentStage,
			history: [],
			updatedAt: new Date().toISOString(),
		}),
		"utf8",
	);
}

/**
 * Seed a published PRD envelope for `runId` in the real store (bookkeeping evidence).
 * @param {string} runId - Run id stamped into the envelope.
 * @param {string} projectName - Store project (files.json is written to match).
 * @returns {void} Nothing.
 */
function publishPrd(runId: string, projectName: string): void {
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName }),
		"utf8",
	);
	const db = openStoreDb(buildStoreDbPath(projectName, tmpDir));
	try {
		const envelope: ArtifactEnvelopeInput = {
			version: 1,
			stage: "drafting-prd",
			generatedAt: "2026-09-28T00:00:00Z",
			inputs: "{}",
			reviewerVerdict: null,
			changeLog: "[]",
		};
		writeArtifact(db, "prd", runId, envelope, { fr: [] });
		publishArtifact(db, runId, "prd");
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Scripted interactive UI for the fix flow.
 * @param {string[]} selects - Labels the picker should return, in order.
 * @param {boolean} confirmAnswer - What `confirm` resolves to.
 * @returns {{ui: PreflightUi, confirms: string[]}} The UI + captured confirm messages.
 */
function scriptedUi(selects: string[], confirmAnswer: boolean): { ui: PreflightUi; confirms: string[] } {
	const confirms: string[] = [];
	const queue = [...selects];
	return {
		confirms,
		ui: {
			notify: () => {},
			select: async () => queue.shift() ?? "Abort",
			confirm: async (_title: string, message?: string) => {
				confirms.push(message ?? "");
				return confirmAnswer;
			},
		},
	};
}

/**
 * A `reRun` closure for preflight flows: ok = no blocking findings.
 * @param {string} cwd - Project root.
 * @returns {() => Promise<{ok: boolean, actionableCount: number}>} The re-audit closure.
 */
function preflightReRun(cwd: string): () => Promise<{ ok: boolean; actionableCount: number }> {
	return async () => {
		const r: PreflightResult = runPreflight(cwd, { command: "/velpari-prd", mode: "stage-start" });
		const blocking = r.findings.filter((f) => f.blocking).length;
		return { ok: r.ok, actionableCount: blocking };
	};
}

describe("integration — preflight → fix flow → command proceeds", () => {
	it("scenario 1: broken config → Fix all restores HEAD → preflight clean", async () => {
		mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
		const filesPath = join(tmpDir, ".pi", "velpari", "files.json");
		writeFileSync(filesPath, JSON.stringify({ version: 4, projectName: "FixFlowApp" }), "utf8");
		git("init", "-q");
		git("add", ".pi/velpari/files.json");
		git("-c", "user.email=t@t.local", "-c", "user.name=T", "commit", "-q", "-m", "init");
		writeFileSync(filesPath, "{broken", "utf8"); // corrupt the TRACKED working copy

		const before = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		assert.equal(before.ok, false, "row 4 must block");
		const row4 = before.findings.find((f) => f.fingerprint === "config-restore-git");
		assert.ok(row4, `expected config-restore-git finding, got ${JSON.stringify(before.findings.map((f) => f.fingerprint))}`);
		assert.equal(row4.blocking, true);
		assert.equal(row4.autoFixable, true);

		const { ui, confirms } = scriptedUi(["Fix all (Recommended)"], true);
		const outcome = await runFixFlow({
			ui,
			cwd: tmpDir,
			projectName: "FixFlowApp",
			source: { kind: "preflight", findings: before.findings },
			reRun: preflightReRun(tmpDir),
		});
		assert.equal(outcome.action, "fixed");
		assert.equal(outcome.action === "fixed" ? outcome.remainingManual : -1, 0);
		// The user saw the batch BEFORE any write (N23 write discipline).
		assert.ok(confirms.length === 1 && confirms[0]?.includes("Apply"), "confirm must carry the batch list");

		// Repaired: files.json parses again (restored from HEAD) and the
		// original command's preflight now passes — nothing else needed.
		const restored = JSON.parse(readFileSync(filesPath, "utf8"));
		assert.equal(restored.projectName, "FixFlowApp");
		const after = runPreflight(tmpDir, { command: "/velpari-prd", mode: "stage-start" });
		assert.equal(after.ok, true, "preflight must be clean after the fix");
	});

	it("scenario 2: lost stage-flag advance auto-fixes; a foreign runId offers no advance", async () => {
		// Positive: same-run evidence.
		writeState("run-fixflow", "drafting-prd");
		publishPrd("run-fixflow", "FixFlowApp");

		const before = runPreflight(tmpDir, { command: "/velpari-prd-approve", mode: "stage-start" });
		const row7 = before.findings.find((f) => f.fingerprint === "bookkeeping-advance");
		assert.ok(row7, "row 7 must detect the lost advance");
		assert.equal(row7.blocking, true);

		const { ui } = scriptedUi(["Fix all (Recommended)"], true);
		const outcome = await runFixFlow({
			ui,
			cwd: tmpDir,
			projectName: "FixFlowApp",
			source: { kind: "preflight", findings: before.findings },
			reRun: preflightReRun(tmpDir),
		});
		assert.equal(outcome.action, "fixed");
		assert.equal(loadState(tmpDir).currentStage, "drafted-prd", "bookkeeping-advance must advance the flag");
		const history = loadHistory(tmpDir, "run-fixflow");
		assert.ok(history.length >= 1, "the audited history line must exist");
		const after = runPreflight(tmpDir, { command: "/velpari-prd-approve", mode: "stage-start" });
		assert.equal(after.ok, true, "row 7 must be clean after the advance");

		// Negative: evidence belongs to ANOTHER runId → no drift → no advance.
		writeState("run-foreign", "drafting-prd");
		publishPrd("some-other-run", "FixFlowApp");
		const neg = runPreflight(tmpDir, { command: "/velpari-prd-approve", mode: "stage-start" });
		assert.equal(
			neg.findings.some((f) => f.fingerprint === "bookkeeping-advance"),
			false,
			"a foreign runId must NOT offer a bookkeeping advance",
		);
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd", "no advance may happen");
	});

	it("scenario 3: digest contract fixture — ok on matching stamp, digest-mismatch on drift", () => {
		// Real store DB (existsSync gate), stamp rows seeded into a
		// store_meta-shaped fixture table (real store_meta is key/value).
		mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "DigestApp" }),
			"utf8",
		);
		const dbPath = buildStoreDbPath("DigestApp", tmpDir);
		let seededDigest = "aaaaaaaaaaaaaaaa";
		{
			const db = openStoreDb(dbPath);
			try {
				// Fixture-stamp table (the real `store_meta` is key/value —
				// seeded rows here are store_meta-SHAPED, read only by the
				// fixture api below; deviation recorded in the plan).
				db.exec(
					"CREATE TABLE IF NOT EXISTS fixture_digest_stamp(scope TEXT PRIMARY KEY, digest TEXT, stamped_at TEXT);",
				);
				db.prepare("INSERT OR REPLACE INTO fixture_digest_stamp(scope, digest, stamped_at) VALUES (?, ?, ?)").run(
					"store-content-v1",
					seededDigest,
					"2026-09-28T00:00:00Z",
				);
			} finally {
				closeStoreDb(db);
			}
		}

		// Fixture DigestApi: reads the seeded rows, computes a fixed digest.
		const fixtureApi: DigestApi = {
			scope: "store-content-v1",
			/**
			 * Fixture digest: a fixed stand-in (does not hash the DB bytes).
			 * @returns {string} The constant computed digest.
			 */
			computeStoreContentDigest: () => "bbbbbbbbbbbbbbbb",
			/**
			 * Fixture stamp: read the seeded `fixture_digest_stamp` row.
			 * @param {unknown} db - Open store handle (the real DB connection).
			 * @returns {{scope: string, digest: string, stampedAt: string} | null} The stamp row, or null when unseeded.
			 */
			readStoreDigestStamp: (db: unknown) => {
				const row = (db as FixtureStoreDb)
					.prepare("SELECT scope, digest, stamped_at AS stampedAt FROM fixture_digest_stamp")
					.get() as { scope: string; digest: string; stampedAt: string } | undefined;
				return row ? { scope: row.scope, digest: row.digest, stampedAt: row.stampedAt } : null;
			},
			/**
			 * Fixture version inspection: unsupported → null (degrades to info).
			 * @returns {null} Always null — no version info in this fixture.
			 */
			inspectStoreVersion: () => null,
		};
		setContractForTests({ digest: fixtureApi });

		// Seeded digest != computed → mismatch error.
		let section = checkDigestGitSection(tmpDir, "DigestApp");
		assert.ok(
			section.items.some((i) => i.status === "error" && i.message.includes("digest-mismatch")),
			"drifted stamp must report digest-mismatch",
		);

		// Re-stamp with the computed value → consumed as ok (no error).
		seededDigest = "bbbbbbbbbbbbbbbb";
		{
			const db = openStoreDb(dbPath);
			try {
				db.prepare("UPDATE fixture_digest_stamp SET digest = ? WHERE scope = ?").run(seededDigest, "store-content-v1");
			} finally {
				closeStoreDb(db);
			}
		}
		section = checkDigestGitSection(tmpDir, "DigestApp");
		assert.equal(
			section.items.some((i) => i.status === "error"),
			false,
			`matching stamp must not error: ${JSON.stringify(section.items.map((i) => i.message))}`,
		);
	});
});
