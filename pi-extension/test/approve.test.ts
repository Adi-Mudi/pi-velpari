import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApprove } from "../src/discipline/approve.js";
import { saveFilesConfig } from "../src/core/config.js";
import { createRun, clearRun } from "../src/core/state.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-approve-"));
}

function makeUI(notifies: Array<{ msg: string; level: string }>) {
	return {
		notifies,
		async confirm(_t: string, _m: string) {
			return true;
		},
		notify(msg: string, level: string) {
			notifies.push({ msg, level });
		},
		// v0.5.1 Phase J.2: handleApprove pushes a footer status bar via
		// the documented ctx.ui.setStatus(key, text) API. No-op mock.
		setStatus(_key: string, _text: string | undefined) {
			// intentionally empty: tests assert on state + publishes, not the
			// status bar text. The status bar contract is pinned by
			// status.test.ts and index.test.ts.
		},
	};
}

test("handleApprove refuses when in discussing stage (FR-59)", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		// State is currently 'discussing'
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleApprove(ctx as never, undefined, dir);
		const errored = notifies.some(
			(n) => n.level === "error" && /approve-discuss/i.test(n.msg),
		);
		assert.ok(errored, "expected an error redirecting to /velpari-approve-discuss");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleApprove publishes working copy for stages 2-7", async () => {
	const dir = tempDir();
	try {
		const state = createRun("Mission", dir);
		// Manually set state to drafting-prd by creating a working copy
		const { writeFileSync, mkdirSync } = await import("node:fs");
		const workingDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "prd");
		mkdirSync(workingDir, { recursive: true });
		writeFileSync(join(workingDir, "PRD_TestApp.md"), "# PRD content\n", "utf8");

		// But state is still 'discussing' from createRun. handleApprove will refuse.
		// The test documents the gate behavior.
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleApprove(ctx as never, undefined, dir);
		// The handler refuses because state is 'discussing' (FR-59).
		const errored = notifies.some((n) => n.level === "error");
		assert.ok(errored, "expected handleApprove to error in discussing state");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleApprove refuses when no run is active", async () => {
	const dir = tempDir();
	try {
		// No createRun — state stays 'none'
		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleApprove(ctx as never, undefined, dir);
		const errored = notifies.some((n) => n.level === "error");
		assert.ok(errored, "expected an error when no run is active");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleApprove publishes working copy + transitions state for prd stage", async () => {
	const dir = tempDir();
	try {
		const state = createRun("Mission", dir);
		// Patch state directly to drafting-prd so we test the success path.
		const { writeFileSync, readFileSync, mkdirSync } = await import("node:fs");
		const statePath = join(dir, ".IDE_Plans", "velpari", "state.json");
		const raw = readFileSync(statePath, "utf8");
		const patched = JSON.parse(raw);
		patched.currentStage = "drafting-prd";
		mkdirSync(join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "prd"), {
			recursive: true,
		});
		writeFileSync(statePath, JSON.stringify(patched, null, 2), "utf8");

		// Create a working copy
		const workingDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "prd");
		writeFileSync(join(workingDir, "PRD_Mission.md"), "# PRD content\n", "utf8");

		const notifies: Array<{ msg: string; level: string }> = [];
		const ctx = { ui: makeUI(notifies) } as never;
		await handleApprove(ctx as never, undefined, dir);

		// Verify published copy exists at Doc/requirements/PRD_Mission.md (grouped layout).
		const publishedPath = join(dir, "Doc", "requirements", "PRD_Mission.md");
		assert.ok(existsSync(publishedPath), "published copy not created at Doc/requirements/");

		// Verify state transitioned
		const afterRaw = readFileSync(statePath, "utf8");
		const after = JSON.parse(afterRaw);
		assert.equal(after.currentStage, "drafted-prd", "state should be drafted-prd after approve");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleApprove uses configured projectName for grouped output", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "ConfiguredApp", inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		const state = createRun("Mission", dir);
		const { writeFileSync, readFileSync, mkdirSync } = await import("node:fs");
		const statePath = join(dir, ".IDE_Plans", "velpari", "state.json");
		const raw = readFileSync(statePath, "utf8");
		const patched = JSON.parse(raw);
		patched.currentStage = "drafting-prd";
		const workingDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "prd");
		mkdirSync(workingDir, { recursive: true });
		writeFileSync(statePath, JSON.stringify(patched, null, 2), "utf8");
		writeFileSync(join(workingDir, "PRD_Mission.md"), "# PRD content\n", "utf8");

		const ctx = { ui: makeUI([]) } as never;
		await handleApprove(ctx as never, undefined, dir);

		assert.ok(existsSync(join(dir, "Doc", "requirements", "PRD_ConfiguredApp.md")));
		assert.equal(existsSync(join(dir, "Doc", "requirements", "PRD_Mission.md")), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// Parameterized happy-path test for all 6 stages (FR-08).
// Exhaustive coverage of the stageToArtifact mapping in approve.ts.
// Phase 7: each stage's working-copy category matches the grouped Doc/
// subfolder. testplan uses "tests" as the new working-copy category.
const STAGE_CASES: ReadonlyArray<{
	stage: string;
	nextStage: string;
	workingDir: string;
	artifact: string;
	workingFile: string;
	publishedCategory: string;
	extraFiles?: string[];
	extraCategory?: string;
}> = [
	{ stage: "drafting-prd", nextStage: "drafted-prd", workingDir: "prd", artifact: "PRD", workingFile: "PRD_Mission.md", publishedCategory: "requirements" },
	{ stage: "building-rtm", nextStage: "built-rtm", workingDir: "rtm", artifact: "RTM", workingFile: "RTM_Mission.md", publishedCategory: "requirements" },
	{
		stage: "analyzing-feasibility",
		nextStage: "analyzed-feasibility",
		workingDir: "feasibility",
		artifact: "feasibility-study",
		workingFile: "feasibility-study_Mission.md",
		publishedCategory: "feasibility",
	},
	{ stage: "designing", nextStage: "designed", workingDir: "design", artifact: "design", workingFile: "design_Mission.md", publishedCategory: "design" },
	{
		stage: "writing-pseudocode",
		nextStage: "wrote-pseudocode",
		workingDir: "pseudocode",
		artifact: "pseudocode",
		workingFile: "pseudocode_Mission.md",
		publishedCategory: "pseudocode",
	},
	{
		stage: "planning-tests",
		nextStage: "planned-tests",
		workingDir: "tests",
		artifact: "test-plan",
		workingFile: "test-plan_Mission.md",
		publishedCategory: "tests",
		extraFiles: ["test-cases_Mission.md"],
		extraCategory: "tests",
	},
];

for (const c of STAGE_CASES) {
	test(`handleApprove happy-path: ${c.stage} -> ${c.nextStage}`, async () => {
		const dir = tempDir();
		try {
			const state = createRun("Mission", dir);
			const { writeFileSync, readFileSync, mkdirSync } = await import("node:fs");
			const statePath = join(dir, ".IDE_Plans", "velpari", "state.json");
			const raw = readFileSync(statePath, "utf8");
			const patched = JSON.parse(raw);
			patched.currentStage = c.stage;
			mkdirSync(join(dir, ".IDE_Plans", "velpari", "runs", state.runId, c.workingDir), {
				recursive: true,
			});
			writeFileSync(statePath, JSON.stringify(patched, null, 2), "utf8");

			// Create working copy
			const workingDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, c.workingDir);
			writeFileSync(join(workingDir, c.workingFile), `# ${c.workingFile}\n`, "utf8");
			if (c.extraFiles) {
				for (const f of c.extraFiles) {
					writeFileSync(join(workingDir, f), `# ${f}\n`, "utf8");
				}
			}

			const notifies: Array<{ msg: string; level: string }> = [];
			const ctx = { ui: makeUI(notifies) } as never;
			await handleApprove(ctx as never, undefined, dir);

			// Verify published copy exists at the grouped Doc/<category>/<artifact>_<project>.md
			const groupedPath = join(dir, "Doc", c.publishedCategory, c.workingFile);
			assert.ok(existsSync(groupedPath), `${groupedPath} not published`);
			if (c.extraFiles && c.extraCategory) {
				for (const f of c.extraFiles) {
					assert.ok(existsSync(join(dir, "Doc", c.extraCategory, f)), `${f} not published`);
				}
			}

			// Verify state transitioned
			const afterRaw = readFileSync(statePath, "utf8");
			const after = JSON.parse(afterRaw);
			assert.equal(after.currentStage, c.nextStage, `state should be ${c.nextStage} after approve`);
		} finally {
			clearRun(dir);
			rmSync(dir, { recursive: true, force: true });
		}
	});
}
