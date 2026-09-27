/**
 * Tests — commands/export.ts (Phase 5 L3 picker flow; Phase 4 revision-aware).
 *
 * Mock ExtensionContext.ui: scripted select/confirm responses drive
 * runExportFlow against a seeded real store DB (temp dir). Covers: happy
 * path (head revision → grouped Doc/ path, N3 — NO path prompt), old
 * revision → _rev<N> path, superseded labeling, cancel at every picker
 * step (nothing written), missing-DB notify, no-published-kinds notify,
 * overwrite confirm gate (declined → untouched), runRevisionExport
 * refusal surfaces as error notify.
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";
import { writeArtifact, publishArtifactCas } from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { runExportFlow } from "../../src/commands/export.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Scripted responses consumed in order by the mock ctx.ui. */
interface Script {
	/** Answers for ctx.ui.select / runSimplePicker (fallback path). */
	selects: (string | undefined)[];
	/** Answers for ctx.ui.confirm. */
	confirms: boolean[];
}

interface NotifyRecord {
	message: string;
	severity: string;
}

/**
 * Build a mock ExtensionContext with scripted ui responses. `input` is
 * instrumented to fail the test if called — N3 removed the path prompt.
 * @param {Script} script - Ordered answers for select/confirm calls.
 * @returns {ExtensionContext & { notifications: NotifyRecord[]; inputCalls: number }} Mock ctx recording every notify.
 */
function makeMockCtx(script: Script): ExtensionContext & {
	notifications: NotifyRecord[];
	inputCalls: number;
} {
	const notifications: NotifyRecord[] = [];
	let inputCalls = 0;
	const ctx = {
		notifications,
		get inputCalls() {
			return inputCalls;
		},
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
			select(_title: string, options: string[]): Promise<string | undefined> {
				const answer = script.selects.length > 0 ? script.selects.shift() : undefined;
				if (answer === undefined) return Promise.resolve(undefined);
				if (!options.includes(answer)) {
					throw new Error(`scripted answer "${answer}" is not one of the offered options: ${JSON.stringify(options)}`);
				}
				return Promise.resolve(answer);
			},
			confirm(_title: string, _message: string): Promise<boolean> {
				return Promise.resolve(script.confirms.length > 0 ? script.confirms.shift()! : false);
			},
			input(_title: string): Promise<string | undefined> {
				inputCalls += 1;
				return Promise.resolve("");
			},
		},
	};
	return ctx as unknown as ExtensionContext & { notifications: NotifyRecord[]; inputCalls: number };
}

/** Envelope + PRD payload seed (deterministic). */
const ENV = { version: 1, stage: "drafting-prd", generatedAt: "2026-09-22T00:00:00Z" };
const PRD_PAYLOAD = {
	fr: [
		{ id: "FR-1", phase: 1, textHash: "a1b2c3" },
		{ id: "FR-2", phase: 1, textHash: "d4e5f6" },
	],
};

let dir: string;
let dbPath: string;
let db: DatabaseSync;

/**
 * Seed ONE published revision via CAS (snapshots are what the revision
 * picker lists). Returns the revision id.
 */
function seedRevision(version: number, textHash: string, expectedHead: number | null): number {
	writeArtifact(
		db,
		"prd",
		"r1",
		{ ...ENV, version },
		{ fr: [{ id: "FR-1", phase: 1, textHash }] },
	);
	return publishArtifactCas(db, "r1", "prd", expectedHead).revisionId;
}

/** Current head revision id for r1/prd (supersession chains are per run). */
function currentHeadId(): number {
	const row = db.prepare("SELECT head_revision_id AS h FROM artifacts WHERE run_id = 'r1' AND kind = 'prd'").get() as {
		h: number;
	};
	return row.h;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-export-cmd-"));
	// The command resolves projectName to "Project" (no files.json, no
	// mission) — seed the store where buildStoreDbPath puts it.
	dbPath = buildStoreDbPath("Project", dir);
	db = openStoreDb(dbPath);
	seedRevision(1, "a1b2c3", null);
});

after(() => {
	closeStoreDb(db);
	rmSync(dir, { recursive: true, force: true });
});

/** Head-revision labels for the seed (single revision, published). */
const HEAD_REV_LABEL = "rev 1 — published (v1, run r1)";

/** Pick "prd" kind + the head revision + "md" format. */
function happyScript(): Script {
	return { selects: ["prd", HEAD_REV_LABEL, "md"], confirms: [] };
}

describe("runExportFlow (revision-aware)", () => {
	test("happy path: head revision lands at the grouped Doc/ path (N3, no path prompt)", async () => {
		const ctx = makeMockCtx(happyScript());
		await runExportFlow(ctx, dir);
		// N3: the ctx.ui.input path prompt is GONE.
		assert.equal(ctx.inputCalls, 0, "path prompt must never be shown");
		const expected = join(dir, "Doc", "requirements", "PRD_Project.md");
		assert.ok(existsSync(expected), `expected ${expected}`);
		const content = readFileSync(expected, "utf8");
		assert.ok(content.includes("FR-1"));
		const note = ctx.notifications.at(-1)!;
		assert.ok(note.message.includes(expected));
		assert.ok(note.message.includes("rev 1"));
	});

	test("old revision → _rev<N> path; superseded label present in the picker", async () => {
		seedRevision(2, "bbb222", currentHeadId()); // beforeEach already seeded rev 1
		const ctx = makeMockCtx({
			selects: ["prd", "rev 1 — superseded (v1, run r1)", "md"],
			confirms: [],
		});
		await runExportFlow(ctx, dir);
		assert.equal(ctx.inputCalls, 0);
		const expected = join(dir, "Doc", "export", "Project", "PRD_Project_rev1.md");
		assert.ok(existsSync(expected), `expected ${expected}`);
		const content = readFileSync(expected, "utf8");
		assert.ok(content.includes("a1b2c3"));
		assert.ok(!content.includes("bbb222"), "old revision must render old rows only");
	});

	test("picker offers revisions newest (head) first", async () => {
		seedRevision(2, "bbb222", currentHeadId()); // beforeEach already seeded rev 1
		const offered: string[][] = [];
		const ctx = makeMockCtx({ selects: [], confirms: [] });
		// Select recorder: answer the kind picker, capture + cancel the version picker.
		const ui = (ctx as unknown as { ui: { select: (t: string, o: string[]) => Promise<string | undefined> } }).ui;
		ui.select = async (title: string, options: string[]) => {
			offered.push([title, ...options]);
			return title === "Export — pick artifact kind" ? "prd" : undefined;
		};
		await runExportFlow(ctx, dir);
		const versionMenu = offered.find((o) => o[0] === "Export — pick version (revision)");
		assert.ok(versionMenu, "version picker shown");
		const revLabels = versionMenu!.slice(1);
		assert.deepEqual(
			revLabels.map((l) => l.slice(0, 5)),
			["rev 2", "rev 1"],
			"newest revision first",
		);
		assert.ok(revLabels[0]!.includes("published"), "head revision labeled published");
		assert.ok(revLabels[1]!.includes("superseded"));
	});

	test("cancel at project picker → nothing written", async () => {
		const ctx = makeMockCtx({ selects: [], confirms: [] });
		await runExportFlow(ctx, dir);
		assert.equal(ctx.notifications.at(-1)!.message, "Export cancelled.");
		assert.ok(!existsSync(join(dir, "Doc", "export")));
		assert.ok(!existsSync(join(dir, "Doc", "requirements")));
	});

	test("cancel at kind picker → nothing written", async () => {
		const ctx = makeMockCtx({ selects: [undefined], confirms: [] });
		await runExportFlow(ctx, dir);
		assert.equal(ctx.notifications.at(-1)!.message, "Export cancelled.");
		assert.ok(!existsSync(join(dir, "Doc", "export")));
		assert.ok(!existsSync(join(dir, "Doc", "requirements")));
	});

	test("cancel at version picker → nothing written", async () => {
		const ctx = makeMockCtx({ selects: ["prd", undefined], confirms: [] });
		await runExportFlow(ctx, dir);
		assert.equal(ctx.notifications.at(-1)!.message, "Export cancelled.");
		assert.ok(!existsSync(join(dir, "Doc", "export")));
		assert.ok(!existsSync(join(dir, "Doc", "requirements")));
	});

	test("cancel at format picker → nothing written", async () => {
		const ctx = makeMockCtx({ selects: ["prd", HEAD_REV_LABEL, undefined], confirms: [] });
		await runExportFlow(ctx, dir);
		assert.equal(ctx.notifications.at(-1)!.message, "Export cancelled.");
		assert.ok(!existsSync(join(dir, "Doc", "export")));
		assert.ok(!existsSync(join(dir, "Doc", "requirements")));
	});

	test("missing DB → error notify, no file", async () => {
		const emptyDir = mkdtempSync(join(tmpdir(), "velpari-export-empty-"));
		try {
			const ctx = makeMockCtx(happyScript());
			await runExportFlow(ctx, emptyDir);
			const note = ctx.notifications.at(-1)!;
			assert.equal(note.severity, "error");
			assert.ok(note.message.includes("No store DB"));
			assert.ok(!existsSync(join(emptyDir, "Doc")));
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	test("no published kinds → info notify (draft-only store)", async () => {
		// Reset to a DB that only holds a draft artifact (no snapshots).
		closeStoreDb(db);
		rmSync(dbPath, { force: true });
		rmSync(dbPath + "-wal", { force: true });
		rmSync(dbPath + "-shm", { force: true });
		db = openStoreDb(dbPath);
		writeArtifact(db, "prd", "draft-run", ENV, PRD_PAYLOAD);
		const ctx = makeMockCtx(happyScript());
		await runExportFlow(ctx, dir);
		const note = ctx.notifications.at(-1)!;
		assert.ok(note.message.includes("No published artifacts"));
		assert.ok(!existsSync(join(dir, "Doc", "export")));
	});

	test("overwrite gate: declined confirm leaves the existing head export untouched", async () => {
		const out = join(dir, "Doc", "requirements", "PRD_Project.md");
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, "PRE-EXISTING", "utf8");
		const ctx = makeMockCtx({ selects: ["prd", HEAD_REV_LABEL, "md"], confirms: [false] });
		await runExportFlow(ctx, dir);
		assert.equal(readFileSync(out, "utf8"), "PRE-EXISTING");
		assert.ok(ctx.notifications.at(-1)!.message.includes("left untouched"));
	});

	test("overwrite gate: accepted confirm exports over the existing head export", async () => {
		const out = join(dir, "Doc", "requirements", "PRD_Project.md");
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, "PRE-EXISTING", "utf8");
		const ctx = makeMockCtx({ selects: ["prd", HEAD_REV_LABEL, "md"], confirms: [true] });
		await runExportFlow(ctx, dir);
		assert.ok(readFileSync(out, "utf8").includes("FR-1"));
	});

	test("runRevisionExport refusal surfaces as error notify (revision tombstoned mid-flow)", async () => {
		// Tombstone the head when the format picker fires — mimicking a
		// revision flipping to withdrawn between the picker and the export.
		const { withdrawRevision } = await import("../../src/ops/protection.js");
		const revId = (db.prepare("SELECT revision_id FROM artifact_revisions ORDER BY revision_number DESC LIMIT 1").get() as { revision_id: number }).revision_id;
		const ctx = makeMockCtx({ selects: ["prd", HEAD_REV_LABEL, "md"], confirms: [] });
		const ui = (ctx as unknown as { ui: { select: (t: string, o: string[]) => Promise<string | undefined> } }).ui;
		const originalSelect = ui.select.bind(ui);
		ui.select = async (title: string, options: string[]) => {
			const answer = await originalSelect(title, options);
			if (title === "Export — pick format") {
				withdrawRevision(db, { kind: "prd", revisionId: revId, reason: "mid-flow tombstone", actor: "test" });
			}
			return answer;
		};
		await runExportFlow(ctx, dir);
		const note = ctx.notifications.at(-1)!;
		assert.equal(note.severity, "error");
		assert.ok(note.message.includes("Export failed"));
	});
});
