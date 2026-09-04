import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePrd } from "../src/prd.js";
import { saveFilesConfig } from "../src/config.js";
import { createRun, clearRun } from "../src/state.js";

interface MockUI {
	notifies: Array<{ msg: string; level: string }>;
	notify: (msg: string, level: string) => void;
}

interface MockPi {
	sent: Array<{ prompt: string }>;
	sendUserMessage: (p: string) => void;
}

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-prd-"));
}

function makeMockUI(): MockUI {
	const notifies: Array<{ msg: string; level: string }> = [];
	return {
		notifies,
		notify(msg, level) {
			notifies.push({ msg, level });
		},
	};
}

function makeMockPi(): MockPi {
	const sent: Array<{ prompt: string }> = [];
	return {
		sent,
		sendUserMessage(p) {
			sent.push({ prompt: p });
		},
	};
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
	writeFileSync(join(dir, "Doc", `discussion-${mission.toLowerCase()}.md`), "# stub\n", "utf8");
}

// ---------------------------------------------------------------------------
// Gate checks
// ---------------------------------------------------------------------------

test("handlePrd refuses when no active run exists", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{
				version: 3,
				projectName: "X",
				framework: { language: "TypeScript" },
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		const errored = ui.notifies.find(
			(n) => n.level === "error" && /no active run/i.test(n.msg),
		);
		assert.ok(errored, "expected error when no active run");
		assert.equal(pi.sent.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd refuses when projectName is missing", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		const errored = ui.notifies.find(
			(n) => n.level === "error" && /project name/i.test(n.msg),
		);
		assert.ok(errored, "expected error when projectName is missing");
		assert.equal(pi.sent.length, 0);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd refuses when no discussion exists", async () => {
	const dir = tempDir();
	try {
		saveFilesConfig(
			{
				version: 3,
				projectName: "TestApp",
				framework: { language: "TypeScript" },
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		createRun("Mission", dir);
		// No Doc/ directory / discussion file
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		// The handler delegates to runStageWithScouts which emits an error
		// notify when the input artifact cannot be read.
		const errored = ui.notifies.find(
			(n) => n.level === "error" && /cannot read input artifact/i.test(n.msg),
		);
		assert.ok(errored, "expected error about unreadable input artifact");
		assert.equal(pi.sent.length, 0);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Two-phase flow
// ---------------------------------------------------------------------------

test("handlePrd calls pi.sendUserMessage with the assembled prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "TestApp", "todo-app");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		assert.equal(pi.sent.length, 1, "must call sendUserMessage exactly once");
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /Mission: todo-app/);
		assert.match(prompt, /<pi-velpari stage="drafting-prd">/);
		assert.match(prompt, /Framework: TypeScript/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd embeds all 4 scout report paths in the prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		for (const scout of ["fr-extractor", "nfr-checker", "helper-detector", "consolidator"]) {
			assert.match(prompt, new RegExp(`${scout}-report\\.json`), `prompt should reference ${scout}`);
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd embeds input artifact path (Doc/discussion-{slug}.md) + working-copy path (PRD_<project>.md)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "TestApp", "todo-app");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.match(prompt, /discussion-todo-app\.md/);
		assert.match(prompt, /PRD_TestApp\.md/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd does NOT write the working copy (LLM's job)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		const state = (await import("../src/state.js")).loadState(dir);
		const workingCopy = join(
			dir,
			".IDE_Plans",
			"velpari",
			"runs",
			state.runId,
			"prd",
			"PRD_TestApp.md",
		);
		assert.equal(existsSync(workingCopy), false, "handler must NOT write the PRD working copy");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd does NOT mutate state.stage (orthogonal to approval)", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		const before = (await import("../src/state.js")).loadState(dir);
		await handlePrd(ctx, pi as never, dir);
		const after = (await import("../src/state.js")).loadState(dir);
		assert.equal(after.currentStage, before.currentStage, "state.stage must not change");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd creates the scouts directory before handing off", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		const state = (await import("../src/state.js")).loadState(dir);
		const scoutsDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "prd", "scouts");
		assert.ok(existsSync(scoutsDir), "scouts dir should exist before LLM spawns subagents");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd notifies user with location + next-step hint", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		const followup = ui.notifies.find(
			(n) => /\/velpari-approve/.test(n.msg) && /drafting-prd.*started/i.test(n.msg),
		);
		assert.ok(followup, "expected notify mentioning the stage start and approve hint");
		assert.match(followup!.msg, /fr-extractor/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("handlePrd preserves unicode mission in prompt", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir, "X", "café 🚀 naïve");
		// Mission gets slugified by slugify() — write the discussion at the slugified path.
		mkdirSync(join(dir, "Doc"), { recursive: true });
		// slugify("café 🚀 naïve") ≈ "caf-na-ve" — write to the slugified name.
		const { slugify } = await import("../src/paths.js");
		const slug = slugify("café 🚀 naïve");
		writeFileSync(join(dir, "Doc", `discussion-${slug}.md`), "# stub\n", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.ok(prompt.includes("café") && prompt.includes("🚀"), "unicode mission preserved in prompt");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd works when framework is undefined", async () => {
	const dir = tempDir();
	try {
		// No framework
		saveFilesConfig(
			{
				version: 3,
				projectName: "TestApp",
				framework: {},
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			},
			dir,
		);
		createRun("Mission", dir);
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "discussion-mission.md"), "# stub\n", "utf8");
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		const prompt = pi.sent[0]!.prompt;
		assert.doesNotMatch(prompt, /Framework:/, "framework line should be omitted when undefined");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrd bootstraps scout agent files on first use", async () => {
	const dir = tempDir();
	try {
		setupValidRun(dir);
		const ui = makeMockUI();
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handlePrd(ctx, pi as never, dir);
		const agentsDir = join(dir, ".pi", "agents");
		for (const id of ["fr-extractor", "nfr-checker", "helper-detector", "consolidator"]) {
			assert.ok(existsSync(join(agentsDir, `${id}.md`)), `${id}.md should be bootstrapped`);
		}
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});