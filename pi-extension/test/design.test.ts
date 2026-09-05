import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleDesign } from "../src/design.js";
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
	return mkdtempSync(join(tmpdir(), "velpari-design-"));
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
	writeFileSync(join(dir, "Doc", `feasibility-study_${projectName}.md`), "# stub feasibility\n", "utf8");
}

// Gate checks

test("handleDesign refuses when no active run exists", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "X", framework: { language: "TypeScript" }, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /no active run/i.test(n.msg)));
		assert.equal(pi.sent.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign refuses when projectName is missing", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /project name/i.test(n.msg)));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign refuses when no feasibility study exists", async () => {
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
		await handleDesign(ctx, pi as never, dir);
		assert.ok(ui.notifies.some((n) => n.level === "error" && /cannot read feasibility-study/i.test(n.msg)));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// Two-phase flow

test("handleDesign calls pi.sendUserMessage with the assembled prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /<pi-velpari stage="designing">/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign embeds all 4 design scout paths", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		for (const s of ["design-module-decomposer", "design-contract-definer", "design-data-flow-mapper", "design-error-definer"]) {
			assert.match(prompt, new RegExp(`${s}-report\\.json`));
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign embeds input (feasibility-study_<project>.md) + output (design_<project>.md)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "TestApp");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /feasibility-study_TestApp\.md/);
		assert.match(prompt, /design_TestApp\.md/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign does NOT write the working copy (LLM's job)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		const state = loadState(dir);
		const wc = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "design", "design_TestApp.md");
		assert.equal(existsSync(wc), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign does NOT mutate state.stage", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const before = loadState(dir);
		await handleDesign(ctx, pi as never, dir);
		const after = loadState(dir);
		assert.equal(after.currentStage, before.currentStage);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign bootstraps design agent files on first use", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		const agentsDir = join(dir, ".pi", "agents");
		for (const id of ["design-module-decomposer", "design-contract-definer", "design-data-flow-mapper", "design-error-definer"]) {
			assert.ok(existsSync(join(agentsDir, `${id}.md`)), `${id}.md should be bootstrapped`);
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// Edge cases

test("handleDesign preserves unicode mission verbatim in prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "café 🚀 naïve");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.ok(prompt.includes("café") && prompt.includes("🚀"));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign handles very long mission (>2KB) without error", async () => {
	const dir = tempDir();
	try {
		const longMission = "M".repeat(2000);
		setupValidRun(dir, "X", longMission);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		assert.ok(pi.sent[0]!.prompt.includes(longMission));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign works when framework is undefined (omits Framework line)", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{ version: 3, projectName: "X", framework: {}, inputDocuments: [], outputPaths: {}, excludedPaths: [] },
			dir,
		);
		createRun("Mission", dir);
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "feasibility-study_X.md"), "# stub\n", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		assert.doesNotMatch(pi.sent[0]!.prompt, /Framework:/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign refuses to write outside the run dir when mission has path-traversal characters", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "../../../etc/passwd");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		const state = loadState(dir);
		const wc = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "design", "design_X.md");
		assert.equal(existsSync(wc), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign does not crash when the design output dir already has stale content", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const state = loadState(dir);
		const designDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "design");
		mkdirSync(designDir, { recursive: true });
		writeFileSync(join(designDir, "stale.txt"), "stale", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1);
		assert.ok(existsSync(join(designDir, "stale.txt")));
		assert.ok(existsSync(join(designDir, "scouts")));
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDesign sets the correct stage field in the prompt (designing)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDesign(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /<pi-velpari stage="designing">/);
		assert.doesNotMatch(prompt, /stage="discussing"/);
		assert.doesNotMatch(prompt, /stage="analyzing-feasibility"/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});