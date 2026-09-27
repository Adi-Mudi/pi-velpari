// Unit tests — ops/db-reset.ts + commands/db-reset.ts (Phase 2, F23 + N9 + GAP 1).
// Covers: draft-only deletion with published rows/revisions intact, the audit
// + tx entry per DB, the confirmation gate, the N9 backup trigger call site,
// multi-project resilience, and the orphan-draft path (GAP 1: no active run →
// picker over the runs that still hold drafts).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { buildStoreDbPath } from "../../src/core/paths.js";
import { createRun, loadState } from "../../src/core/state.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { publishArtifactCas, type ArtifactPayload, writeArtifact } from "../../src/io/store.js";
import { auditResetEvent, handleDbReset, listDraftRunsByProject } from "../../src/ops/db-reset.js";
import { resolveRunIdWithPicker } from "../../src/commands/db-reset.js";

interface Notice {
	message: string;
	level: string;
}

let cwd: string;
let notices: Notice[];
let confirmAnswer: boolean;
let selectQueue: string[];

function writeFilesConfig(projectNames: string[] = ["TestApp"]): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	// A v4 config must carry exactly ONE of projectName/projectNames plus the
	// required arrays (core/config.ts:validateFilesConfig).
	const base = {
		version: 4,
		codePaths: ["."],
		inputDocuments: [],
		testPaths: [],
		outputPaths: {},
		excludedPaths: [],
	};
	const cfg = projectNames.length === 1 ? { ...base, projectName: projectNames[0] } : { ...base, projectNames };
	writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify(cfg));
}

function withDb<T>(dbPath: string, fn: (db: ReturnType<typeof openStoreDb>) => T): T {
	const db = openStoreDb(dbPath);
	try {
		return fn(db);
	} finally {
		closeStoreDb(db);
	}
}

/** Seed one published PRD (v1) + one draft RTM for `runId` in `projectName`. */
function seedProject(projectName: string, runId: string): string {
	const dbPath = buildStoreDbPath(projectName, cwd);
	mkdirSync(join(cwd, "Doc", "store", projectName), { recursive: true });
	withDb(dbPath, (db) => {
		writeArtifact(db, "prd", runId, { version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" }, {
			fr: [{ id: "FR-1", phase: 1, textHash: "aaa111", text: "Prose." }],
		} as ArtifactPayload);
		publishArtifactCas(db, runId, "prd", null);
		writeArtifact(
			db,
			"rtm",
			runId,
			{ version: 1, stage: "building-rtm", generatedAt: "2026-09-27T01:00:00Z" },
			{} as ArtifactPayload,
		);
	});
	return dbPath;
}

function countRows(dbPath: string, table: string, where = ""): number {
	return withDb(dbPath, (db) => {
		const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where}`).get() as { n: number };
		return Number(row.n);
	});
}

function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

function makeCtx(): ExtensionCommandContext {
	return {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
			setStatus: () => {},
			confirm: async () => confirmAnswer,
		},
	} as unknown as ExtensionCommandContext;
}

/** Mock for the L3 run picker (non-TUI path uses ctx.ui.select with labels). */
function makePickerCtx(): ExtensionContext {
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
		},
	} as unknown as ExtensionContext;
}

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "velpari-db-reset-"));
	notices = [];
	confirmAnswer = false;
	selectQueue = [];
	writeFilesConfig();
});

after(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("ops/db-reset — handleDbReset", () => {
	test("no run id and no active run refuses with guidance and writes nothing", async () => {
		seedProject("TestApp", "rOld");
		await handleDbReset(makeCtx(), cwd);
		assert.match(allMessages(), /No run id available — run \/velpari-db-reset <runId>/);
		assert.match(allMessages(), /Draft rows survive \/velpari-reset by design \(F23\)/);
	});

	test("a declined confirmation changes nothing and writes no audit row", async () => {
		const dbPath = seedProject("TestApp", "r1");
		const auditBefore = countRows(dbPath, "audit_ledger");
		confirmAnswer = false;

		await handleDbReset(makeCtx(), cwd, "r1");

		assert.match(allMessages(), /DB reset cancelled — nothing changed\./);
		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'draft'"), 1, "the draft stays");
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore, "no audit row");
	});

	test("accepted: drafts deleted, published rows + revisions kept, audit + tx written", async () => {
		const dbPath = seedProject("TestApp", "r1");
		const revisionsBefore = countRows(dbPath, "artifact_revisions");
		const auditBefore = countRows(dbPath, "audit_ledger");
		confirmAnswer = true;

		await handleDbReset(makeCtx(), cwd, "r1");

		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'draft'"), 0, "drafts removed");
		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'published'"), 1, "published envelope kept");
		assert.equal(countRows(dbPath, "artifact_revisions"), revisionsBefore, "published revisions untouched");
		assert.equal(countRows(dbPath, "fr"), 1, "published child rows kept");
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore + 1, "one reset audit row");
		assert.equal(countRows(dbPath, "tx_log", " WHERE operation = 'db-reset'"), 1, "one commit tx entry");

		const audit = withDb(dbPath, (db) =>
			db.prepare("SELECT actor, reason, detail_json FROM audit_ledger WHERE action = 'db-reset'").get(),
		) as { actor: string; reason: string; detail_json: string };
		assert.equal(audit.actor, "velpari-db-reset");
		assert.match(audit.reason, /removed 1 draft row\(s\) for run r1/);
		assert.match(audit.detail_json, /"deletedDrafts":1/);

		assert.match(allMessages(), /DB reset for run r1: 1 draft row\(s\) deleted \(TestApp=1\)\./);
		assert.match(allMessages(), /Published rows and revisions kept/);
		assert.ok(!/backup failed/i.test(allMessages()), "the N9 no-op trigger is never reported as a failure");
	});

	test("multi-project: both stores cleaned; an unreadable DB is reported and the other still cleans", async () => {
		writeFilesConfig(["A", "B"]);
		const aPath = seedProject("A", "r1");
		const bPath = buildStoreDbPath("B", cwd);
		mkdirSync(join(cwd, "Doc", "store", "B", "index.db"), { recursive: true }); // a directory, not a DB
		confirmAnswer = true;

		await handleDbReset(makeCtx(), cwd, "r1");

		assert.equal(countRows(aPath, "artifacts", " WHERE status = 'draft'"), 0, "project A was cleaned");
		assert.match(allMessages(), /draft cleanup failed for "B"/);
		assert.ok(bPath.length > 0);
	});

	test("auditResetEvent records one row per existing DB and warns when none exists", () => {
		const dbPath = seedProject("TestApp", "r1");
		const warnings = auditResetEvent(cwd, "r1", { staleLockCleared: false });
		assert.deepEqual(warnings, [], "no warnings when a DB exists");
		const audit = withDb(dbPath, (db) =>
			db.prepare("SELECT actor, detail_json FROM audit_ledger WHERE action = 'reset'").get(),
		) as { actor: string; detail_json: string };
		assert.equal(audit.actor, "velpari-reset");
		assert.match(audit.detail_json, /"staleLockCleared":false/);

		rmSync(join(cwd, "Doc"), { recursive: true, force: true });
		const noDb = auditResetEvent(cwd, "r1", {});
		assert.deepEqual(noDb, ["no store DB exists — the reset audit event was recorded nowhere"]);
	});
});

describe("commands/db-reset — run resolution (GAP 1)", () => {
	test("no active run: the picker offers the runs holding drafts, then the reset runs", async () => {
		const dbPath = seedProject("TestApp", "rOrphan");
		assert.ok(!loadState(cwd).runId, "precondition: no active run");

		selectQueue = ["rOrphan"];
		const runId = await resolveRunIdWithPicker(makePickerCtx(), cwd);
		assert.equal(runId, "rOrphan", "the picker resolved the orphan run");

		confirmAnswer = true;
		await handleDbReset(makeCtx(), cwd, runId);
		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'draft'"), 0, "the orphan draft set was cleaned");
		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'published'"), 1, "published rows untouched");
	});

	test("cancelling the picker returns undefined and writes nothing", async () => {
		const dbPath = seedProject("TestApp", "rOrphan");
		selectQueue = []; // user cancelled the picker
		const runId = await resolveRunIdWithPicker(makePickerCtx(), cwd);
		assert.equal(runId, undefined);
		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'draft'"), 1, "the draft stays");
	});

	test("no drafts anywhere → undefined without a picker (nothing to reset)", async () => {
		const dbPath = seedProject("TestApp", "r1");
		confirmAnswer = true;
		await handleDbReset(makeCtx(), cwd, "r1");
		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'draft'"), 0);
		assert.equal(await resolveRunIdWithPicker(makePickerCtx(), cwd), undefined);
	});

	test("the full 'reset first, clean later' sequence leaves no unreachable drafts", async () => {
		writeFilesConfig();
		const runId = createRun("OrphanMission", cwd).runId;
		const dbPath = seedProject("TestApp", runId);
		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'draft'"), 1, "precondition: drafts exist");

		// 1. /velpari-reset — orchestration only: the drafts stay in the store.
		const { handleReset } = await import("../../src/ops/reset.js");
		confirmAnswer = true;
		await handleReset(makeCtx(), cwd);
		assert.equal(loadState(cwd).runId, "", "state cleared");
		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'draft'"), 1, "drafts orphaned by design (F23)");

		// 2. GAP 1: the orphan run is still discoverable + cleanable.
		const projects = listDraftRunsByProject(cwd);
		assert.deepEqual(projects[0]!.runs, [{ runId, drafts: 1 }]);
		confirmAnswer = true;
		await handleDbReset(makeCtx(), cwd, runId);
		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'draft'"), 0, "the orphan drafts were cleaned");
		assert.equal(countRows(dbPath, "artifacts", " WHERE status = 'published'"), 1, "published rows survive both steps");
	});
});
