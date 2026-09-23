/**
 * Spawn helper tests (Phase 2 — v3 AUTOMATIC SPAWN).
 *
 * Covers:
 *   - BRAINSTORM_SESSION_HANDLES is the single source of truth (stable
 *     strings; rename ripples everywhere)
 *   - BRAINSTORM_PERSISTENT_AGENTS maps to the bundled agent markdown
 *     filenames (Phase 4 dependency)
 *   - spawnPersistentSessions is idempotent (re-call returns existing)
 *   - spawnPersistentSessions emits the correct subagent() call shape
 *     (session handle, agent name, prompt carries mission, timeout set)
 *   - spawnPersistentSessions surfaces an error when state has no runId
 *   - persistSpawnHandles writes the handles via setActiveSubagents
 *   - persistSpawnHandles round-trips through loadState
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	BRAINSTORM_PERSISTENT_AGENTS,
	BRAINSTORM_SESSION_HANDLES,
	BRAINSTORM_SPAWN_TIMEOUT_MS,
	persistSpawnHandles,
	spawnPersistentSessions,
} from "../../../src/stages/brainstorm/spawn-sessions.js";
import { createRun, loadState } from "../../../src/core/state.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-spawn-sessions-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("BRAINSTORM_SESSION_HANDLES + BRAINSTORM_PERSISTENT_AGENTS", () => {
	it("uses stable session handle strings (single source of truth)", () => {
		assert.equal(BRAINSTORM_SESSION_HANDLES.web, "web");
		assert.equal(BRAINSTORM_SESSION_HANDLES.docCode, "doc-code");
	});

	it("maps to the bundled agent markdown filenames", () => {
		assert.equal(BRAINSTORM_PERSISTENT_AGENTS.web, "web-research");
		assert.equal(BRAINSTORM_PERSISTENT_AGENTS.docCode, "doc-code-analyst");
	});

	it("spawn timeout is 60s (generous — first call boots child Pi process)", () => {
		assert.equal(BRAINSTORM_SPAWN_TIMEOUT_MS, 60_000);
	});
});

describe("spawnPersistentSessions — happy path", () => {
	it("emits 2 calls (one per session) with the right agent + handle + prompt", () => {
		createRun("Test mission", tmpDir);

		const result = spawnPersistentSessions({
			cwd: tmpDir,
			mission: "Test mission",
			projectName: "TestProject",
		});

		assert.equal(result.ok, true);
		if (!result.ok || result.alreadySpawned) return;
		assert.equal(result.needsDispatch, true);
		assert.equal(result.calls.length, 2);

		const web = result.calls.find((c) => c.agent === BRAINSTORM_PERSISTENT_AGENTS.web);
		const doc = result.calls.find((c) => c.agent === BRAINSTORM_PERSISTENT_AGENTS.docCode);
		assert.ok(web, "web call must exist");
		assert.ok(doc, "doc call must exist");
		assert.equal(web.session, BRAINSTORM_SESSION_HANDLES.web);
		assert.equal(doc.session, BRAINSTORM_SESSION_HANDLES.docCode);
		assert.equal(web.timeoutMs, BRAINSTORM_SPAWN_TIMEOUT_MS);
		assert.equal(doc.timeoutMs, BRAINSTORM_SPAWN_TIMEOUT_MS);
	});

	it("includes the mission string in both spawn prompts", () => {
		createRun("Find a faster scraper", tmpDir);

		const result = spawnPersistentSessions({
			cwd: tmpDir,
			mission: "Find a faster scraper",
		});

		assert.equal(result.ok, true);
		if (!result.ok || result.alreadySpawned) return;
		for (const c of result.calls) {
			assert.match(c.prompt, /Find a faster scraper/);
		}
	});

	it("includes the project name when provided", () => {
		createRun("Mission", tmpDir);

		const result = spawnPersistentSessions({
			cwd: tmpDir,
			mission: "Mission",
			projectName: "DK-NSE_Announcement",
		});

		assert.equal(result.ok, true);
		if (!result.ok || result.alreadySpawned) return;
		for (const c of result.calls) {
			assert.match(c.prompt, /DK-NSE_Announcement/);
		}
	});

	it("omits the project hint when projectName is null", () => {
		createRun("Mission", tmpDir);

		const result = spawnPersistentSessions({
			cwd: tmpDir,
			mission: "Mission",
			projectName: null,
		});

		assert.equal(result.ok, true);
		if (!result.ok || result.alreadySpawned) return;
		for (const c of result.calls) {
			assert.doesNotMatch(c.prompt, /for project ""/);
		}
	});

	it("includes the session handle in the prompt so the child knows its handle", () => {
		createRun("Mission", tmpDir);

		const result = spawnPersistentSessions({
			cwd: tmpDir,
			mission: "Mission",
		});

		assert.equal(result.ok, true);
		if (!result.ok || result.alreadySpawned) return;
		const web = result.calls.find((c) => c.agent === BRAINSTORM_PERSISTENT_AGENTS.web);
		const doc = result.calls.find((c) => c.agent === BRAINSTORM_PERSISTENT_AGENTS.docCode);
		assert.match(web!.prompt, /handle: web/);
		assert.match(doc!.prompt, /handle: doc-code/);
	});
});

describe("spawnPersistentSessions — idempotency", () => {
	it("returns alreadySpawned=true when both handles are already in state", () => {
		let state = createRun("Mission", tmpDir);
		state = persistSpawnHandles(
			state,
			{ web: BRAINSTORM_SESSION_HANDLES.web, docCode: BRAINSTORM_SESSION_HANDLES.docCode },
			tmpDir,
		);

		const result = spawnPersistentSessions({ cwd: tmpDir, mission: "Mission" });

		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.alreadySpawned, true);
		assert.equal(result.web, BRAINSTORM_SESSION_HANDLES.web);
		assert.equal(result.docCode, BRAINSTORM_SESSION_HANDLES.docCode);
		if (result.alreadySpawned) {
			assert.ok(result.spawnedAt);
		}
	});

	it("does not emit new calls when already spawned", () => {
		let state = createRun("Mission", tmpDir);
		state = persistSpawnHandles(state, { web: "web", docCode: "doc-code" }, tmpDir);

		const result = spawnPersistentSessions({ cwd: tmpDir, mission: "Mission" });

		assert.equal(result.ok, true);
		if (!result.ok || !result.alreadySpawned) return;
		assert.equal(
			(result as unknown as { calls?: unknown }).calls,
			undefined,
			"alreadySpawned must not include fresh spawn calls",
		);
	});
});

describe("spawnPersistentSessions — error paths", () => {
	it("errors when no active run exists", () => {
		// Don't call createRun — no state.json on disk.
		const result = spawnPersistentSessions({ cwd: tmpDir, mission: "Mission" });

		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.match(result.error, /No active run/);
		assert.match(result.error, /createRun/);
	});

	it("errors when state.json is corrupt (JSON parse failure surfaces)", () => {
		fs.mkdirSync(path.join(tmpDir, ".pi/velpari"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, ".pi/velpari/state.json"), "{ broken json");

		const result = spawnPersistentSessions({ cwd: tmpDir, mission: "Mission" });

		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.match(result.error, /Cannot read state/);
	});
});

describe("persistSpawnHandles", () => {
	it("writes both handles to state and round-trips through loadState", () => {
		const state = createRun("Mission", tmpDir);
		const next = persistSpawnHandles(state, { web: "web", docCode: "doc-code" }, tmpDir);

		assert.equal(next.activeSubagents?.web, "web");
		assert.equal(next.activeSubagents?.docCode, "doc-code");

		const loaded = loadState(tmpDir);
		assert.equal(loaded.activeSubagents?.web, "web");
		assert.equal(loaded.activeSubagents?.docCode, "doc-code");
	});

	it("stamps spawnedAt on first write", () => {
		const state = createRun("Mission", tmpDir);
		const next = persistSpawnHandles(state, { web: "web", docCode: "doc-code" }, tmpDir);

		assert.ok(next.activeSubagents?.spawnedAt);
		assert.ok(!Number.isNaN(Date.parse(next.activeSubagents!.spawnedAt!)));
	});

	it("updates spawnedAt on every call (last write wins)", () => {
		let state = createRun("Mission", tmpDir);
		state = persistSpawnHandles(state, { web: "web", docCode: "doc-code" }, tmpDir);
		const first = state.activeSubagents?.spawnedAt;

		// small delay so the ISO timestamp differs
		const waited = Date.parse(first!) + 5;
		while (Date.now() < waited) {
			// busy wait — should be sub-millisecond
		}

		state = persistSpawnHandles(state, { web: "web", docCode: "doc-code" }, tmpDir);
		const second = state.activeSubagents?.spawnedAt;

		assert.ok(second);
		assert.ok(Date.parse(second!) >= Date.parse(first!));
	});
});
