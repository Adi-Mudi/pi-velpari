/**
 * Brainstorm session state helpers (Phase 1).
 *
 * Asserts the invariants the lifecycle v2 depends on:
 *   - helpers mutate ONLY the brainstorm session fields (+ updatedAt);
 *     currentStage NEVER changes (the stage machine stays chained)
 *   - an old state.json (without the new fields) loads unchanged
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
	incrementBrainstormDispatchCount,
	loadState,
	setActiveSubagents,
	setScansSelected,
	upsertBrainstormQuestion,
	type BrainstormQuestion,
} from "../../src/core/state.js";
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
		assert.throws(
			() => setScansSelected(state, ["code", "web"] as never, tmpDir),
			/Unknown scan type/,
		);
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
			() =>
				upsertBrainstormQuestion(
					state,
					{ id: "Q1", text: "x", state: "not-wanted" },
					tmpDir,
				),
			/requires a reason/,
		);
		assert.throws(
			() =>
				upsertBrainstormQuestion(
					state,
					{ id: "Q1", text: "x", state: "replaced", reason: "  " },
					tmpDir,
				),
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
			() =>
				upsertBrainstormQuestion(
					state,
					{ id: "Q1", text: "x", state: "bogus" } as never,
					tmpDir,
				),
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
		state = upsertBrainstormQuestion(
			state,
			{ id: "Q1", text: "Scope?", state: "agreed" },
			tmpDir,
		);
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

	it("an old state.json without the new fields loads unchanged", () => {
		const legacy = {
			version: 1,
			runId: "2026-09-12-01-15-legacy-run",
			mission: "Legacy mission",
			currentStage: "drafting-prd",
			history: [
				{ stage: "brainstorming", command: "/velpari-brainstorm", timestamp: "2026-09-12T01:15:00.000Z" },
			],
			updatedAt: "2026-09-12T01:20:00.000Z",
		};
		const filePath = path.join(tmpDir, PATHS.STATE_FILE);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, JSON.stringify(legacy, null, 2), "utf8");

		const loaded = loadState(tmpDir);
		assert.deepEqual(loaded, legacy);
		assert.equal(loaded.understandingConfirmed, undefined);
		assert.equal(loaded.scansSelected, undefined);
		assert.equal(loaded.brainstormQuestions, undefined);
		assert.equal(loaded.brainstormDispatchCount, undefined);
	});

	// ── v3 — activeSubagents (persistent sub-agent sessions) ────────────

	it("setActiveSubagents persists both handles and auto-stamps spawnedAt", () => {
		const state = createRun("Test mission", tmpDir);
		const next = setActiveSubagents(
			state,
			{ web: "web", docCode: "doc-code" },
			tmpDir,
		);
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
			() =>
				setActiveSubagents(
					state,
					{ web: "web", bogus: "x" } as never,
					tmpDir,
				),
			/Unknown activeSubagents key/,
		);
		// State on disk unchanged by the rejected call.
		assert.equal(loadState(tmpDir).activeSubagents, undefined);
	});

	it("setActiveSubagents honors an explicit spawnedAt timestamp (caller override)", () => {
		const state = createRun("Test mission", tmpDir);
		const explicit = "2026-09-19T08:00:00.000Z";
		const next = setActiveSubagents(
			state,
			{ web: "web", docCode: "doc-code", spawnedAt: explicit },
			tmpDir,
		);
		assert.equal(next.activeSubagents?.spawnedAt, explicit);
	});

	it("clearBrainstormSession also clears activeSubagents (v3 cleanup)", () => {
		let state = createRun("Test mission", tmpDir);
		state = setActiveSubagents(
			state,
			{ web: "web", docCode: "doc-code" },
			tmpDir,
		);
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
