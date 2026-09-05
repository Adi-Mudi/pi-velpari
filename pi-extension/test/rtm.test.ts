import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRtm } from "../src/stages/rtm.js";
import { saveFilesConfig } from "../src/core/config.js";
import { createRun, clearRun, loadState } from "../src/core/state.js";

interface MockUI {
	notifies: Array<{ msg: string; level: string }>;
	notify: (msg: string, level: string) => void;
}
interface MockPi {
	sent: Array<{ prompt: string }>;
	sendUserMessage: (p: string) => void;
}

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-rtm-"));
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
	writeFileSync(join(dir, "Doc", `PRD_${projectName}.md`), "# stub PRD\n", "utf8");
}

// ---------------------------------------------------------------------------
// Gate checks
// ---------------------------------------------------------------------------

test("handleRtm refuses when no active run exists", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "X", framework: { language: "TypeScript" }, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /no active run/i.test(n.msg)));
		assert.equal(pi.sent.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm refuses when projectName is missing", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /project name/i.test(n.msg)));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm refuses when no PRD exists", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", framework: { language: "TypeScript" }, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		// No Doc/ directory
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /cannot read PSRS/i.test(n.msg)));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Two-phase flow
// ---------------------------------------------------------------------------

test("handleRtm calls pi.sendUserMessage with the assembled prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /Mission: Mission/);
		assert.match(prompt, /<pi-velpari stage="building-rtm">/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm embeds all 4 rtm scout report paths in the prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		for (const s of ["rtm-requirement-tracer", "rtm-test-case-linker", "rtm-coverage-analyzer", "rtm-consolidator"]) {
			assert.match(prompt, new RegExp(`${s}-report\\.json`));
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm embeds input artifact path (PRD_<project>.md) + working-copy path (RTM_<project>.md)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "TestApp");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /PRD_TestApp\.md/);
		assert.match(prompt, /RTM_TestApp\.md/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm does NOT write the working copy (LLM's job)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		const state = loadState(dir);
		const workingCopy = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "rtm", "RTM_TestApp.md");
		assert.equal(existsSync(workingCopy), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm does NOT mutate state.stage", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const before = loadState(dir);
		await handleRtm(ctx, pi as never, dir);
		const after = loadState(dir);
		assert.equal(after.currentStage, before.currentStage);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm creates the scouts directory before handing off", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		const state = loadState(dir);
		const scoutsDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "rtm", "scouts");
		assert.ok(existsSync(scoutsDir));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm bootstraps rtm scout agent files on first use", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		const agentsDir = join(dir, ".pi", "agents");
		for (const id of ["rtm-requirement-tracer", "rtm-test-case-linker", "rtm-coverage-analyzer", "rtm-consolidator"]) {
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

test("handleRtm preserves unicode mission verbatim in prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "café 🚀 naïve");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.ok(prompt.includes("café") && prompt.includes("🚀"), "unicode mission preserved in prompt");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm handles very long mission (>2KB) without error", async () => {
	const dir = tempDir();
	try {
		const longMission = "M".repeat(2000);
		setupValidRun(dir, "X", longMission);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		const prompt = pi.sent[0]!.prompt;
		assert.ok(prompt.includes(longMission), "long mission preserved verbatim in prompt");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm works when framework is undefined (omits Framework line)", async () => {
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
		writeFileSync(join(dir, "Doc", "PRD_X.md"), "# stub\n", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.doesNotMatch(prompt, /Framework:/, "framework line should be omitted when undefined");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm refuses to write outside the run dir when mission has path-traversal characters", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "../../../etc/passwd");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		// Working copy must be inside the run dir under .IDE_Plans/velpari/runs/<id>/rtm/
		// NOT at /etc/passwd or anywhere else.
		const state = loadState(dir);
		const wc = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "rtm", "RTM_X.md");
		assert.equal(existsSync(wc), false, "working copy should NOT be created at dangerous path");
		// And no file should be created at /etc/passwd
		assert.equal(existsSync("/etc/passwd-rt"), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm does not crash when the rtm output dir already exists with stale content", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		// Pre-create the rtm output dir with a stale file
		const state = loadState(dir);
		const rtmDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "rtm");
		mkdirSync(rtmDir, { recursive: true });
		writeFileSync(join(rtmDir, "stale-file.txt"), "stale content", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		// Should not throw
		await handleRtm(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		// Stale file should still be there (handler doesn't delete it)
		assert.ok(existsSync(join(rtmDir, "stale-file.txt")));
		// But the new scouts dir should also be created
		assert.ok(existsSync(join(rtmDir, "scouts")));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleRtm sets the correct stage field in the prompt (building-rtm)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleRtm(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /<pi-velpari stage="building-rtm">/);
		// Must NOT use discuss or prd stage
		assert.doesNotMatch(prompt, /stage="discussing"/);
		assert.doesNotMatch(prompt, /stage="drafting-prd"/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});