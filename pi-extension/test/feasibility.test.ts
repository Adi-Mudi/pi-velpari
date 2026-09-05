import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleFeasibility } from "../src/feasibility.js";
import { saveFilesConfig } from "../src/config.js";
import { createRun, clearRun, loadState } from "../src/state.js";

interface MockUI {
	notifies: Array<{ msg: string; level: string }>;
	notify: (msg: string, level: string) => void;
}
interface MockPi {
	sent: Array<{ prompt: string }>;
	sendUserMessage: (p: string) => void;
}

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-feas-"));
}
function makeMockUI(): MockUI {
	const notifies: Array<{ msg: string; level: string }> = [];
	return { notifies, notify(msg, level) { notifies.push({ msg, level }); } };
}
function makeMockPi(): MockPi {
	const sent: Array<{ prompt: string }> = [];
	return { sent, sendUserMessage(p) { sent.push({ prompt: p }); } };
}

function setupValidRun(dir: string, projectName = "TestApp", mission = "Mission"): void {
	saveFilesConfig(
		{
			version: 3,
			projectName,
			framework: { language: "TypeScript" },
			inputDocuments: [],
			outputPaths: {},
			excludedPaths: [],
		},
		dir,
	);
	createRun(mission, dir);
	mkdirSync(join(dir, "Doc"), { recursive: true });
	writeFileSync(join(dir, "Doc", `RTM_${projectName}.md`), "# stub RTM\n", "utf8");
}

// Gate checks

test("handleFeasibility refuses when no active run exists", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "X", framework: { language: "TypeScript" }, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /no active run/i.test(n.msg)));
		assert.equal(pi.sent.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility refuses when projectName is missing", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /project name/i.test(n.msg)));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility refuses when no RTM exists", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", framework: { language: "TypeScript" }, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /cannot read RTM/i.test(n.msg)));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// Two-phase flow

test("handleFeasibility calls pi.sendUserMessage with the assembled prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /<pi-velpari stage="analyzing-feasibility">/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility embeds all 4 feasibility scout paths", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		for (const s of ["feasibility-tech", "feasibility-schedule", "feasibility-cost", "feasibility-risk"]) {
			assert.match(prompt, new RegExp(`${s}-report\\.json`));
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility embeds input (RTM_<project>.md) + output (feasibility-study_<project>.md)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "TestApp");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /RTM_TestApp\.md/);
		assert.match(prompt, /feasibility-study_TestApp\.md/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility does NOT write the working copy (LLM's job)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		const state = loadState(dir);
		const wc = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "feasibility", "feasibility-study_TestApp.md");
		assert.equal(existsSync(wc), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility does NOT mutate state.stage", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const before = loadState(dir);
		await handleFeasibility(ctx, pi as never, dir);
		const after = loadState(dir);
		assert.equal(after.currentStage, before.currentStage);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility bootstraps feasibility agent files on first use", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		const agentsDir = join(dir, ".pi", "agents");
		for (const id of ["feasibility-tech", "feasibility-schedule", "feasibility-cost", "feasibility-risk"]) {
			assert.ok(existsSync(join(agentsDir, `${id}.md`)), `${id}.md should be bootstrapped`);
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("handleFeasibility preserves unicode mission verbatim in prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "café 🚀 naïve");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.ok(prompt.includes("café") && prompt.includes("🚀"), "unicode mission preserved in prompt");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility handles very long mission (>2KB) without error", async () => {
	const dir = tempDir();
	try {
		const longMission = "M".repeat(2000);
		setupValidRun(dir, "X", longMission);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		const prompt = pi.sent[0]!.prompt;
		assert.ok(prompt.includes(longMission), "long mission preserved verbatim in prompt");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility works when framework is undefined (omits Framework line)", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{
				version: 3,
				projectName: "X",
				framework: {},
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		createRun("Mission", dir);
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "RTM_X.md"), "# stub\n", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.doesNotMatch(prompt, /Framework:/, "framework line should be omitted when undefined");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility refuses to write outside the run dir when mission has path-traversal characters", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "../../../etc/passwd");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		const state = loadState(dir);
		const wc = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "feasibility", "feasibility-study_X.md");
		assert.equal(existsSync(wc), false, "working copy should NOT be created at dangerous path");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility does not crash when the feasibility output dir already exists with stale content", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const state = loadState(dir);
		const feasDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "feasibility");
		mkdirSync(feasDir, { recursive: true });
		writeFileSync(join(feasDir, "stale-file.txt"), "stale content", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		assert.ok(existsSync(join(feasDir, "stale-file.txt")));
		assert.ok(existsSync(join(feasDir, "scouts")));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleFeasibility sets the correct stage field in the prompt (analyzing-feasibility)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleFeasibility(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /<pi-velpari stage="analyzing-feasibility">/);
		assert.doesNotMatch(prompt, /stage="discussing"/);
		assert.doesNotMatch(prompt, /stage="building-rtm"/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});