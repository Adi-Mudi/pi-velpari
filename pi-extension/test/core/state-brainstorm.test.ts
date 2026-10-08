/**
 * Brainstorm session state helpers (Phase 1).
 *
 * Asserts the invariants the lifecycle v2 depends on:
 *   - helpers mutate ONLY the brainstorm session fields (+ updatedAt);
 *     currentStage NEVER changes (the stage machine stays chained)
 *   - a legacy .IDE_Plans state.json migrates to .pi/velpari (B1) with
 *     inline history split into the per-run history.jsonl (B2)
 *   - upsert enforces reason for not-wanted / replaced
 *   - invalid question states and scan types are rejected
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	clearBrainstormSession,
	confirmUnderstanding,
	createRun,
	discardBrainstormSession,
	incrementBrainstormDispatchCount,
	loadState,
	openBrainstormSession,
	resumeFromBrainstorm,
	saveState,
	setActiveSubagents,
	setScansSelected,
	upsertBrainstormQuestion,
	type BrainstormQuestion,
} from "../../src/core/state.js";
import { loadHistory } from "../../src/core/history.js";
import { PATHS } from "../../src/core/constants.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-state-brainstorm-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("core/state brainstorm helpers", () => {
	it("confirmUnderstanding sets only the lock flag and never touches currentStage", () => {
		const state = createRun("Test mission", tmpDir);
		assert.equal(state.currentStage, "brainstorming");

		const next = confirmUnderstanding(state, tmpDir);
		assert.equal(next.understandingConfirmed, true);
		assert.equal(next.currentStage, "brainstorming");
		assert.equal(next.runId, state.runId);
		assert.equal(next.mission, state.mission);
		assert.deepEqual(next.history, state.history);

		// Persisted to disk.
		const loaded = loadState(tmpDir);
		assert.equal(loaded.understandingConfirmed, true);
		assert.equal(loaded.currentStage, "brainstorming");
	});

	it("setScansSelected persists the scan selection and dedupes", () => {
		const state = createRun("Test mission", tmpDir);
		const next = setScansSelected(state, ["code", "doc", "code"], tmpDir);
		assert.deepEqual(next.scansSelected, ["code", "doc"]);
		assert.equal(next.currentStage, "brainstorming");

		// Empty array = user skipped scans.
		const skipped = setScansSelected(next, [], tmpDir);
		assert.deepEqual(skipped.scansSelected, []);
	});

	it("setScansSelected rejects unknown scan types", () => {
		const state = createRun("Test mission", tmpDir);
		assert.throws(() => setScansSelected(state, ["code", "web"] as never, tmpDir), /Unknown scan type/);
		// State on disk unchanged by the rejected call.
		assert.equal(loadState(tmpDir).scansSelected, undefined);
	});

	it("upsertBrainstormQuestion inserts, then updates by id", () => {
		const state = createRun("Test mission", tmpDir);
		const q1: BrainstormQuestion = { id: "Q1", text: "Scope?", state: "draft" };
		const inserted = upsertBrainstormQuestion(state, q1, tmpDir);
		assert.equal(inserted.brainstormQuestions?.length, 1);
		assert.equal(inserted.currentStage, "brainstorming");

		const updated = upsertBrainstormQuestion(
			inserted,
			{ id: "Q1", text: "Scope?", state: "agreed", suggestedAnswer: "MVP only" },
			tmpDir,
		);
		assert.equal(updated.brainstormQuestions?.length, 1);
		assert.equal(updated.brainstormQuestions?.[0]?.state, "agreed");
		assert.equal(updated.brainstormQuestions?.[0]?.suggestedAnswer, "MVP only");

		// Persisted.
		assert.equal(loadState(tmpDir).brainstormQuestions?.[0]?.state, "agreed");
	});

	it("upsertBrainstormQuestion requires reason for not-wanted and replaced", () => {
		const state = createRun("Test mission", tmpDir);
		assert.throws(
			() => upsertBrainstormQuestion(state, { id: "Q1", text: "x", state: "not-wanted" }, tmpDir),
			/requires a reason/,
		);
		assert.throws(
			() => upsertBrainstormQuestion(state, { id: "Q1", text: "x", state: "replaced", reason: "  " }, tmpDir),
			/requires a reason/,
		);

		const ok = upsertBrainstormQuestion(
			state,
			{ id: "Q1", text: "x", state: "not-wanted", reason: "Out of scope per user" },
			tmpDir,
		);
		assert.equal(ok.brainstormQuestions?.[0]?.reason, "Out of scope per user");
	});

	it("upsertBrainstormQuestion rejects invalid states and missing fields", () => {
		const state = createRun("Test mission", tmpDir);
		assert.throws(
			() => upsertBrainstormQuestion(state, { id: "Q1", text: "x", state: "bogus" } as never, tmpDir),
			/Unknown question state/,
		);
		assert.throws(
			() => upsertBrainstormQuestion(state, { id: "", text: "x", state: "draft" }, tmpDir),
			/needs question/,
		);
	});

	it("incrementBrainstormDispatchCount counts from zero and never touches currentStage", () => {
		const state = createRun("Test mission", tmpDir);
		const once = incrementBrainstormDispatchCount(state, tmpDir);
		assert.equal(once.brainstormDispatchCount, 1);
		assert.equal(once.currentStage, "brainstorming");
		const twice = incrementBrainstormDispatchCount(once, tmpDir);
		assert.equal(twice.brainstormDispatchCount, 2);
		assert.equal(loadState(tmpDir).brainstormDispatchCount, 2);
	});

	it("clearBrainstormSession removes all four session fields and never touches currentStage", () => {
		let state = createRun("Test mission", tmpDir);
		state = confirmUnderstanding(state, tmpDir);
		state = setScansSelected(state, ["code"], tmpDir);
		state = upsertBrainstormQuestion(state, { id: "Q1", text: "Scope?", state: "agreed" }, tmpDir);
		state = incrementBrainstormDispatchCount(state, tmpDir);

		const cleared = clearBrainstormSession(state, tmpDir);
		assert.equal(cleared.understandingConfirmed, undefined);
		assert.equal(cleared.scansSelected, undefined);
		assert.equal(cleared.brainstormQuestions, undefined);
		assert.equal(cleared.brainstormDispatchCount, undefined);
		assert.equal(cleared.currentStage, "brainstorming");
		assert.equal(cleared.runId, state.runId);
		assert.equal(cleared.mission, state.mission);

		// Persisted to disk.
		const loaded = loadState(tmpDir);
		assert.equal(loaded.understandingConfirmed, undefined);
		assert.equal(loaded.scansSelected, undefined);
		assert.equal(loaded.brainstormQuestions, undefined);
		assert.equal(loaded.brainstormDispatchCount, undefined);
		assert.equal(loaded.currentStage, "brainstorming");
	});

	it("clearBrainstormSession on a fresh run is a no-op for the session fields", () => {
		const state = createRun("Test mission", tmpDir);
		const cleared = clearBrainstormSession(state, tmpDir);
		assert.equal(cleared.understandingConfirmed, undefined);
		assert.equal(cleared.scansSelected, undefined);
		assert.equal(cleared.brainstormQuestions, undefined);
		assert.equal(cleared.brainstormDispatchCount, undefined);
		assert.equal(cleared.currentStage, "brainstorming");
		assert.deepEqual(loadState(tmpDir).currentStage, "brainstorming");
	});

	it("B1/B2 migration: a legacy .IDE_Plans state.json moves to .pi/velpari and inline history splits to history.jsonl", () => {
		const legacy = {
			version: 1,
			runId: "2026-09-12-01-15-legacy-run",
			mission: "Legacy mission",
			currentStage: "drafting-prd",
			history: [{ stage: "brainstorming", command: "/velpari-brainstorm", timestamp: "2026-09-12T01:15:00.000Z" }],
			updatedAt: "2026-09-12T01:20:00.000Z",
		};
		const legacyPath = path.join(tmpDir, PATHS.LEGACY_STATE_FILE);
		fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
		fs.writeFileSync(legacyPath, JSON.stringify(legacy, null, 2), "utf8");

		const loaded = loadState(tmpDir);

		// New state.json exists at the new location; the legacy file is gone.
		const newPath = path.join(tmpDir, PATHS.STATE_FILE);
		assert.ok(fs.existsSync(newPath), "migrated state.json must exist at .pi/velpari/");
		assert.ok(!fs.existsSync(legacyPath), "legacy state.json must be removed after migration");

		// State fields survive; the inline history does not (B2 split).
		assert.equal(loaded.runId, legacy.runId);
		assert.equal(loaded.mission, legacy.mission);
		assert.equal(loaded.currentStage, "drafting-prd");
		assert.equal(loaded.updatedAt, legacy.updatedAt);
		assert.deepEqual(loaded.history, []);
		assert.equal(loaded.understandingConfirmed, undefined);
		assert.equal(loaded.scansSelected, undefined);
		assert.equal(loaded.brainstormQuestions, undefined);
		assert.equal(loaded.brainstormDispatchCount, undefined);

		// History landed in the per-run history.jsonl.
		assert.deepEqual(loadHistory(tmpDir, legacy.runId), legacy.history);

		// One-time backup kept until the next successful saveState.
		assert.ok(fs.existsSync(`${newPath}.premigration.bak`), "premigration backup must exist until the next save");
	});

	// ── v3 — activeSubagents (persistent sub-agent sessions) ────────────

	it("setActiveSubagents persists both handles and auto-stamps spawnedAt", () => {
		const state = createRun("Test mission", tmpDir);
		const next = setActiveSubagents(state, { web: "web", docCode: "doc-code" }, tmpDir);
		assert.equal(next.activeSubagents?.web, "web");
		assert.equal(next.activeSubagents?.docCode, "doc-code");
		assert.ok(next.activeSubagents?.spawnedAt, "spawnedAt must be auto-stamped");
		assert.ok(!Number.isNaN(Date.parse(next.activeSubagents!.spawnedAt!)));
		assert.equal(next.currentStage, "brainstorming");

		// Persisted to disk.
		const loaded = loadState(tmpDir);
		assert.equal(loaded.activeSubagents?.web, "web");
		assert.equal(loaded.activeSubagents?.docCode, "doc-code");
	});

	it("setActiveSubagents accepts a partial payload (one handle only)", () => {
		const state = createRun("Test mission", tmpDir);
		const next = setActiveSubagents(state, { web: "web" }, tmpDir);
		assert.equal(next.activeSubagents?.web, "web");
		assert.equal(next.activeSubagents?.docCode, undefined);
		assert.ok(next.activeSubagents?.spawnedAt);
	});

	it("setActiveSubagents rejects unknown keys", () => {
		const state = createRun("Test mission", tmpDir);
		assert.throws(
			() => setActiveSubagents(state, { web: "web", bogus: "x" } as never, tmpDir),
			/Unknown activeSubagents key/,
		);
		// State on disk unchanged by the rejected call.
		assert.equal(loadState(tmpDir).activeSubagents, undefined);
	});

	it("setActiveSubagents honors an explicit spawnedAt timestamp (caller override)", () => {
		const state = createRun("Test mission", tmpDir);
		const explicit = "2026-09-19T08:00:00.000Z";
		const next = setActiveSubagents(state, { web: "web", docCode: "doc-code", spawnedAt: explicit }, tmpDir);
		assert.equal(next.activeSubagents?.spawnedAt, explicit);
	});

	it("clearBrainstormSession also clears activeSubagents (v3 cleanup)", () => {
		let state = createRun("Test mission", tmpDir);
		state = setActiveSubagents(state, { web: "web", docCode: "doc-code" }, tmpDir);
		assert.ok(state.activeSubagents);

		const cleared = clearBrainstormSession(state, tmpDir);
		assert.equal(cleared.activeSubagents, undefined);
		assert.equal(cleared.currentStage, "brainstorming");

		// Persisted to disk.
		const loaded = loadState(tmpDir);
		assert.equal(loaded.activeSubagents, undefined);
	});

	it("an old v1.x state.json with scansSelected (no activeSubagents) still loads", () => {
		const legacy = {
			version: 1,
			runId: "2026-09-12-01-15-legacy-v1",
			mission: "Legacy v1 mission",
			currentStage: "drafting-prd",
			history: [],
			updatedAt: "2026-09-12T01:20:00.000Z",
			scansSelected: ["code", "doc"],
			brainstormDispatchCount: 2,
		};
		const filePath = path.join(tmpDir, PATHS.STATE_FILE);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, JSON.stringify(legacy, null, 2), "utf8");

		const loaded = loadState(tmpDir);
		assert.deepEqual(loaded.scansSelected, ["code", "doc"]);
		assert.equal(loaded.brainstormDispatchCount, 2);
		assert.equal(loaded.activeSubagents, undefined);
	});
});

describe("brainstorm-anytime session primitives (A2 — D1/D2/D5/D7)", () => {
	function enterStage(stage: string): void {
		const run = createRun("Mid-run mission", tmpDir);
		saveState({ ...run, currentStage: stage as never }, tmpDir);
	}

	it("open from a mid-run stage pauses it and resets the dispatch count (D5)", () => {
		enterStage("designing");
		saveState({ ...loadState(tmpDir), brainstormDispatchCount: 3 }, tmpDir);

		const opened = openBrainstormSession(tmpDir);
		assert.equal(opened.currentStage, "brainstorming");
		assert.equal(opened.pausedStage, "designing");
		assert.equal(opened.brainstormDispatchCount, 0);

		const loaded = loadState(tmpDir);
		assert.equal(loaded.currentStage, "brainstorming");
		assert.equal(loaded.pausedStage, "designing");
		const history = loadHistory(tmpDir, loaded.runId);
		assert.match(history[history.length - 1]!.command, /open-session/);
	});

	it("open while a session is open throws (no nesting)", () => {
		enterStage("designing");
		openBrainstormSession(tmpDir);
		assert.throws(() => openBrainstormSession(tmpDir), /already open/);
	});

	it("resume continue restores the paused stage and clears session fields", () => {
		enterStage("planned-tests");
		openBrainstormSession(tmpDir);
		saveState({ ...loadState(tmpDir), understandingConfirmed: true, brainstormDispatchCount: 2 }, tmpDir);

		const resumed = resumeFromBrainstorm(tmpDir, "continue");
		assert.equal(resumed.currentStage, "planned-tests");
		assert.equal(resumed.pausedStage, undefined);
		assert.equal(resumed.understandingConfirmed, undefined);
		assert.equal(resumed.brainstormDispatchCount, undefined);

		const history = loadHistory(tmpDir, resumed.runId);
		assert.match(history[history.length - 1]!.command, /\(continue\)/);
	});

	it("resume restart-prd lands at brainstormed from any paused stage", () => {
		enterStage("ordered-development");
		openBrainstormSession(tmpDir);

		const resumed = resumeFromBrainstorm(tmpDir, "restart-prd");
		assert.equal(resumed.currentStage, "brainstormed");
		assert.equal(resumed.pausedStage, undefined);
	});

	it("resume continue without a paused stage throws (first-run shape)", () => {
		createRun("First-run mission", tmpDir);
		assert.throws(() => resumeFromBrainstorm(tmpDir, "continue"), /requires a paused stage/);
		// restart-prd works — this IS the first-run approve path.
		const resumed = resumeFromBrainstorm(tmpDir, "restart-prd");
		assert.equal(resumed.currentStage, "brainstormed");
	});

	it("resume/discard with no open session throws", () => {
		enterStage("designing");
		assert.throws(() => resumeFromBrainstorm(tmpDir, "restart-prd"), /No brainstorm session is open/);
		assert.throws(() => discardBrainstormSession(tmpDir), /No brainstorm session is open/);
	});

	it("discard mid-run resumes the paused stage and writes no artifact (D7)", () => {
		enterStage("writing-pseudocode");
		openBrainstormSession(tmpDir);
		saveState({ ...loadState(tmpDir), understandingConfirmed: true }, tmpDir);

		const discarded = discardBrainstormSession(tmpDir);
		assert.equal(discarded.currentStage, "writing-pseudocode");
		assert.equal(discarded.pausedStage, undefined);
		assert.equal(discarded.understandingConfirmed, undefined);

		const history = loadHistory(tmpDir, discarded.runId);
		assert.match(history[history.length - 1]!.command, /discard/);
		assert.equal(fs.existsSync(path.join(tmpDir, "Doc", "brainstorm")), false);
	});

	it("discard on a first-run session returns to none", () => {
		createRun("First-run mission", tmpDir);
		const discarded = discardBrainstormSession(tmpDir);
		assert.equal(discarded.currentStage, "none");
		assert.equal(discarded.pausedStage, undefined);
	});

	it("an old state.json without pausedStage loads unchanged", () => {
		enterStage("designing");
		assert.equal(loadState(tmpDir).pausedStage, undefined);
	});
});
