import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTestplan } from "../src/testplan.js";
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
	return mkdtempSync(join(tmpdir(), "velpari-testplan-"));
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
	writeFileSync(join(dir, "Doc", `pseudocode_${projectName}.md`), "# stub pseudocode\n", "utf8");
}

// Gate checks

test("handleTestplan refuses when no active run exists", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "X", framework: { language: "TypeScript" }, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /no active run/i.test(n.msg)));
		assert.equal(pi.sent.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan refuses when projectName is missing", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /project name/i.test(n.msg)));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan refuses when no pseudocode exists", async () => {
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
		await handleTestplan(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /cannot read pseudocode/i.test(n.msg)));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// Two-phase flow

test("handleTestplan calls pi.sendUserMessage with the assembled prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /<pi-velpari stage="planning-tests">/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan embeds all 4 testplan scout paths", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		for (const s of ["testplan-strategy-designer", "testplan-unit-test-generator", "testplan-integration-test-generator", "testplan-coverage-tracer"]) {
			assert.match(prompt, new RegExp(`${s}-report\\.json`));
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan embeds BOTH working-copy paths in the prompt (test-plan + test-cases)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "TestApp");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /test-plan_TestApp\.md/);
		assert.match(prompt, /test-cases_TestApp\.md/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan does NOT write either working copy (LLM's job)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		const state = loadState(dir);
		// Phase 7: working-copy category renamed from "testplan" to "tests".
		const tpDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "tests");
		assert.equal(existsSync(join(tpDir, "test-plan_TestApp.md")), false);
		assert.equal(existsSync(join(tpDir, "test-cases_TestApp.md")), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan does NOT mutate state.stage", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const before = loadState(dir);
		await handleTestplan(ctx, pi as never, dir);
		const after = loadState(dir);
		assert.equal(after.currentStage, before.currentStage);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan bootstraps testplan agent files on first use", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		const agentsDir = join(dir, ".pi", "agents");
		for (const id of ["testplan-strategy-designer", "testplan-unit-test-generator", "testplan-integration-test-generator", "testplan-coverage-tracer"]) {
			assert.ok(existsSync(join(agentsDir, `${id}.md`)), `${id}.md should be bootstrapped`);
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// Edge cases

test("handleTestplan preserves unicode mission verbatim in prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "café 🚀 naïve");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.ok(prompt.includes("café") && prompt.includes("🚀"));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan handles very long mission (>2KB) without error", async () => {
	const dir = tempDir();
	try {
		const longMission = "M".repeat(2000);
		setupValidRun(dir, "X", longMission);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		assert.ok(pi.sent[0]!.prompt.includes(longMission));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan works when framework is undefined (omits Framework line)", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "X", framework: {}, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "pseudocode_X.md"), "# stub\n", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		assert.doesNotMatch(pi.sent[0]!.prompt, /Framework:/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan refuses to write outside the run dir when mission has path-traversal characters", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "../../../etc/passwd");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		const state = loadState(dir);
		const tpDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "testplan");
		assert.equal(existsSync(join(tpDir, "test-plan_X.md")), false);
		assert.equal(existsSync(join(tpDir, "test-cases_X.md")), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan does not crash when the testplan output dir already has stale content", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const state = loadState(dir);
		// Phase 7: working-copy category renamed from "testplan" to "tests".
		const tpDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "tests");
		mkdirSync(tpDir, { recursive: true });
		writeFileSync(join(tpDir, "stale.txt"), "stale", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		assert.ok(existsSync(join(tpDir, "stale.txt")));
		assert.ok(existsSync(join(tpDir, "scouts")));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleTestplan sets the correct stage field in the prompt (planning-tests)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleTestplan(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /<pi-velpari stage="planning-tests">/);
		assert.doesNotMatch(prompt, /stage="designing"/);
		assert.doesNotMatch(prompt, /stage="writing-pseudocode"/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});