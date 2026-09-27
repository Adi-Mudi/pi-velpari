// Unit tests — ops/tombstone.ts + commands/tombstone.ts (Phase 2, F16 + F12).
// Covers: delete-as-modification (status-only withdraw, bytes + row counts
// intact, reason audited), the self-healing delete guidance (F12), the frozen
// refusal (N4/D5), the two confirmation gates, the mandatory reason, and the
// no-active-run path (rule 11 / GAP 2).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { buildStoreDbPath } from "../../src/core/paths.js";
import { loadState } from "../../src/core/state.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { publishArtifactCas, setFrozen, type ArtifactPayload, writeArtifact } from "../../src/io/store.js";
import { applyTombstone, deleteAttemptGuidance } from "../../src/ops/tombstone.js";
import { revisionsByKind } from "../../src/ops/protection.js";
import { runTombstoneFlow } from "../../src/commands/tombstone.js";

const PROJECT = "TestApp";

interface Notice {
	message: string;
	level: string;
}

let cwd: string;
let notices: Notice[];
let selectQueue: string[];
let inputAnswer: string | null;
let confirmAnswers: boolean[];

function writeFilesConfig(): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "velpari", "files.json"), JSON.stringify({ version: 4, projectName: PROJECT }));
}

/** Publish two PRD revisions for `runId`; returns their revision ids. */
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

function withDb<T>(dbPath: string, fn: (db: ReturnType<typeof openStoreDb>) => T): T {
	const db = openStoreDb(dbPath);
	try {
		return fn(db);
	} finally {
		closeStoreDb(db);
	}
}

function revisionRow(dbPath: string, revisionId: number): { status: string; yaml_bytes: string } {
	return withDb(dbPath, (db) =>
		db.prepare("SELECT status, yaml_bytes FROM artifact_revisions WHERE revision_id = ?").get(revisionId),
	) as { status: string; yaml_bytes: string };
}

function countRows(dbPath: string, table: string, where = ""): number {
	return withDb(dbPath, (db) => {
		const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where}`).get() as { n: number };
		return Number(row.n);
	});
}

function headOf(dbPath: string, runId: string): number | null {
	return withDb(dbPath, (db) => {
		const row = db.prepare("SELECT head_revision_id FROM artifacts WHERE run_id = ? AND kind = 'prd'").get(runId) as {
			head_revision_id: number | null;
		};
		return row.head_revision_id === null ? null : Number(row.head_revision_id);
	});
}

function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

/** Non-TUI mock: pickers answer from `selectQueue`, confirms from `confirmAnswers`. */
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
			confirm: async () => confirmAnswers.shift() ?? false,
		},
	} as unknown as ExtensionContext;
}

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "velpari-tombstone-"));
	notices = [];
	selectQueue = [];
	inputAnswer = null;
	confirmAnswers = [];
	writeFilesConfig();
});

after(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("ops/tombstone — applyTombstone", () => {
	test("withdraws the revision, audits the reason, and never removes bytes or rows", () => {
		const { dbPath, first, second } = seedTwoRevisions("r1");
		const before = revisionRow(dbPath, first);
		const revisionsBefore = countRows(dbPath, "artifact_revisions");
		const auditBefore = countRows(dbPath, "audit_ledger");

		const outcome = applyTombstone({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			revisionId: first,
			reason: "wrong FR text shipped",
		});

		assert.equal(outcome.ok, true);
		assert.match(outcome.message, /Revision v1 of prd tombstoned \(status=withdrawn, bytes kept\)\./);
		const after = revisionRow(dbPath, first);
		assert.equal(after.status, "withdrawn");
		assert.equal(after.yaml_bytes, before.yaml_bytes, "the snapshot bytes are untouched (F16)");
		assert.equal(countRows(dbPath, "artifact_revisions"), revisionsBefore, "no row was deleted");
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore + 1);
		assert.equal(countRows(dbPath, "audit_ledger", " WHERE action = 'tombstone'"), 1);
		const audit = withDb(dbPath, (db) =>
			db.prepare("SELECT reason, revision_number FROM audit_ledger WHERE action = 'tombstone'").get(),
		) as { reason: string; revision_number: number };
		assert.equal(audit.reason, "wrong FR text shipped");
		assert.equal(Number(audit.revision_number), 1);
		assert.equal(headOf(dbPath, "r1"), second, "a non-head tombstone leaves the head pointer alone");
	});

	test("an empty reason refuses and writes nothing", () => {
		const { dbPath, first } = seedTwoRevisions("r1");
		const auditBefore = countRows(dbPath, "audit_ledger");
		const txBefore = countRows(dbPath, "tx_log");

		const outcome = applyTombstone({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			revisionId: first,
			reason: "   ",
		});

		assert.equal(outcome.ok, false);
		assert.match(outcome.message, /Tombstone requires a typed reason \(F16\)/);
		assert.equal(revisionRow(dbPath, first).status, "superseded");
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore, "no audit row");
		assert.equal(countRows(dbPath, "tx_log"), txBefore, "no tx row");
	});

	test("a second tombstone refuses with 'already tombstoned' and leaves the row alone", () => {
		const { dbPath, first } = seedTwoRevisions("r1");
		const params = { cwd, dbPath, projectName: PROJECT, kind: "prd" as const, revisionId: first, reason: "first" };
		assert.equal(applyTombstone(params).ok, true);

		const again = applyTombstone({ ...params, reason: "second" });
		assert.equal(again.ok, false);
		assert.match(again.message, /already tombstoned/);
		assert.equal(countRows(dbPath, "audit_ledger", " WHERE action = 'tombstone'"), 1, "only one tombstone audit row");
	});

	test("tombstoning the head re-points it to the previous live revision", () => {
		const { dbPath, first, second } = seedTwoRevisions("r1");
		const outcome = applyTombstone({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			revisionId: second,
			reason: "withdrawn after review",
		});
		assert.equal(outcome.ok, true);
		assert.match(outcome.message, /Head re-pointed to revision 1\./);
		assert.equal(headOf(dbPath, "r1"), first);
	});

	test("D5/N4 — a frozen artifact refuses the tombstone until it is unfrozen", () => {
		const { dbPath, first } = seedTwoRevisions("r1");
		const db = openStoreDb(dbPath);
		try {
			setFrozen(db, "r1", "prd", true, "baselined at handoff");
		} finally {
			closeStoreDb(db);
		}

		const refused = applyTombstone({
			cwd,
			dbPath,
			projectName: PROJECT,
			kind: "prd",
			revisionId: first,
			reason: "wanted it gone",
		});
		assert.equal(refused.ok, false);
		assert.match(refused.message, /is frozen — baselined at handoff/);
		assert.match(refused.message, /\/velpari-freeze/);
		assert.equal(revisionRow(dbPath, first).status, "superseded", "still live");
	});

	test("deleteAttemptGuidance (F12) names the block, F16, and both forward paths", () => {
		const guidance = deleteAttemptGuidance("Doc/store/TestApp/index.db");
		assert.match(guidance, /Doc\/store\/TestApp\/index\.db/);
		assert.match(guidance, /immutable \(F16\)/);
		assert.match(guidance, /\/velpari-tombstone/);
		assert.match(guidance, /\/velpari-rollback/);
		assert.match(guidance, /\/velpari-export/);
	});

	test("revisionsByKind lists only kinds with revisions, newest-first; [] without a store", () => {
		const { dbPath, second } = seedTwoRevisions("r1");
		const groups = revisionsByKind(cwd, PROJECT);
		assert.equal(groups.length, 1);
		assert.equal(groups[0]!.kind, "prd");
		assert.deepEqual(
			groups[0]!.revisions.map((r) => r.revisionNumber),
			[2, 1],
		);
		assert.equal(groups[0]!.revisions[0]!.revisionId, second);
		assert.equal(groups[0]!.revisions[0]!.status, "published");
		assert.deepEqual(revisionsByKind(cwd, "NoSuchProject"), [], "no DB → no menu");
		assert.ok(dbPath.length > 0);
	});
});

describe("commands/tombstone — runTombstoneFlow", () => {
	test("cancel at the FIRST confirmation writes nothing", async () => {
		const { dbPath, first } = seedTwoRevisions("r1");
		const auditBefore = countRows(dbPath, "audit_ledger");
		selectQueue = ["prd", "v1"];
		inputAnswer = "retract it";
		confirmAnswers = [false]; // declined at gate #1

		await runTombstoneFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Tombstone cancelled — nothing changed\./);
		assert.equal(revisionRow(dbPath, first).status, "superseded");
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore);
	});

	test("cancel at the SECOND confirmation writes nothing", async () => {
		const { dbPath, first } = seedTwoRevisions("r1");
		const auditBefore = countRows(dbPath, "audit_ledger");
		selectQueue = ["prd", "v1"];
		inputAnswer = "retract it";
		confirmAnswers = [true, false]; // yes, then declined at gate #2

		await runTombstoneFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Tombstone cancelled — nothing changed\./);
		assert.equal(revisionRow(dbPath, first).status, "superseded", "two gates, both required");
		assert.equal(countRows(dbPath, "audit_ledger"), auditBefore);
	});

	test("a blank reason is refused before any confirmation", async () => {
		const { dbPath, first } = seedTwoRevisions("r1");
		selectQueue = ["prd", "v1"];
		inputAnswer = "   ";
		confirmAnswers = [true, true]; // even a double yes cannot bypass the reason gate

		await runTombstoneFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Tombstone requires a typed reason \(F16\) — nothing changed\./);
		assert.equal(revisionRow(dbPath, first).status, "superseded");
		assert.equal(confirmAnswers.length, 2, "no confirmation was reached");
	});

	test("GAP 2 — the flow works with no active run: the run comes from the revision row", async () => {
		const { dbPath, first } = seedTwoRevisions("rOld");
		assert.ok(!loadState(cwd).runId, "precondition: no state.json run");
		selectQueue = ["prd", "v1"];
		inputAnswer = "wrong FR text shipped";
		confirmAnswers = [true, true];

		await runTombstoneFlow(makeCtx(), cwd);

		assert.match(allMessages(), /Revision v1 of prd tombstoned/);
		assert.equal(revisionRow(dbPath, first).status, "withdrawn");
		assert.equal(countRows(dbPath, "audit_ledger", " WHERE action = 'tombstone'"), 1);
		const audit = withDb(dbPath, (db) =>
			db.prepare("SELECT actor, reason, detail_json FROM audit_ledger WHERE action = 'tombstone'").get(),
		) as { actor: string; reason: string; detail_json: string };
		assert.equal(audit.actor, "velpari-tombstone");
		assert.equal(audit.reason, "wrong FR text shipped");
		assert.match(audit.detail_json, /"wasHead":false/);
	});

	test("a project with no store DB reports an error and stops", async () => {
		await runTombstoneFlow(makeCtx(), cwd);
		assert.match(allMessages(), /No store DB for project "TestApp"/);
		assert.equal(notices.at(-1)?.level, "error");
	});
});
