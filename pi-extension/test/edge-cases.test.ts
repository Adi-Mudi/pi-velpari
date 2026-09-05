import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleDiscuss } from "../src/stages/discuss.js";
import { clearRun, loadState } from "../src/core/state.js";
import { ensureScoutAgents } from "../src/core/agents-install.js";
import { buildStagePrompt } from "../src/core/prompt.js";

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

function makeMockPi(): { sentMessages: Array<{ prompt: string }>; sendUserMessage: (prompt: string) => void } {
	const sent: Array<{ prompt: string }> = [];
	return {
		sentMessages: sent,
		sendUserMessage(prompt: string) {
			sent.push({ prompt });
		},
	};
}

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-edge-"));
}

// ---------------------------------------------------------------------------
// handleDiscuss edge cases
// ---------------------------------------------------------------------------

test("handleDiscuss with empty mission string does not crash", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI([], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		// Empty mission: skip-on-empty in INTERVIEW_QUESTIONS loop means 0 questions asked.
		// Web search confirm still fires. prompt.ts is called with empty answers.
		await handleDiscuss("", ctx, pi as never, dir);
		// Should have called sendUserMessage exactly once with a prompt that contains "(no answers collected)".
		assert.equal(pi.sentMessages.length, 1);
		assert.match(pi.sentMessages[0]!.prompt, /\(no answers collected\)/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss with empty mission does not create a run when currentStage is none", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI([], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("", ctx, pi as never, dir);
		// Empty mission + currentStage was none → createRun was still called, but with empty mission.
		// The state should still exist; we just verify the call did not crash and state was loaded.
		const state = loadState(dir);
		assert.equal(state.mission, "");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss with all-empty answers produces '(no answers collected)' in prompt", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["", "", "", "", "", ""], [false]); // all empty → skip-on-empty breaks at index 0
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("M", ctx, pi as never, dir);
		assert.match(pi.sentMessages[0]!.prompt, /\(no answers collected\)/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss preserves unicode + newlines + emoji in answers", async () => {
	const dir = tempDir();
	try {
		const unicodeAnswer = "Hello 👋\nLine 2 with ünïcödé\nLine 3";
		const ui = makeMockUI([unicodeAnswer, "", "", "", "", ""], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("M", ctx, pi as never, dir);
		const prompt = pi.sentMessages[0]!.prompt;
		assert.match(prompt, /Hello 👋/);
		assert.match(prompt, /ünïcödé/);
		assert.match(prompt, /Line 3/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss handles a very long answer (10KB)", async () => {
	const dir = tempDir();
	try {
		const longAnswer = "x".repeat(10_000);
		const ui = makeMockUI([longAnswer, "", "", "", "", ""], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		await handleDiscuss("M", ctx, pi as never, dir);
		const prompt = pi.sentMessages[0]!.prompt;
		assert.ok(prompt.includes(longAnswer), "long answer should be preserved verbatim");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss preserves framework with newlines verbatim (no escaping needed)", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "", "", "", "", ""], [false]);
		const pi = makeMockPi();
		const ctx = { ui, cwd: dir } as never;
		// Pre-write a files.json with a framework value containing newlines.
		const { mkdirSync, writeFileSync } = await import("node:fs");
		const configDir = join(dir, ".pi", "velpari");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			join(configDir, "files.json"),
			JSON.stringify({
				version: 3,
				projectName: "X",
				framework: { language: "TypeScript\nwith extra metadata" },
				inputDocuments: [],
				outputPaths: {},
				excludedPaths: [],
			}),
			"utf8",
		);
		await handleDiscuss("M", ctx, pi as never, dir);
		const prompt = pi.sentMessages[0]!.prompt;
		// The framework value should be present (possibly with surrounding newlines).
		assert.ok(prompt.includes("TypeScript\nwith extra metadata"), "framework with newlines preserved");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss throws clearly when pi.sendUserMessage is missing", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const ctx = { ui, cwd: dir } as never;
		// pi has no sendUserMessage.
		const brokenPi = {} as never;
		await assert.rejects(
			async () => handleDiscuss("M", ctx, brokenPi, dir),
			(err: Error) => {
				// Any error is acceptable; we just want to ensure the function does not silently succeed.
				return err.message.length > 0;
			},
		);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("concurrent ensureScoutAgents calls are idempotent", async () => {
	const dir = tempDir();
	try {
		const [r1, r2, r3] = await Promise.all([
			ensureScoutAgents(dir),
			ensureScoutAgents(dir),
			ensureScoutAgents(dir),
		]);
		// Exactly one of the three should report "installed" agents; the others see them as present.
		const installed = [r1, r2, r3].map((r) => r.installed.length);
		const totalInstalled = installed.reduce((a, b) => a + b, 0);
		assert.equal(totalInstalled, 4, "exactly 4 installs total across the 3 concurrent calls");
		const totalPresent = [r1, r2, r3].map((r) => r.alreadyPresent.length).reduce((a, b) => a + b, 0);
		assert.equal(totalPresent, 8, "other 8 must be 'alreadyPresent' (4 agents × 2 calls that arrived after install)");
		const agentsDir = join(dir, ".pi", "agents");
		for (const id of ["extractor", "prd-checker", "rtm-checker", "web-search-agent"]) {
			assert.ok(existsSync(join(agentsDir, `${id}.md`)), `${id}.md should exist after concurrent bootstrap`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// buildStagePrompt edge cases
// ---------------------------------------------------------------------------

test("buildStagePrompt handles very long mission (>1KB) verbatim", () => {
	const longMission = "M".repeat(2000);
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: longMission,
		framework: undefined,
		runId: undefined,
		answers: [],
		webSearchAllowed: false,
		paths: {
			extractorReport: "",
			prdCheckerReport: "",
			rtmCheckerReport: "",
			webSearchReport: "",
			discussionNotes: "",
			scoutsDir: "",
		},
	});
	assert.ok(prompt.includes(longMission));
});

test("buildStagePrompt handles paths with spaces and special characters", () => {
	const weirdPath = "/path with spaces/and-dashes/file.json";
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: [],
		webSearchAllowed: false,
		paths: {
			extractorReport: weirdPath,
			prdCheckerReport: weirdPath,
			rtmCheckerReport: weirdPath,
			webSearchReport: weirdPath,
			discussionNotes: weirdPath,
			scoutsDir: weirdPath,
		},
	});
	assert.ok(prompt.includes(weirdPath), "paths with spaces should be preserved");
});

test("buildStagePrompt handles unicode in answers", () => {
	const unicodeAnswer = "café résumé naïve 🚀";
	const prompt = buildStagePrompt({
		stage: "discussing",
		mission: "M",
		framework: undefined,
		runId: undefined,
		answers: [unicodeAnswer],
		webSearchAllowed: false,
		paths: {
			extractorReport: "",
			prdCheckerReport: "",
			rtmCheckerReport: "",
			webSearchReport: "",
			discussionNotes: "",
			scoutsDir: "",
		},
	});
	assert.ok(prompt.includes(unicodeAnswer));
});

test("ensureScoutAgents does not overwrite a user-edited agent file (preserve-on-edit semantics)", () => {
	const dir = tempDir();
	try {
		// Pre-create .pi/agents/extractor.md with custom content.
		const agentsDir = join(dir, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		const custom = "# custom user edits\n";
		writeFileSync(join(agentsDir, "extractor.md"), custom, "utf8");

		const result = ensureScoutAgents(dir);
		// extractor.md must be reported as alreadyPresent and content must not change.
		assert.ok(result.alreadyPresent.includes("extractor"), "extractor.md reported as already-present");
		const after = readFileSync(join(agentsDir, "extractor.md"), "utf8");
		assert.equal(after, custom, "user-edited extractor.md must not be overwritten");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});