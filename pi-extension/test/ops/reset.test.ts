/**
 * /velpari-reset handler tests (closes the 37.5% line / 0% funcs gap).
 *
 * The handler has 3 paths:
 *   1. No active run → "No active run to reset" (info)
 *   2. Active run + user confirms → clearRun + "Run X reset" (info)
 *   3. Active run + user declines → "Reset cancelled" (info)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleReset } from "../../src/ops/reset.js";
import { createRun, loadState } from "../../src/core/state.js";

interface Notice {
	message: string;
	level: string;
}

let tmpDir: string;
let notices: Notice[];
let confirmAnswer: boolean;

function writeFilesConfig() {
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TestApp" }),
	);
}

function makeCtx(): ExtensionCommandContext {
	notices = [];
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

function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-reset-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("/velpari-reset handler", () => {
	it("reports 'No active run to reset' when there is no state.json", async () => {
		writeFilesConfig();
		// Do NOT call createRun → loadState returns { currentStage: "none" }.
		await handleReset(makeCtx(), tmpDir);

		assert.equal(notices.length, 1);
		assert.equal(notices[0]!.level, "info");
		assert.match(allMessages(), /No active run to reset/);
	});

	it("clears state and reports 'Run X reset' when user confirms", async () => {
		writeFilesConfig();
		const initial = createRun("ResetMission", tmpDir);
		assert.equal(initial.currentStage, "brainstorming");
		assert.ok(loadState(tmpDir).runId, "precondition: state exists");

		confirmAnswer = true;
		await handleReset(makeCtx(), tmpDir);

		// State cleared.
		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "none");
		assert.equal(after.runId, "");

		// User notified.
		assert.equal(notices.length, 1);
		assert.match(allMessages(), /reset\. State is now empty\./i);
	});

	it("reports 'Reset cancelled' when user declines; state unchanged", async () => {
		writeFilesConfig();
		const initial = createRun("KeepMission", tmpDir);
		const before = loadState(tmpDir);
		assert.equal(before.currentStage, "brainstorming");

		confirmAnswer = false;
		await handleReset(makeCtx(), tmpDir);

		// State preserved.
		const after = loadState(tmpDir);
		assert.equal(after.runId, initial.runId);
		assert.equal(after.currentStage, "brainstorming");
		assert.equal(after.mission, "KeepMission");

		// User notified.
		assert.match(allMessages(), /Reset cancelled\./i);
	});

	it("preserves the .IDE_Plans run directory after reset (state only)", async () => {
		writeFilesConfig();
		createRun("PreserveMe", tmpDir);
		const runId = loadState(tmpDir).runId!;

		// Create a work file inside the run's brain/ subdir as a real
		// artifact that the reset should NOT touch.
		const workDir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "brain");
		fs.mkdirSync(workDir, { recursive: true });
		const workFile = path.join(workDir, "notes.md");
		fs.writeFileSync(workFile, "# User notes\n", "utf8");

		confirmAnswer = true;
		await handleReset(makeCtx(), tmpDir);

		// state.json is gone (cleared by clearRun).
		assert.equal(loadState(tmpDir).currentStage, "none");
		// Work file is still on disk.
		assert.ok(fs.existsSync(workFile), "working copies must NOT be deleted by reset");
		assert.equal(fs.readFileSync(workFile, "utf8"), "# User notes\n");
	});

	it("deletes the run's DRAFT store rows but keeps PUBLISHED rows (Q2, Phase 8)", async () => {
		writeFilesConfig();
		const run = createRun("DraftCleanup", tmpDir);
		const runId = run.runId!;
		assert.ok(runId, "precondition: runId exists");

		// Seed a store DB with one published + one draft envelope (each with
		// a child fr row so the cascade is exercised).
		const { openStoreDb, closeStoreDb } = await import("../../src/io/db.js");
		const { buildStoreDbPath } = await import("../../src/core/paths.js");
		const db = openStoreDb(buildStoreDbPath("TestApp", tmpDir));
		try {
			db.prepare(
				"INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint, status) " +
					"VALUES (?, 'prd', 1, 'drafting-prd', '2026-09-22T00:00:00Z', 'f', 'published')",
			).run(runId);
			db.prepare("INSERT INTO fr (run_id, kind, id, phase, text_hash) VALUES (?, 'prd', 'FR-1', 1, 'h')").run(runId);
			db.prepare(
				"INSERT INTO artifacts (run_id, kind, version, stage, generated_at, sha256_fingerprint, status) " +
					"VALUES (?, 'rtm', 1, 'building-rtm', '2026-09-22T00:00:00Z', 'f', 'draft')",
			).run(runId);
			db.prepare(
				"INSERT INTO rtm_row (run_id, kind, id, fr_ref, phase, target_sha256) VALUES (?, 'rtm', 'RTM-1', 'FR-1', 1, 't')",
			).run(runId);
		} finally {
			closeStoreDb(db);
		}

		confirmAnswer = true;
		await handleReset(makeCtx(), tmpDir);

		// Draft rows gone; published rows survive (append-only history).
		const after = openStoreDb(buildStoreDbPath("TestApp", tmpDir));
		try {
			const rtm = after
				.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE run_id = ? AND status = 'draft'")
				.get(runId) as { n: number };
			assert.equal(rtm.n, 0, "draft envelopes must be deleted by reset");
			const pub = after
				.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE run_id = ? AND status = 'published'")
				.get(runId) as { n: number };
			assert.equal(pub.n, 1, "published envelope must survive reset");
			const fr = after.prepare("SELECT COUNT(*) AS n FROM fr WHERE run_id = ?").get(runId) as { n: number };
			assert.equal(fr.n, 1, "published child rows survive");
			const rtmRow = after.prepare("SELECT COUNT(*) AS n FROM rtm_row WHERE run_id = ?").get(runId) as { n: number };
			assert.equal(rtmRow.n, 0, "draft child rows cascade away with the draft envelope");
		} finally {
			closeStoreDb(after);
		}
		// Notify mentions the cleanup count.
		assert.match(allMessages(), /draft store row\(s\) deleted/);
	});

	it("skips DB cleanup silently when no store DB exists (state reset still completes)", async () => {
		writeFilesConfig();
		createRun("NoDbReset", tmpDir);
		confirmAnswer = true;
		await handleReset(makeCtx(), tmpDir);
		assert.equal(loadState(tmpDir).currentStage, "none");
		assert.equal(notices.length, 1);
		assert.match(allMessages(), /reset\. State is now empty\./i);
	});
});
