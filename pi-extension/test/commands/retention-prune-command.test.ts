/**
 * Tests — commands/retention-prune.ts (Phase 4, L3 flow).
 *
 * Mock ExtensionContext.ui: scripted confirm responses drive
 * runRetentionPruneFlow against a seeded real store DB (temp dir + real
 * git repo — the Fix 2 precheck gate requires one). Covers: keep-forever
 * informational exit, nothing-beyond-window exit, prune report + double
 * confirm → pruned notify + audit rows + git commit, declined confirms
 * (nothing changed), git-precheck block, missing-DB error.
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { writeArtifact, publishArtifactCas } from "../../src/io/store.js";
import type { DatabaseSync } from "node:sqlite";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { runRetentionPruneFlow } from "../../src/commands/retention-prune.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface NotifyRecord {
	message: string;
	severity: string;
}

interface Script {
	confirms: boolean[];
}

/**
 * Mock ExtensionContext recording every notify.
 * @param {Script} script - Ordered confirm answers.
 * @returns {ExtensionContext & { notifications: NotifyRecord[] }} Mock ctx.
 */
function makeMockCtx(script: Script): ExtensionContext & { notifications: NotifyRecord[] } {
	const notifications: NotifyRecord[] = [];
	const ctx = {
		notifications,
		ui: {
			/**
			 * Record a notification (mock of ctx.ui.notify).
			 * @param {string} message - The notified message.
			 * @param {string} severity - One of info/warning/error.
			 * @returns {void}
			 */
			notify(message: string, severity?: string) {
				notifications.push({ message, severity: severity ?? "info" });
			},
			select(): Promise<string | undefined> {
				return Promise.resolve(undefined);
			},
			confirm(_title: string, _message: string): Promise<boolean> {
				return Promise.resolve(script.confirms.length > 0 ? script.confirms.shift()! : false);
			},
			input(): Promise<string | undefined> {
				return Promise.resolve("");
			},
		},
	};
	return ctx as unknown as ExtensionContext & { notifications: NotifyRecord[] };
}

let dir: string;
let dbPath: string;
let db: DatabaseSync;

/**
 * Seed `count` revisions of one run.
 * @returns {number[]} Revision ids, oldest first.
 */
function seedRevisions(count: number): number[] {
	const ids: number[] = [];
	let head: number | null = null;
	for (let i = 1; i <= count; i++) {
		writeArtifact(
			db,
			"prd",
			"r1",
			{ version: i, stage: "drafting-prd", generatedAt: "2026-09-27T00:00:00Z" },
			{
				fr: [{ id: "FR-1", phase: 1, textHash: `hash-${i}` }],
			},
		);
		head = publishArtifactCas(db, "r1", "prd", head).revisionId;
		ids.push(head);
	}
	return ids;
}

/**
 * Write a files.json with the given retention block + init a local git
 * repo with identity (the Fix 2 precheck gate requires both).
 */
function writeRetentionConfig(revisions: number | "all"): void {
	const cfg = {
		version: 4,
		projectName: "Project",
		codePaths: [],
		inputDocuments: [],
		testPaths: [],
		outputPaths: {},
		excludedPaths: [],
		velpari: { retention: { revisions } },
	};
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(dir, ".pi", "velpari", "files.json"), JSON.stringify(cfg), "utf8");
	try {
		execSync("git init -q && git config user.email t@t.local && git config user.name t", { cwd: dir, stdio: "ignore" });
		execSync("git add -- .pi/velpari/files.json && git commit -qm init", { cwd: dir, stdio: "ignore" });
	} catch {
		// git unusable — the precheck-block test covers that path explicitly.
	}
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-retention-cmd-"));
	dbPath = buildStoreDbPath("Project", dir);
	db = openStoreDb(dbPath);
});

after(() => {
	closeStoreDb(db);
	rmSync(dir, { recursive: true, force: true });
});

describe("runRetentionPruneFlow", () => {
	test("keep-forever → informational exit, nothing changed", async () => {
		writeRetentionConfig("all");
		seedRevisions(3);
		const ctx = makeMockCtx({ confirms: [] });
		await runRetentionPruneFlow(ctx, dir);
		const note = ctx.notifications.at(-1)!;
		assert.ok(note.message.includes("keep-forever"));
		const remaining = (db.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get() as { n: number }).n;
		assert.equal(remaining, 3);
	});

	test("nothing beyond the window → informational exit", async () => {
		writeRetentionConfig(5);
		seedRevisions(2);
		const ctx = makeMockCtx({ confirms: [] });
		await runRetentionPruneFlow(ctx, dir);
		assert.ok(ctx.notifications.at(-1)!.message.includes("Nothing beyond keep-last-5"));
	});

	test("report + double confirm → pruned notify, audit rows, git commit", async () => {
		writeRetentionConfig(2);
		seedRevisions(5);
		const ctx = makeMockCtx({ confirms: [true, true] });
		await runRetentionPruneFlow(ctx, dir);
		const note = ctx.notifications.at(-1)!;
		assert.ok(note.message.includes("Pruned 3 revision(s) beyond keep-last-2"));
		const remaining = (
			db
				.prepare("SELECT revision_number FROM artifact_revisions WHERE kind = 'prd' ORDER BY revision_number")
				.all() as {
				revision_number: number;
			}[]
		).map((r) => r.revision_number);
		assert.deepEqual(remaining, [4, 5]);
		const auditCount = (
			db.prepare("SELECT COUNT(*) AS n FROM audit_ledger WHERE action = 'retention-prune'").get() as { n: number }
		).n;
		assert.equal(auditCount, 3);
		// Fix 2: the store DB commit is git-anchored immediately.
		if (existsSync(join(dir, ".git"))) {
			const log = execSync("git log --format=%s", { cwd: dir, encoding: "utf-8" });
			assert.ok(log.includes("velpari(retention): prune 3 revision(s) beyond keep-last-2 (Project)"));
		}
	});

	test("declined first confirm → nothing changed", async () => {
		writeRetentionConfig(2);
		seedRevisions(4);
		const ctx = makeMockCtx({ confirms: [false] });
		await runRetentionPruneFlow(ctx, dir);
		assert.ok(ctx.notifications.at(-1)!.message.includes("cancelled — nothing changed"));
		const remaining = (db.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get() as { n: number }).n;
		assert.equal(remaining, 4);
	});

	test("declined second confirm → nothing changed", async () => {
		writeRetentionConfig(2);
		seedRevisions(4);
		const ctx = makeMockCtx({ confirms: [true, false] });
		await runRetentionPruneFlow(ctx, dir);
		assert.ok(ctx.notifications.at(-1)!.message.includes("cancelled — nothing changed"));
		const remaining = (db.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get() as { n: number }).n;
		assert.equal(remaining, 4);
	});

	test("git precheck failure → blocked before any scan or prune", async () => {
		// No git repo in dir (only the DB + no files.json) → precheck fails
		// before the keep-forever branch would fire.
		seedRevisions(3);
		const ctx = makeMockCtx({ confirms: [] });
		await runRetentionPruneFlow(ctx, dir);
		const note = ctx.notifications.at(-1)!;
		assert.equal(note.severity, "error");
		assert.ok(note.message.includes("git is not ready"));
		const remaining = (db.prepare("SELECT COUNT(*) AS n FROM artifact_revisions").get() as { n: number }).n;
		assert.equal(remaining, 3);
	});

	test("missing DB → error notify", async () => {
		writeRetentionConfig(2);
		// beforeEach's openStoreDb CREATED the DB file — remove it so the
		// flow's existsSync gate actually fires, then reopen for after().
		closeStoreDb(db);
		rmSync(dbPath, { force: true });
		rmSync(dbPath + "-wal", { force: true });
		rmSync(dbPath + "-shm", { force: true });
		const ctx = makeMockCtx({ confirms: [] });
		await runRetentionPruneFlow(ctx, dir);
		const note = ctx.notifications.at(-1)!;
		assert.equal(note.severity, "error");
		assert.ok(note.message.includes("No store DB"));
		db = openStoreDb(dbPath); // restore for the shared after() close
	});
});
