/**
 * Setup-progress doctor check tests (audit item c6 — paused-stage fix).
 *
 * Covers:
 *   - no run → all gates pending (baseline)
 *   - mid-run stage → gates done per stage position (unchanged behavior)
 *   - paused mid-run brainstorm (currentStage "brainstorming" +
 *     pausedStage set) → gates reflect the PAUSED stage, not
 *     "never brainstormed" (D2)
 *   - history fallback — an approved brainstorm earlier in the run proves
 *     the "has ever happened" gates even at an early stage position
 *   - first-run brainstorm (no pausedStage, only the seed entry) → pending
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkSetupProgress } from "../../src/doctor/checks/setup-progress.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-setup-progress-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Minimal state.json; pausedStage/history entries optional. */
function writeState(opts: { currentStage: string; pausedStage?: string; runId?: string }): string {
	const runId = opts.runId ?? "2026-09-21-1200-test";
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	const state: Record<string, unknown> = {
		version: 1,
		runId,
		mission: "Test",
		currentStage: opts.currentStage,
		updatedAt: new Date().toISOString(),
	};
	if (opts.pausedStage) state.pausedStage = opts.pausedStage;
	fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state), "utf8");
	return runId;
}

function writeHistory(runId: string, commands: string[]): void {
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId);
	fs.mkdirSync(dir, { recursive: true });
	const lines = commands.map((command, i) =>
		JSON.stringify({ stage: "brainstorming", command, timestamp: `2026-09-21T12:0${i}:00.000Z` }),
	);
	fs.writeFileSync(path.join(dir, "history.jsonl"), lines.join("\n") + "\n", "utf8");
}

function item(section: ReturnType<typeof checkSetupProgress>, prefix: string) {
	const found = section.items.find((i) => i.message.startsWith(prefix));
	assert.ok(found, `item "${prefix}…" missing`);
	return found!;
}

describe("checkSetupProgress — paused-stage + history evidence (c6)", () => {
	it("no run → brainstorm + approve gates pending", () => {
		const section = checkSetupProgress(tmpDir);
		assert.equal(item(section, "2. Brainstorm completed").status, "info");
		assert.match(item(section, "2. Brainstorm completed").message, /pending/);
		assert.equal(item(section, "6. First approve").status, "info");
	});

	it("mid-run stage → gates done (baseline unchanged)", () => {
		writeState({ currentStage: "designing" });
		const section = checkSetupProgress(tmpDir);
		assert.equal(item(section, "2. Brainstorm completed").status, "ok");
		assert.equal(item(section, "3. PRD drafted").status, "ok");
		assert.equal(item(section, "4. RTM built").status, "ok");
		assert.equal(item(section, "6. First approve").status, "ok");
	});

	it("paused mid-run brainstorm → gates evaluated as of the paused stage", () => {
		// currentStage is "brainstorming" while the session is open; the run
		// had reached "designing" before the pause (D2).
		writeState({ currentStage: "brainstorming", pausedStage: "designing" });
		const section = checkSetupProgress(tmpDir);
		assert.equal(item(section, "2. Brainstorm completed").status, "ok");
		assert.equal(item(section, "3. PRD drafted").status, "ok");
		assert.equal(item(section, "4. RTM built").status, "ok");
		assert.equal(item(section, "6. First approve").status, "ok");
	});

	it("paused at an early stage → only the gates the paused stage passed are done", () => {
		writeState({ currentStage: "brainstorming", pausedStage: "building-rtm" });
		const section = checkSetupProgress(tmpDir);
		assert.equal(item(section, "2. Brainstorm completed").status, "ok");
		assert.equal(item(section, "3. PRD drafted").status, "ok");
		assert.equal(item(section, "4. RTM built").status, "info");
		assert.equal(item(section, "6. First approve").status, "ok");
	});

	it("first-run brainstorm (no pausedStage, seed-only history) → gates pending", () => {
		const runId = writeState({ currentStage: "brainstorming" });
		writeHistory(runId, ["/velpari-brainstorm"]);
		const section = checkSetupProgress(tmpDir);
		assert.equal(item(section, "2. Brainstorm completed").status, "info");
		assert.equal(item(section, "6. First approve").status, "info");
	});

	it("history fallback: approved brainstorm earlier in the run proves the gates", () => {
		// Re-brainstorm after approve — stage alone reads as pre-approve, but
		// the run history carries the approve entries.
		const runId = writeState({ currentStage: "brainstormed" });
		writeHistory(runId, ["/velpari-brainstorm", "/velpari-approve-brainstorm"]);
		const section = checkSetupProgress(tmpDir);
		assert.equal(item(section, "2. Brainstorm completed").status, "ok");
		assert.equal(item(section, "6. First approve").status, "ok");
	});
});
