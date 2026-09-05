import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleDiscuss } from "../src/stages/discuss.js";
import { clearRun, loadState } from "../src/core/state.js";

interface MockUI {
	inputResults: string[];
	confirmResults: boolean[];
	inputCalls: number;
	confirmCalls: number;
	notifies: Array<{ msg: string; level: string }>;
	input: (prompt: string) => Promise<string | undefined>;
	confirm: (title: string, msg: string) => Promise<boolean>;
	notify: (msg: string, level: string) => void;
}

interface MockPi {
	sentMessages: Array<{ prompt: string; options?: unknown }>;
	sendUserMessage: (prompt: string, options?: unknown) => void;
}

function makeMockUI(inputAnswers: string[], confirms: boolean[]): MockUI {
	return {
		inputResults: [...inputAnswers],
		confirmResults: [...confirms],
		inputCalls: 0,
		confirmCalls: 0,
		notifies: [],
		async input(_prompt: string) {
			this.inputCalls++;
			return this.inputResults.shift();
		},
		async confirm(_t: string, _m: string) {
			this.confirmCalls++;
			return this.confirmResults.shift() ?? false;
		},
		notify(msg: string, level: string) {
			this.notifies.push({ msg, level });
		},
	};
}

function makeMockPi(): MockPi {
	const sent: Array<{ prompt: string; options?: unknown }> = [];
	return {
		sentMessages: sent,
		sendUserMessage(prompt: string, options?: unknown) {
			sent.push({ prompt, options });
		},
	};
}

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-discuss-"));
}

test("handleDiscuss runs the 6-question interview loop", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(
			["It's a todo app", "developers", "tracking tasks", "no anti-goals", "none", "ship it"],
			[false],
		);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Test Mission", ctx, pi as never, dir);
		assert.equal(ui.inputCalls, 6, "expected 6 interview questions");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss stops on empty answer (skip-on-empty)", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "", "c"], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		assert.equal(ui.inputCalls, 2, "expected early break on empty answer at index 1");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss prompts for web search consent", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(
			["a", "b", "c", "d", "e", "f"],
			[true],
		);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		assert.ok(ui.confirmCalls >= 1, "expected at least one confirm prompt");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss calls pi.sendUserMessage with assembled prompt", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(
			["answer1", "answer2", "answer3", "answer4", "answer5", "answer6"],
			[false],
		);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("MyMission", ctx, pi as never, dir);
		assert.equal(pi.sentMessages.length, 1, "expected exactly one sendUserMessage call");
		const prompt = pi.sentMessages[0]!.prompt;
		assert.match(prompt, /Mission: MyMission/);
		assert.match(prompt, /1\. answer1/);
		assert.match(prompt, /2\. answer2/);
		assert.match(prompt, /Web search: NOT ALLOWED/);
		assert.match(prompt, /<pi-velpari stage="discussing">/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss does NOT write the working copy (LLM does)", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		const state = loadState(dir);
		const workingPath = join(
			dir,
			".IDE_Plans",
			"velpari",
			"runs",
			state.runId,
			"discuss",
			"discussion-notes.md",
		);
		assert.equal(existsSync(workingPath), false, "handler must not write the working copy");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss does NOT mutate state.stage (discussion is orthogonal)", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		const state = loadState(dir);
		// createRun() advanced to "discussing"; handler must not move further.
		assert.equal(state.currentStage, "discussing");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss creates run directory with discuss and scouts subdirs", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		const state = loadState(dir);
		const discussDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "discuss");
		const scoutsDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "scouts");
		assert.ok(existsSync(discussDir), "discuss dir should exist");
		assert.ok(existsSync(scoutsDir), "scouts dir should exist");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss bootstraps scout agents on first use", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		// .pi/agents/{extractor,prd-checker,rtm-checker,web-search-agent}.md should exist.
		const agentsDir = join(dir, ".pi", "agents");
		for (const id of ["extractor", "prd-checker", "rtm-checker", "web-search-agent"]) {
			assert.ok(existsSync(join(agentsDir, `${id}.md`)), `${id}.md should be bootstrapped`);
		}
		// notify should mention the install.
		const bootstrapNotify = ui.notifies.find((n) => /Installed.*scout agent/i.test(n.msg));
		assert.ok(bootstrapNotify, "expected bootstrap notify");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss does not re-notify when agents already present", async () => {
	const dir = tempDir();
	try {
		// Pre-create all 4 agent files so bootstrap is a no-op.
		const { mkdirSync, writeFileSync } = await import("node:fs");
		const agentsDir = join(dir, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		for (const id of ["extractor", "prd-checker", "rtm-checker", "web-search-agent"]) {
			writeFileSync(join(agentsDir, `${id}.md`), "# stub\n", "utf8");
		}

		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		const bootstrapNotify = ui.notifies.find((n) => /Installed.*scout agent/i.test(n.msg));
		assert.equal(bootstrapNotify, undefined, "should not notify when agents already present");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss notifies user with location + next-step hint", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		const followup = ui.notifies.find((n) => /velpari-approve-discuss/i.test(n.msg));
		assert.ok(followup, "expected notify mentioning /velpari-approve-discuss");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss embeds web search flag in prompt when user says yes", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [true]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		const prompt = pi.sentMessages[0]!.prompt;
		assert.match(prompt, /Web search: ALLOWED/);
		assert.match(prompt, /web-search-agent/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss notify includes scout report directory path", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		const followup = ui.notifies.find((n) => /Scouts will write to/.test(n.msg));
		assert.ok(followup, "expected notify mentioning the scout write location");
		assert.match(followup!.msg, /scouts/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss preserves framework string in prompt (FR-49)", async () => {
	const dir = tempDir();
	try {
		// Pre-write files.json with a framework value.
		const { mkdirSync, writeFileSync } = await import("node:fs");
		const configDir = join(dir, ".pi", "velpari");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			join(configDir, "files.json"),
			JSON.stringify({
				version: 3,
				projectName: "X",
				framework: { language: "Rust" },
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			}),
			"utf8",
		);
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("Mission", ctx, pi as never, dir);
		const prompt = pi.sentMessages[0]!.prompt;
		assert.match(prompt, /Framework: Rust/, "framework value must be injected into prompt");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss preserves mission string verbatim in prompt", async () => {
	const dir = tempDir();
	try {
		const mission = "Build a widget for tracking";
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss(mission, ctx, pi as never, dir);
		const prompt = pi.sentMessages[0]!.prompt;
		assert.match(prompt, new RegExp(`Mission: ${mission}`), "mission must appear in prompt verbatim");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});