import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleDevelopmentOrder } from "../src/stages/development-order.js";
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
	return mkdtempSync(join(tmpdir(), "velpari-dev-order-"));
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
	writeFileSync(join(dir, "Doc", `design_${projectName}.md`), "# stub design\n", "utf8");
	writeFileSync(join(dir, "Doc", `RTM_${projectName}.md`), "# stub RTM\n", "utf8");
	writeFileSync(join(dir, "Doc", `feasibility-study_${projectName}.md`), "# stub feasibility\n", "utf8");
	writeFileSync(join(dir, "Doc", `PRD_${projectName}.md`), "# stub PRD\n", "utf8");
	writeFileSync(join(dir, "Doc", `test-plan_${projectName}.md`), "# stub test plan\n", "utf8");
}

// Gate checks

test("handleDevelopmentOrder refuses when no active run exists", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "X", framework: { language: "TypeScript" }, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /no active run/i.test(n.msg)));
		assert.equal(pi.sent.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder refuses when projectName is missing", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /project name/i.test(n.msg)));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder refuses when one of the 5 published artifacts is missing", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "TestApp", framework: { language: "TypeScript" }, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		mkdirSync(join(dir, "Doc"), { recursive: true });
		// Only write 4 of the 5 artifacts.
		writeFileSync(join(dir, "Doc", "design_TestApp.md"), "# stub\n", "utf8");
		writeFileSync(join(dir, "Doc", "RTM_TestApp.md"), "# stub\n", "utf8");
		writeFileSync(join(dir, "Doc", "feasibility-study_TestApp.md"), "# stub\n", "utf8");
		writeFileSync(join(dir, "Doc", "PRD_TestApp.md"), "# stub\n", "utf8");
		// Missing: test-plan_TestApp.md
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /missing test-plan/i.test(n.msg)));
		assert.equal(pi.sent.length, 0);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// Two-phase flow

test("handleDevelopmentOrder calls pi.sendUserMessage with the assembled prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder embeds all 4 do scout paths", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		for (const s of ["do-topology", "do-risk", "do-test", "do-value"]) {
			assert.match(prompt, new RegExp(`${s}-report\\.json`));
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder concatenates all 5 published artifacts into the prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "TestApp");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /stub design/);
		assert.match(prompt, /stub RTM/);
		assert.match(prompt, /stub feasibility/);
		assert.match(prompt, /stub PRD/);
		assert.match(prompt, /stub test plan/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder does NOT write the working copy (LLM's job)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		const state = loadState(dir);
		const wc = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "development-order", "development-order_TestApp.md");
		assert.equal(existsSync(wc), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder does NOT mutate state.stage (optional stage)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const before = loadState(dir);
		await handleDevelopmentOrder(ctx, pi as never, dir);
		const after = loadState(dir);
		assert.equal(after.currentStage, before.currentStage);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder bootstraps do agent files on first use", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		const agentsDir = join(dir, ".pi", "agents");
		for (const id of ["do-topology", "do-risk", "do-test", "do-value"]) {
			assert.ok(existsSync(join(agentsDir, `${id}.md`)), `${id}.md should be bootstrapped`);
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// Edge cases

test("handleDevelopmentOrder preserves unicode mission verbatim in prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "café 🚀 naïve");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.ok(prompt.includes("café") && prompt.includes("🚀"));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder handles very long mission (>2KB) without error", async () => {
	const dir = tempDir();
	try {
		const longMission = "M".repeat(2000);
		setupValidRun(dir, "X", longMission);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		assert.ok(pi.sent[0]!.prompt.includes(longMission));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder works when framework is undefined (omits Framework line)", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "X", framework: {}, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "design_X.md"), "# stub\n", "utf8");
		writeFileSync(join(dir, "Doc", "RTM_X.md"), "# stub\n", "utf8");
		writeFileSync(join(dir, "Doc", "feasibility-study_X.md"), "# stub\n", "utf8");
		writeFileSync(join(dir, "Doc", "PRD_X.md"), "# stub\n", "utf8");
		writeFileSync(join(dir, "Doc", "test-plan_X.md"), "# stub\n", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		assert.doesNotMatch(pi.sent[0]!.prompt, /Framework:/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder refuses to write outside the run dir when mission has path-traversal characters", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "../../../etc/passwd");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		const state = loadState(dir);
		const wc = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "development-order", "development-order_X.md");
		assert.equal(existsSync(wc), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder does not crash when the development-order output dir already has stale content", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const state = loadState(dir);
		const devOrderDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "development-order");
		mkdirSync(devOrderDir, { recursive: true });
		writeFileSync(join(devOrderDir, "stale.txt"), "stale", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		assert.ok(existsSync(join(devOrderDir, "stale.txt")));
		assert.ok(existsSync(join(devOrderDir, "scouts")));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDevelopmentOrder output working-copy path uses development-order_<project>.md", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "TestApp");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDevelopmentOrder(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /development-order_TestApp\.md/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});