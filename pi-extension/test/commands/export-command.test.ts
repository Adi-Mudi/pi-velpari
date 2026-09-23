/**
 * Tests — commands/export.ts (Phase 5, L3 picker flow).
 *
 * Mock ExtensionContext.ui: scripted select/input/confirm responses drive
 * runExportFlow against a seeded real store DB (temp dir). Covers: happy
 * path (file lands + notify), cancel at every picker step (nothing
 * written), missing-DB notify, no-published-kinds notify, overwrite
 * confirm gate (declined → untouched), custom output path.
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";
import { writeArtifact, publishArtifact } from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { runExportFlow } from "../../src/commands/export.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Scripted responses consumed in order by the mock ctx.ui. */
interface Script {
	/** Answers for ctx.ui.select / runSimplePicker (fallback path). */
	selects: string[];
	/** Answers for ctx.ui.input. */
	inputs: string[];
	/** Answers for ctx.ui.confirm. */
	confirms: boolean[];
}

interface NotifyRecord {
	message: string;
	severity: string;
}

/**
 * Build a mock ExtensionContext with scripted ui responses.
 * @param {Script} script - Ordered answers for select/input/confirm calls.
 * @returns {ExtensionContext & { notifications: NotifyRecord[] }} Mock ctx recording every notify.
 */
function makeMockCtx(script: Script): ExtensionContext & {
	notifications: NotifyRecord[];
} {
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
			select(_title: string, options: string[]): Promise<string | undefined> {
				return Promise.resolve(script.selects.length > 0 ? script.selects.shift() : undefined);
			},
			confirm(_title: string, _message: string): Promise<boolean> {
				return Promise.resolve(script.confirms.length > 0 ? script.confirms.shift()! : false);
			},
			input(_title: string): Promise<string | undefined> {
				return Promise.resolve(script.inputs.length > 0 ? script.inputs.shift() : undefined);
			},
		},
	};
	return ctx as unknown as ExtensionContext & { notifications: NotifyRecord[] };
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

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-export-cmd-"));
	// The command resolves projectName to "Project" (no files.json, no
	// mission) — seed the store where buildStoreDbPath puts it.
	dbPath = buildStoreDbPath("Project", dir);
	db = openStoreDb(dbPath);
	writeArtifact(db, "prd", "r1", ENV, PRD_PAYLOAD);
	publishArtifact(db, "r1", "prd");
});

after(() => {
	closeStoreDb(db);
	rmSync(dir, { recursive: true, force: true });
});

/** Pick "prd" kind + "v1" version + "md" format, empty output path. */
function happyScript(): Script {
	return {
		selects: ["prd", "v1 — run r1", "md"],
		inputs: [""],
		confirms: [],
	};
}

describe("runExportFlow", () => {
	test("happy path: file lands at default path, notify carries path + counts", async () => {
		const ctx = makeMockCtx(happyScript());
		await runExportFlow(ctx, dir);
		const expected = join(dir, "Doc", "export", "Project", "PRD_Project.md");
		assert.ok(existsSync(expected), `expected ${expected}`);
		const content = readFileSync(expected, "utf8");
		assert.ok(content.includes("FR-1"));
		assert.ok(content.includes("FR-2"));
		const note = ctx.notifications.at(-1)!;
		assert.ok(note.message.includes(expected));
		assert.ok(note.message.includes("fr=2"));
	});

	test("custom output path is honored", async () => {
		const custom = join(dir, "custom", "PRD.md");
		const ctx = makeMockCtx({ selects: ["prd", "v1 — run r1", "md"], inputs: [custom], confirms: [] });
		await runExportFlow(ctx, dir);
		assert.ok(existsSync(custom));
	});

	test("cancel at project picker → nothing written", async () => {
		const ctx = makeMockCtx({ selects: [], inputs: [], confirms: [] });
		await runExportFlow(ctx, dir);
		assert.equal(ctx.notifications.at(-1)!.message, "Export cancelled.");
		assert.ok(!existsSync(join(dir, "Doc", "export")));
	});

	test("cancel at kind picker → nothing written", async () => {
		const ctx = makeMockCtx({ selects: [undefined as unknown as string], inputs: [], confirms: [] });
		await runExportFlow(ctx, dir);
		assert.equal(ctx.notifications.at(-1)!.message, "Export cancelled.");
		assert.ok(!existsSync(join(dir, "Doc", "export")));
	});

	test("cancel at version picker → nothing written", async () => {
		const ctx = makeMockCtx({ selects: ["prd", undefined as unknown as string], inputs: [], confirms: [] });
		await runExportFlow(ctx, dir);
		assert.equal(ctx.notifications.at(-1)!.message, "Export cancelled.");
		assert.ok(!existsSync(join(dir, "Doc", "export")));
	});

	test("cancel at format picker → nothing written", async () => {
		const ctx = makeMockCtx({
			selects: ["prd", "v1 — run r1", undefined as unknown as string],
			inputs: [],
			confirms: [],
		});
		await runExportFlow(ctx, dir);
		assert.equal(ctx.notifications.at(-1)!.message, "Export cancelled.");
		assert.ok(!existsSync(join(dir, "Doc", "export")));
	});

	test("missing DB → error notify, no file", async () => {
		const emptyDir = mkdtempSync(join(tmpdir(), "velpari-export-empty-"));
		try {
			const ctx = makeMockCtx(happyScript());
			await runExportFlow(ctx, emptyDir);
			const note = ctx.notifications.at(-1)!;
			assert.equal(note.severity, "error");
			assert.ok(note.message.includes("No store DB"));
			assert.ok(!existsSync(join(emptyDir, "Doc", "export")));
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	test("no published kinds → info notify (draft-only store)", async () => {
		// Reset to a DB that only holds a draft artifact (no published rows).
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

	test("overwrite gate: declined confirm leaves the existing file untouched", async () => {
		const out = join(dir, "Doc", "export", "Project", "PRD_Project.md");
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, "PRE-EXISTING", "utf8");
		const ctx = makeMockCtx({
			selects: ["prd", "v1 — run r1", "md"],
			inputs: [""],
			confirms: [false],
		});
		await runExportFlow(ctx, dir);
		assert.equal(readFileSync(out, "utf8"), "PRE-EXISTING");
		assert.ok(ctx.notifications.at(-1)!.message.includes("left untouched"));
	});

	test("overwrite gate: accepted confirm exports over the existing file", async () => {
		const out = join(dir, "Doc", "export", "Project", "PRD_Project.md");
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, "PRE-EXISTING", "utf8");
		const ctx = makeMockCtx({
			selects: ["prd", "v1 — run r1", "md"],
			inputs: [""],
			confirms: [true],
		});
		await runExportFlow(ctx, dir);
		assert.ok(readFileSync(out, "utf8").includes("FR-1"));
	});

	test("runExport refusal surfaces as error notify (artifact unpublishes mid-flow)", async () => {
		// Unpublish r1 when the output-path input is requested — mimicking a
		// version row flipping to draft between the pickers and runExport.
		const ctx = makeMockCtx(happyScript());
		const store = await import("../../src/io/store.js");
		(ctx as unknown as { ui: { input: () => Promise<string> } }).ui.input = async () => {
			store.revertPublish(db, "r1", "prd");
			return "";
		};
		await runExportFlow(ctx, dir);
		const note = ctx.notifications.at(-1)!;
		assert.equal(note.severity, "error");
		assert.ok(note.message.includes("Export failed"));
	});
});
