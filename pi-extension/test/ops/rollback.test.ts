// Unit tests — ops/rollback.ts + commands/rollback.ts (Phase 2, F21).
// Covers: rollback-as-new-revision (history never rewritten, byte-identical
// content, supersedes chain, head move), the refusal set (empty reason,
// tombstoned target, head target, frozen artifact), the tampered-bytes
// refusal, and the no-active-run flow path (rule 11 / GAP 2).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { buildStoreDbPath } from "../../src/core/paths.js";
import { loadState } from "../../src/core/state.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import {
	getHeadRevision,
	publishArtifactCas,
	setFrozen,
	type ArtifactPayload,
	writeArtifact,
} from "../../src/io/store.js";
import { applyRollback } from "../../src/ops/rollback.js";
import { runRollbackFlow } from "../../src/commands/rollback.js";

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

function writeFilesConfig(): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify({ version: 4, projectName: PROJECT }));
}

function withDb<T>(dbPath: string, fn: (db: ReturnType<typeof openStoreDb>) => T): T {
	const db = openStoreDb(dbPath);
	try {
		return fn(db);
	} finally {
		closeStoreDb(db);
	}
}

/** Publish two PRD revisions for `runId`; returns the store path + both ids. */
function seedTwoRevisions(runId: string): { dbPath: string; first: number; second: number } {
	const dbPath = buildStoreDbPath(PROJECT, cwd);
	mkdirSync(join(cwd, "Doc", "store", PROJECT), { recursive: true });
	const db = openStoreDb(dbPath);
	try {
		writeArtifact(db, "prd", runId, { version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" }, {
			fr: [{ id: "FR-1", phase: 1, textHash: "aaa111", text: "Prose for aaa111." }],
		} as ArtifactPayload);
		const first = publishArtifactCas(db, runId, "prd", null);
		writeArtifact(db, "prd", runId, { version: 2, stage: "drafting-prd", generatedAt: "2026-09-27T01:00:00Z" }, {
			fr: [{ id: "FR-1", phase: 1, textHash: "bbb222", text: "Prose for bbb222." }],
		} as ArtifactPayload);
		const second = publishArtifactCas(db, runId, "prd", first.revisionId);
		return { dbPath, first: first.revisionId, second: second.revisionId };
	} finally {
		closeStoreDb(db);
	}
}

function revisionRow(dbPath: string, revisionId: number): Record<string, unknown> {
	return withDb(dbPath, (db) =>
		db
			.prepare(
				"SELECT revision_number, status, supersedes_revision_id, yaml_bytes FROM artifact_revisions WHERE revision_id = ?",
			)
			.get(revisionId),
	) as Record<string, unknown>;
}

function countRows(dbPath: string, table: string, where = ""): number {
	return withDb(dbPath, (db) => {
		const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where}`).get() as { n: number };
		return Number(row.n);
	});
}

function headId(dbPath: string, runId: string): number | null {
	return withDb(dbPath, (db) => getHeadRevision(db, runId, "prd")?.revisionId ?? null);
}

function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

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
	cwd = mkdtempSync(join(tmpdir(), "velpari-rollback-"));
	notices = [];
	selectQueue = [];
	inputAnswer = null;
	confirmAnswer = false;
	writeFilesConfig();
});

after(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("ops/rollback — applyRollback", () => {
	test("publishes a NEW revision with the old revision's exact bytes; history is untouched", () => {
		const { dbPath, first, second } = seedTwoRevisions("r1");
		const firstRow = revisionRow(dbPath, first);
		const revisionsBefore = countRows(dbPath, "artifact_revisions");

		const outcome = applyRollback({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			targetRevisionId: first,
			reason: "v2 shipped a wrong FR text",
		});

		assert.equal(outcome.ok, true);
		assert.equal(outcome.newRevisionNumber, 3);
		assert.equal(outcome.targetRevisionNumber, 1);
		assert.match(outcome.message, /Rolled back prd: v1 → v3 \(run r1\)\./);

		const newId = headId(dbPath, "r1")!;
		const newRow = revisionRow(dbPath, newId);
		assert.equal(newRow.status, "published");
		assert.equal(Number(newRow.revision_number), 3);
		assert.equal(Number(newRow.supersedes_revision_id), second, "the new revision supersedes the old head");
		assert.equal(newRow.yaml_bytes, firstRow.yaml_bytes, "content is byte-identical to v1 (F6)");

		// History is never rewritten:
		const firstAfter = revisionRow(dbPath, first);
		const secondAfter = revisionRow(dbPath, second);
		assert.equal(firstAfter.status, "superseded", "v1 status unchanged");
		assert.equal(firstAfter.yaml_bytes, firstRow.yaml_bytes, "v1 bytes unchanged");
		assert.equal(secondAfter.status, "superseded", "v2 was superseded by the rollback");
		assert.equal(Number(secondAfter.supersedes_revision_id), first);
		assert.equal(countRows(dbPath, "artifact_revisions"), revisionsBefore + 1, "a revision was ADDED, none removed");

		const audit = withDb(dbPath, (db) =>
			db
				.prepare(
					"SELECT actor, reason, artifact_kind, revision_number, detail_json FROM audit_ledger WHERE action = 'rollback'",
				)
				.get(),
		) as Record<string, unknown>;
		assert.equal(audit.actor, "velpari-rollback");
		assert.equal(audit.reason, "v2 shipped a wrong FR text");
		assert.equal(audit.artifact_kind, "prd");
		assert.equal(Number(audit.revision_number), 3);
		assert.match(String(audit.detail_json), /"targetRevisionNumber":1/);

		const tx = withDb(dbPath, (db) =>
			db
				.prepare("SELECT operation, before_digest, after_digest, outcome FROM tx_log WHERE operation = 'rollback'")
				.get(),
		) as Record<string, string>;
		assert.equal(tx.outcome, "commit");
		assert.equal(tx.before_digest, tx.after_digest, "content digests match by construction");
	});
});

describe("ops/rollback — refusals", () => {
	test("empty reason, head target, tombstoned target and unknown id refuse without writing", () => {
		const { dbPath, first, second } = seedTwoRevisions("r1");
		const auditBefore = countRows(dbPath, "audit_ledger");
		const revisionsBefore = countRows(dbPath, "artifact_revisions");

		const empty = applyRollback({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			targetRevisionId: first,
			reason: "  ",
		});
		assert.equal(empty.ok, false);
		assert.match(empty.message, /Rollback requires a typed reason/);

		const headTarget = applyRollback({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			targetRevisionId: second,
			reason: "no-op",
		});
		assert.equal(headTarget.ok, false);
		assert.match(headTarget.message, /already the head/);

		withDb(dbPath, (db) =>
			db.prepare("UPDATE artifact_revisions SET status = 'withdrawn' WHERE revision_id = ?").run(first),
		);
		const withdrawn = applyRollback({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			targetRevisionId: first,
			reason: "tombstoned",
		});
		assert.equal(withdrawn.ok, false);
		assert.match(withdrawn.message, /is tombstoned — pick another revision/);

		const unknown = applyRollback({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			targetRevisionId: 99999,
			reason: "missing",
		});
		assert.equal(unknown.ok, false);
		assert.match(unknown.message, /no revision with id 99999/);

		assert.equal(countRows(dbPath, "artifact_revisions"), revisionsBefore, "no revision added by a refusal");
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore, "no audit row by a refusal");
	});
});

describe("ops/rollback — tampered bytes, frozen artifact, run-less rollback", () => {
	test("tampered stored bytes refuse the rollback and cannot publish a bad revision", () => {
		const { dbPath, first } = seedTwoRevisions("r1");
		withDb(dbPath, (db) =>
			db.prepare("UPDATE artifact_revisions SET yaml_bytes = ? WHERE revision_id = ?").run("rows:\n  - broken", first),
		);

		const outcome = applyRollback({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			targetRevisionId: first,
			reason: "restore v1",
		});
		assert.equal(outcome.ok, false);
		assert.match(outcome.message, /carry zero rows|missing version\/stage\/generatedAt|do not parse/);
		assert.equal(headId(dbPath, "r1"), 2, "the head never moved");
		assert.equal(countRows(dbPath, "artifact_revisions"), 2, "no revision was written");
	});

	test("Issue 4 / D5 — a frozen artifact refuses the rollback cleanly (no throw)", () => {
		const { dbPath, first } = seedTwoRevisions("r1");
		withDb(dbPath, (db) => setFrozen(db, "r1", "prd", true, "baselined at handoff"));

		const outcome = applyRollback({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			targetRevisionId: first,
			reason: "restore v1",
		});
		assert.equal(outcome.ok, false);
		assert.match(outcome.message, /is frozen — baselined at handoff/);
		assert.match(outcome.message, /\/velpari-freeze/);
		assert.equal(headId(dbPath, "r1"), 2, "the head never moved");
		assert.equal(countRows(dbPath, "audit_ledger", " WHERE action = 'rollback'"), 0, "no rollback audit row");
	});

	test("GAP 2 — a migrated run (no state.json) rolls back using the revision row's run", () => {
		const { dbPath, first } = seedTwoRevisions("migrated");
		assert.ok(!loadState(cwd).runId, "precondition: no active run");

		const outcome = applyRollback({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			targetRevisionId: first,
			reason: "migration correction",
		});
		assert.equal(outcome.ok, true);
		assert.equal(outcome.newRevisionNumber, 3);
		assert.equal(
			headId(dbPath, "migrated"),
			withDb(dbPath, (db) => getHeadRevision(db, "migrated", "prd")?.revisionId),
		);
	});
});

describe("commands/rollback — runRollbackFlow", () => {
	/** Seed exactly one published revision (the "nothing to roll back to" case). */
	function seedOneRevision(runId: string): string {
		const dbPath = buildStoreDbPath(PROJECT, cwd);
		mkdirSync(join(cwd, "Doc", "store", PROJECT), { recursive: true });
		withDb(dbPath, (db) => {
			writeArtifact(db, "prd", runId, { version: 1, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" }, {
				fr: [{ id: "FR-1", phase: 1, textHash: "aaa111", text: "Prose." }],
			} as ArtifactPayload);
			publishArtifactCas(db, runId, "prd", null);
		});
		return dbPath;
	}

	test("cancel at the confirmation writes nothing", async () => {
		const { dbPath, first } = seedTwoRevisions("r1");
		const auditBefore = countRows(dbPath, "audit_ledger");
		selectQueue = ["prd", "v1"];
		inputAnswer = "restore v1";
		confirmAnswer = false;

		await runRollbackFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Rollback cancelled — nothing changed\./);
		assert.equal(headId(dbPath, "r1"), 2, "head unmoved");
		assert.equal(countRows(dbPath, "artifact_revisions"), 2, "no revision written");
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore, "no audit row");
	});

	test("a blank reason is refused before the confirmation", async () => {
		const { dbPath, first } = seedTwoRevisions("r1");
		selectQueue = ["prd", "v1"];
		inputAnswer = "   ";
		confirmAnswer = true; // a yes cannot bypass the reason gate

		await runRollbackFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Rollback requires a typed reason \(F17\) — nothing changed\./);
		assert.equal(headId(dbPath, "r1"), 2);
		assert.equal(countRows(dbPath, "artifact_revisions"), 2);
	});

	test("GAP 2 — the flow works with no active run (run read from the revision row)", async () => {
		const { dbPath, first } = seedTwoRevisions("rOld");
		assert.ok(!loadState(cwd).runId, "precondition: no state.json run");
		selectQueue = ["prd", "v1"];
		inputAnswer = "v2 was wrong";
		confirmAnswer = true;

		await runRollbackFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Rolled back prd: v1 → v3 \(run rOld\)\./);
		assert.equal(
			headId(dbPath, "rOld"),
			withDb(dbPath, (db) => getHeadRevision(db, "rOld", "prd")?.revisionId),
		);
		assert.equal(countRows(dbPath, "audit_ledger", " WHERE action = 'rollback'"), 1);
		const newId = headId(dbPath, "rOld")!;
		assert.equal(
			revisionRow(dbPath, newId).yaml_bytes,
			revisionRow(dbPath, first).yaml_bytes,
			"byte-identical restore",
		);
	});

	test("a kind with a single revision reports 'nothing to roll back to'", async () => {
		seedOneRevision("r1");
		await runRollbackFlow(makeCtx(), cwd);
		assert.match(allMessages(), /Only one revision exists — nothing to roll back to in project "TestApp"\./);
	});

	test("a project with no store DB reports an error and stops", async () => {
		await runRollbackFlow(makeCtx(), cwd);
		assert.match(allMessages(), /No store DB for project "TestApp"/);
		assert.equal(notices.at(-1)?.level, "error");
	});
});
