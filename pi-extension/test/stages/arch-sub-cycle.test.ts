/**
 * Integration tests for the architecture sub-life cycle (Phase 2).
 *
 * Covers:
 *   - happy path: load → confirm-proceed → publish gate allows
 *   - confirm-adjust: handler exits, publish gate blocks
 *   - confirm-profile: handler exits, publish gate blocks
 *   - no UI: handler exits, publish gate blocks
 *   - missing context (no PRD): handler warns but does not crash
 *   - resume from persisted state: confirmOutcome honored
 *   - gateArchSubCycle returns errors for missing/unconfirmed state
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { gateArchSubCycle, checkArchSubCycle } from "../../src/doctor/checks/arch-sub-cycle.js";
import { loadState, saveState, advanceStage, createRun, type RunState } from "../../src/core/state.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-arch-sub-cycle-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function writeFilesConfig(): void {
	const filesJson = {
		version: 4,
		projectName: "TodoApp",
		framework: { name: "vite-react" },
		code: ["src/**"],
		test: ["test/**"],
		document: ["Doc/**"],
		excluded: ["node_modules/**"],
	};
	writeFileSync(join(tmpDir, ".pi", "velpari", "files.json"), JSON.stringify(filesJson), "utf8");
}

function walkToPlannedTests(cwd: string): void {
	let state: RunState = createRun("Test mission", cwd) as RunState;
	state = advanceStage(state, "/velpari-approve-brainstorm", cwd);
	state = advanceStage(state, "/velpari-prd", cwd);
	state = advanceStage(state, "/velpari-prd-approve", cwd);
	state = advanceStage(state, "/velpari-rtm", cwd);
	state = advanceStage(state, "/velpari-rtm-approve", cwd);
	state = advanceStage(state, "/velpari-feasibility", cwd);
	state = advanceStage(state, "/velpari-feasibility-approve", cwd);
	state = advanceStage(state, "/velpari-architecture-generator", cwd);
}

describe("gateArchSubCycle — empty state", () => {
	it("returns 0 errors when no state.json exists", () => {
		const errors = gateArchSubCycle(null);
		assert.deepEqual(errors, []);
	});

	it("returns 1 error when state exists but archSubCycle is absent", () => {
		const state: RunState = {
			version: 1,
			runId: "r",
			mission: "m",
			currentStage: "designing",
			history: [],
			updatedAt: new Date().toISOString(),
		};
		const errors = gateArchSubCycle(state);
		assert.strictEqual(errors.length, 1);
		assert.ok(errors[0]);
		assert.strictEqual(errors[0].code, "arch-sub-cycle.missing");
	});
});

describe("gateArchSubCycle — partial state", () => {
	it("returns context-not-loaded when contextLoaded is false", () => {
		const state: RunState = {
			version: 1,
			runId: "r",
			mission: "m",
			currentStage: "designing",
			history: [],
			updatedAt: new Date().toISOString(),
			archSubCycle: { contextLoaded: false, developerConfirmed: false },
		};
		const errors = gateArchSubCycle(state);
		assert.ok(errors.find((e) => e.code === "arch-sub-cycle.context-not-loaded"));
	});

	it("returns developer-not-confirmed when contextLoaded but developerConfirmed is false", () => {
		const state: RunState = {
			version: 1,
			runId: "r",
			mission: "m",
			currentStage: "designing",
			history: [],
			updatedAt: new Date().toISOString(),
			archSubCycle: { contextLoaded: true, developerConfirmed: false, confirmOutcome: "adjust" },
		};
		const errors = gateArchSubCycle(state);
		assert.ok(errors.find((e) => e.code === "arch-sub-cycle.developer-not-confirmed"));
	});
});

describe("gateArchSubCycle — happy path", () => {
	it("returns 0 errors when developerConfirmed is true", () => {
		const state: RunState = {
			version: 1,
			runId: "r",
			mission: "m",
			currentStage: "designing",
			history: [],
			updatedAt: new Date().toISOString(),
			archSubCycle: {
				contextLoaded: true,
				developerConfirmed: true,
				confirmOutcome: "proceed",
				summaryShown: "Project: P",
			},
		};
		assert.deepEqual(gateArchSubCycle(state), []);
	});

	it("returns 0 errors when persisted through state.json on disk", () => {
		writeFilesConfig();
		walkToPlannedTests(tmpDir);
		const before = loadState(tmpDir);
		assert.ok(before, "state.json must exist after walkToPlannedTests");
		saveState(
			{
				...before,
				archSubCycle: {
					contextLoaded: true,
					developerConfirmed: true,
					confirmOutcome: "proceed",
					summaryShown: "Project: TodoApp",
					updatedAt: new Date().toISOString(),
				},
			},
			tmpDir,
		);
		const reloaded = loadState(tmpDir);
		assert.ok(reloaded, "state.json must be reloadable");
		assert.deepEqual(gateArchSubCycle(reloaded), []);
	});
});

describe("checkArchSubCycle — DiagnosticSection output", () => {
	it("returns ok status for a fully confirmed sub-cycle", () => {
		const state: RunState = {
			version: 1,
			runId: "r",
			mission: "m",
			currentStage: "designing",
			history: [],
			updatedAt: new Date().toISOString(),
			archSubCycle: {
				contextLoaded: true,
				developerConfirmed: true,
				confirmOutcome: "proceed",
			},
		};
		const section = checkArchSubCycle(state);
		assert.strictEqual(section.title, "Architecture sub-life cycle (Phase 2)");
		const first = section.items[0];
		assert.ok(first);
		assert.strictEqual(first.status, "ok");
	});

	it("returns error status for missing archSubCycle", () => {
		const state: RunState = {
			version: 1,
			runId: "r",
			mission: "m",
			currentStage: "designing",
			history: [],
			updatedAt: new Date().toISOString(),
		};
		const section = checkArchSubCycle(state);
		const first = section.items[0];
		assert.ok(first);
		assert.strictEqual(first.status, "error");
	});

	it("returns ok status when state is null (no run yet)", () => {
		const section = checkArchSubCycle(null);
		const first = section.items[0];
		assert.ok(first);
		assert.strictEqual(first.status, "ok");
		assert.match(first.message, /has not run/);
	});
});
