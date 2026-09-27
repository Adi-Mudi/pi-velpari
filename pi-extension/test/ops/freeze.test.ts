// Unit tests — ops/freeze.ts + commands/freeze.ts (Phase 2, N4).
// Covers: freeze/unfreeze writes (flag + reason + audit + tx), the frozen
// publish refusal, mandatory unfreeze reason, missing-artifact refusal,
// read-only helpers writing nothing, the git-commit-warning path (rule 7),
// run resolution without state.json (rule 11 / GAP 2) and the cancel path.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { buildStoreDbPath } from "../../src/core/paths.js";
import { createRun, loadState } from "../../src/core/state.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { FrozenArtifactError, publishArtifactCas, type ArtifactPayload, writeArtifact } from "../../src/io/store.js";
import { freezableKinds, freezeStateOf, runsForKind, storeKinds } from "../../src/ops/protection.js";
import { applySingleKindFreeze, finalizeUnfreeze, unfreezeArtifact } from "../../src/ops/freeze.js";
import { runFreezeFlow } from "../../src/commands/freeze.js";

const PROJECT = "TestApp";

interface Notice {
	message: string;
	level: string;
}

let cwd: string;
let notices: Notice[];
let selectQueue: string[];
let inputAnswer: string | null;
let confirmAnswer: boolean;

/** Write a minimal files.json so project resolution finds TestApp. */
function writeFilesConfig(): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify({ version: 4, projectName: PROJECT }));
}

/** Write one minimal PRD artifact for `runId` (draft, or published when asked). */
function writePrd(dbPath: string, runId: string, textHash: string, publish = true): void {
	const db = openStoreDb(dbPath);
	try {
		writeArtifact(db, "prd", runId, { version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" }, {
			fr: [{ id: "FR-1", phase: 1, textHash, text: `Prose for ${textHash}.` }],
		} as ArtifactPayload);
		if (publish) publishArtifactCas(db, runId, "prd", null);
	} finally {
		closeStoreDb(db);
	}
}

/** Seed a published PRD for `runId` and return the store DB path. */
function seedPublishedPrd(runId: string): string {
	const dbPath = buildStoreDbPath(PROJECT, cwd);
	mkdirSync(join(cwd, "Doc", "store", PROJECT), { recursive: true });
	writePrd(dbPath, runId, "aaa111");
	return dbPath;
}

/** Frozen flag + reason as stored (raw read, test-side). */
function storedFrozen(dbPath: string, runId: string): { frozen: number; freeze_reason: string | null } {
	const db = openStoreDb(dbPath);
	try {
		return db.prepare("SELECT frozen, freeze_reason FROM artifacts WHERE run_id = ? AND kind = 'prd'").get(runId) as {
			frozen: number;
			freeze_reason: string | null;
		};
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Count audit-ledger rows matching one action value.
 * @param {string} dbPath - Path to the store DB to open.
 * @param {string} action - The audit action to match (e.g. "freeze").
 * @returns {number} Number of audit_ledger rows with that action.
 */
function countActionRows(dbPath: string, action: string): number {
	const db = openStoreDb(dbPath);
	try {
		const row = db.prepare("SELECT COUNT(*) AS n FROM audit_ledger WHERE action = ?").get(action) as { n: number };
		return Number(row.n);
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Count rows in any store table, optionally filtered by a WHERE clause.
 * @param {string} dbPath - Path to the store DB to open.
 * @param {string} table - Table name to count.
 * @param {string} [where] - Optional `WHERE ...` suffix (no trailing semicolon).
 * @returns {number} Number of matching rows.
 */
function countRows(dbPath: string, table: string, where = ""): number {
	const db = openStoreDb(dbPath);
	try {
		const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where}`).get() as { n: number };
		return Number(row.n);
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Join every recorded notify message into one string for assertion.
 * @returns {string} All notice messages, newline-separated.
 */
function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

/** Non-TUI context mock: select answers come from a queue, in call order. */
function makeCtx(): ExtensionContext {
	return {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
			setStatus: () => {},
			select: async (_title: string, labels: string[]) => {
				const next = selectQueue.shift();
				return next !== undefined && labels.includes(next) ? next : undefined;
			},
			input: async () => inputAnswer ?? undefined,
			confirm: async () => confirmAnswer,
		},
	} as unknown as ExtensionContext;
}

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "velpari-freeze-"));
	notices = [];
	selectQueue = [];
	inputAnswer = null;
	confirmAnswer = false;
	writeFilesConfig();
});

after(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("ops/protection — single-kind freeze (N4)", () => {
	test("freeze stamps flag + reason, audits one 'freeze' entry, and blocks the next publish", () => {
		const dbPath = seedPublishedPrd("r1");
		const outcome = applySingleKindFreeze({
			cwd,
			dbPath,
			projectName: PROJECT,
			runId: "r1",
			kind: "prd",
			reason: "baselined at handoff",
		});

		assert.equal(outcome.ok, true);
		assert.match(outcome.message, /Frozen prd \(run r1\) — baselined at handoff/);
		const stored = storedFrozen(dbPath, "r1");
		assert.equal(stored.frozen, 1);
		assert.equal(stored.freeze_reason, "baselined at handoff");
		assert.equal(countActionRows(dbPath, "freeze"), 1);
		assert.equal(countRows(dbPath, "tx_log", " WHERE operation = 'freeze'"), 1, "F18 tx entry");

		// N4: a frozen artifact refuses the next publish with the reason.
		const db = openStoreDb(dbPath);
		try {
			writeArtifact(db, "prd", "r1", { version: 2, stage: "drafting-prd", generatedAt: "2026-09-27T02:00:00Z" }, {
				fr: [{ id: "FR-1", phase: 1, textHash: "zzz999", text: "Changed prose." }],
			} as ArtifactPayload);
			assert.throws(
				() => publishArtifactCas(db, "r1", "prd", 1),
				(err: unknown) => err instanceof FrozenArtifactError && /baselined at handoff/.test((err as Error).message),
			);
		} finally {
			closeStoreDb(db);
		}
	});

	test("unfreeze runs through Phase 1's N4 executor; the typed reason is mandatory there too", () => {
		const dbPath = seedPublishedPrd("r1");
		applySingleKindFreeze({ cwd, dbPath, projectName: PROJECT, runId: "r1", kind: "prd", reason: "handoff" });

		// Phase 1's executor owns the canonical N4 gate.
		const refused = unfreezeArtifact(cwd, PROJECT, "r1", "prd", "   ");
		assert.equal(refused.ok, false);
		assert.match(refused.problems.join(" "), /unfreeze requires a non-empty reason \(N4\)/);
		assert.equal(storedFrozen(dbPath, "r1").frozen, 1, "refusal leaves the lock in place");
		assert.equal(countActionRows(dbPath, "unfreeze"), 0, "no audit row for a refusal");

		const ok = unfreezeArtifact(cwd, PROJECT, "r1", "prd", "user retracted the handoff lock");
		assert.equal(ok.ok, true);
		assert.equal(storedFrozen(dbPath, "r1").frozen, 0);
		assert.equal(countActionRows(dbPath, "unfreeze"), 1, "Phase 1's executor writes the audit row");
		assert.equal(countRows(dbPath, "tx_log", " WHERE operation = 'unfreeze'"), 0, "…and no F18 tx row");

		// Phase 2's finalizer adds the F18 tx entry (the command calls it right after).
		const warnings = finalizeUnfreeze({
			cwd,
			dbPath,
			projectName: PROJECT,
			runId: "r1",
			kind: "prd",
			reason: "user retracted the handoff lock",
		});
		assert.equal(countRows(dbPath, "tx_log", " WHERE operation = 'unfreeze'"), 1);
		// This fixture is not a git repo, so a "git commit skipped" warning
		// is correct here (rule 7); what must NOT appear is the I10.2
		// catch-path marker ([]) — the [] assertion itself lives in the
		// git-ready happy-path test below.
		assert.doesNotMatch(warnings.join("\n"), /unfreeze audit\/commit skipped/);
	});

	test("finalizeUnfreeze never throws: a failed audit write becomes a warning (Phase I10.2)", () => {
		const dbPath = seedPublishedPrd("r1");
		const storeDir = dirname(dbPath);
		// Read-only store dir ⇒ the SQLite audit append (WAL/journal
		// creation) fails at the filesystem level.
		chmodSync(storeDir, 0o555);
		let warnings: string[];
		try {
			warnings = finalizeUnfreeze({
				cwd,
				dbPath,
				projectName: PROJECT,
				runId: "r1",
				kind: "prd",
				reason: "audit write forced to fail",
			});
		} finally {
			chmodSync(storeDir, 0o755); // let the suite's cleanup remove the fixture
		}
		assert.ok(Array.isArray(warnings), "must return a warnings array instead of throwing");
		assert.ok(warnings.length > 0, "the audit failure surfaces as a warning");
		assert.match(warnings.join("\n"), /unfreeze audit\/commit skipped/);
	});

	test("finalizeUnfreeze happy path in a git-ready fixture returns [] (Phase I10.2)", () => {
		// commitProtectionChange's precheck passes only inside a work tree
		// with an identity configured (db-publish.ts precheckGitForPublish).
		execFileSync("git", ["init", "-q"], { cwd });
		execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
		execFileSync("git", ["config", "user.name", "test"], { cwd });
		const dbPath = seedPublishedPrd("r1");
		const warnings = finalizeUnfreeze({
			cwd,
			dbPath,
			projectName: PROJECT,
			runId: "r1",
			kind: "prd",
			reason: "happy path",
		});
		assert.deepEqual(warnings, [], `expected no warnings, got: ${warnings.join(" | ")}`);
	});

	test("applySingleKindFreeze refuses a (run, kind) with no artifact row and writes no audit", () => {
		const dbPath = seedPublishedPrd("r1");
		const auditBefore = countRows(dbPath, "audit_ledger");
		const txBefore = countRows(dbPath, "tx_log");
		const outcome = applySingleKindFreeze({
			cwd,
			dbPath,
			projectName: PROJECT,
			runId: "ghost",
			kind: "prd",
			reason: "nope",
		});
		assert.equal(outcome.ok, false);
		assert.match(outcome.message, /no artifact row for 'prd' in run ghost/);
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore, "a refusal writes no audit entry");
		assert.equal(countRows(dbPath, "tx_log"), txBefore, "a refusal writes no tx entry");
	});

	test("read-only helpers never write (storeKinds / freezableKinds / runsForKind / freezeStateOf)", () => {
		const dbPath = seedPublishedPrd("r1");
		mkdirSync(join(cwd, "Doc", "store", PROJECT), { recursive: true });
		writePrd(dbPath, "r2", "bbb222", false); // draft-only second run

		const txBefore = countRows(dbPath, "tx_log");
		const auditBefore = countRows(dbPath, "audit_ledger");

		assert.deepEqual(storeKinds(cwd, PROJECT), ["prd"]);
		assert.deepEqual(freezableKinds(cwd, PROJECT, "r1"), ["prd"]);
		assert.deepEqual(runsForKind(cwd, PROJECT, "prd"), ["r1", "r2"]);
		assert.deepEqual(freezeStateOf(cwd, PROJECT, "r1", "prd"), { frozen: false, reason: null });
		assert.equal(freezeStateOf(cwd, PROJECT, "ghost", "prd"), null, "unknown run → null");

		assert.equal(countRows(dbPath, "tx_log"), txBefore, "reads never write a tx entry");
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore, "reads never write an audit entry");
	});

	test("a failed git step is a warning, never a failed protection action (rule 7)", () => {
		const dbPath = seedPublishedPrd("r1");
		const outcome = applySingleKindFreeze({
			cwd,
			dbPath,
			projectName: PROJECT,
			runId: "r1",
			kind: "prd",
			reason: "lock for review",
		});
		assert.equal(outcome.ok, true, "the DB write stands even when git cannot commit");
		assert.equal(storedFrozen(dbPath, "r1").frozen, 1);
		assert.ok(outcome.warnings && outcome.warnings.length > 0, "the git problem is surfaced as a warning");
		assert.match(outcome.warnings!.join("\n"), /git commit skipped|git commit failed|git add failed/);
	});
});

describe("commands/freeze — runFreezeFlow", () => {
	test("cancel at the confirmation writes nothing", async () => {
		const runId = createRun("Mission", cwd).runId;
		const dbPath = seedPublishedPrd(runId);
		const auditBefore = countRows(dbPath, "audit_ledger");

		selectQueue = ["freeze", "prd"];
		inputAnswer = "lock it";
		confirmAnswer = false; // declined at the gate
		await runFreezeFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Freeze cancelled — nothing changed\./);
		assert.equal(storedFrozen(dbPath, runId).frozen, 0, "no write on cancel");
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore, "no audit on cancel");
	});

	test("freeze with an active run defaults to state.runId (no run picker)", async () => {
		const runId = createRun("Mission", cwd).runId;
		const dbPath = seedPublishedPrd(runId);

		selectQueue = ["freeze", "prd"]; // action + kind only — run comes from state
		inputAnswer = "baselined at handoff";
		confirmAnswer = true;
		await runFreezeFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Frozen prd \(run /);
		assert.equal(storedFrozen(dbPath, runId).frozen, 1);
		assert.equal(countActionRows(dbPath, "freeze"), 1);
		assert.equal(selectQueue.length, 0, "no run picker was shown");
	});

	test("GAP 2 — unfreeze works with NO state.json: the run comes from the store", async () => {
		const dbPath = seedPublishedPrd("rOld");
		applySingleKindFreeze({ cwd, dbPath, projectName: PROJECT, runId: "rOld", kind: "prd", reason: "handoff" });
		rmSync(join(cwd, ".pi", "velpari", "state.json"), { force: true });
		assert.ok(!loadState(cwd).runId, "precondition: no active run (loadState returns an empty runId)");

		selectQueue = ["unfreeze", "prd", "rOld"]; // action + kind + run picker
		inputAnswer = "user retracted the lock";
		confirmAnswer = true;
		await runFreezeFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Unfrozen prd \(run rOld\) — user retracted the lock/);
		assert.equal(storedFrozen(dbPath, "rOld").frozen, 0, "the post-run unfreeze landed");
		assert.equal(countActionRows(dbPath, "unfreeze"), 1);
	});

	test("unfreeze with an empty reason is refused before the confirmation", async () => {
		const dbPath = seedPublishedPrd("rOld");
		applySingleKindFreeze({ cwd, dbPath, projectName: PROJECT, runId: "rOld", kind: "prd", reason: "handoff" });

		selectQueue = ["unfreeze", "prd", "rOld"];
		inputAnswer = "   ";
		confirmAnswer = true; // even a yes cannot bypass the reason gate
		await runFreezeFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Unfreeze requires a typed reason \(N4\) — nothing changed\./);
		assert.equal(storedFrozen(dbPath, "rOld").frozen, 1, "still locked");
		assert.equal(countActionRows(dbPath, "unfreeze"), 0, "no audit row");
	});

	test("a project without a store DB reports an error and stops", async () => {
		selectQueue = ["freeze"];
		await runFreezeFlow(makeCtx(), cwd);
		assert.match(allMessages(), /No store DB for project "TestApp"/);
		assert.equal(notices.at(-1)?.level, "error");
	});
});
