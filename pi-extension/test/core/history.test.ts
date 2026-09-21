/**
 * core/history.ts — per-run history.jsonl store (B2).
 *
 * Covers:
 *   - loadHistory: missing file → [], corrupt lines skipped, order kept
 *   - appendHistory: round-trip, append onto a migrated seed
 *   - migrateInlineHistory: seeds the jsonl, no-op on empty input
 *   - historyFilePath: fixed per-run location under RUNS_DIR
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	appendHistory,
	historyFilePath,
	loadHistory,
	migrateInlineHistory,
} from "../../src/core/history.js";
import type { HistoryEntry } from "../../src/core/state.js";

let tmpDir: string;
const RUN_ID = "2026-09-20-12-00-test-run";

function entry(
	stage: HistoryEntry["stage"],
	command: string,
	timestamp: string,
): HistoryEntry {
	return { stage, command, timestamp };
}

const ENTRY_A = () => entry("brainstorming", "/velpari-brainstorm", "2026-09-20T12:00:00.000Z");
const ENTRY_B = () => entry("brainstormed", "/velpari-approve-brainstorm", "2026-09-20T12:01:00.000Z");
const ENTRY_C = () => entry("drafting-prd", "/velpari-prd", "2026-09-20T12:02:00.000Z");

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-history-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("historyFilePath", () => {
	it("points at .IDE_Plans/velpari/runs/<runId>/history.jsonl (RUNS_DIR did not move)", () => {
		assert.equal(
			historyFilePath(tmpDir, RUN_ID),
			path.join(tmpDir, ".IDE_Plans", "velpari", "runs", RUN_ID, "history.jsonl"),
		);
	});
});

describe("loadHistory", () => {
	it("returns [] when the file is missing", () => {
		assert.deepEqual(loadHistory(tmpDir, RUN_ID), []);
	});

	it("skips corrupt lines and keeps the parseable ones", () => {
		const filePath = historyFilePath(tmpDir, RUN_ID);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const good = ENTRY_A();
		fs.writeFileSync(filePath, `${JSON.stringify(good)}\n{ broken\n\n`, "utf8");
		assert.deepEqual(loadHistory(tmpDir, RUN_ID), [good]);
	});

	it("preserves entry order", () => {
		const entries = [ENTRY_A(), ENTRY_B(), ENTRY_C()];
		migrateInlineHistory(tmpDir, RUN_ID, entries);
		assert.deepEqual(loadHistory(tmpDir, RUN_ID), entries);
	});
});

describe("appendHistory", () => {
	it("round-trips: appended entries load in append order", () => {
		const a = ENTRY_A();
		const b = ENTRY_B();
		appendHistory(tmpDir, RUN_ID, a);
		appendHistory(tmpDir, RUN_ID, b);
		assert.deepEqual(loadHistory(tmpDir, RUN_ID), [a, b]);
	});

	it("appends onto a migrated seed", () => {
		const seed = ENTRY_A();
		const next = ENTRY_B();
		migrateInlineHistory(tmpDir, RUN_ID, [seed]);
		appendHistory(tmpDir, RUN_ID, next);
		assert.deepEqual(loadHistory(tmpDir, RUN_ID), [seed, next]);
	});
});

describe("migrateInlineHistory", () => {
	it("writes the jsonl at the per-run path", () => {
		const entries = [ENTRY_A(), ENTRY_B()];
		migrateInlineHistory(tmpDir, RUN_ID, entries);
		assert.ok(fs.existsSync(historyFilePath(tmpDir, RUN_ID)));
		assert.deepEqual(loadHistory(tmpDir, RUN_ID), entries);
	});

	it("is a no-op for an empty array (no file created)", () => {
		migrateInlineHistory(tmpDir, RUN_ID, []);
		assert.ok(!fs.existsSync(historyFilePath(tmpDir, RUN_ID)));
	});
});
