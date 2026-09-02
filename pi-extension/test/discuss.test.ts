import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleDiscuss } from "../src/discuss.js";
import { createRun, clearRun, loadState } from "../src/state.js";

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

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-discuss-"));
}

test("handleDiscuss runs the interview loop", async () => {
	const dir = tempDir();
	try {
		createRun("Test Mission", dir);
		const ui = makeMockUI(
			["It's a todo app", "developers", "tracking tasks", "no anti-goals", "none", "ship it"],
			[false], // no web search
		);
		const ctx = { ui } as never;
		await handleDiscuss("Test Mission", ctx, dir);
		assert.equal(ui.inputCalls, 6, "expected 6 interview questions");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss stops on empty answer", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const ui = makeMockUI(["a", "", "c"], [false]);
		const ctx = { ui } as never;
		await handleDiscuss("Mission", ctx, dir);
		// Empty answer at index 1 causes early termination.
		assert.equal(ui.inputCalls, 2, "expected early break on empty answer");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss prompts for web search", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const ui = makeMockUI(
			["a", "b", "c", "d", "e", "f"],
			[true], // yes web search
		);
		const ctx = { ui } as never;
		await handleDiscuss("Mission", ctx, dir);
		assert.equal(ui.confirmCalls >= 1, true, "expected at least one confirm prompt");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss writes a working copy to the run directory", async () => {
	const dir = tempDir();
	try {
		createRun("Mission", dir);
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false, true]);
		const ctx = { ui } as never;
		await handleDiscuss("Mission", ctx, dir);
		const state = loadState(dir);
		const workingPath = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "discuss", "discussion-notes.md");
		assert.ok(existsSync(workingPath), "working copy not created");
		const content = readFileSync(workingPath, "utf8");
		assert.match(content, /Mission/);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleDiscuss with empty mission does not crash", async () => {
	const dir = tempDir();
	try {
		createRun("Existing Mission", dir);
		const ui = makeMockUI([], [false]);
		const ctx = { ui } as never;
		// Empty mission: handleDiscuss should not crash, may or may not produce output.
		// The test verifies it returns without throwing.
		await handleDiscuss("", ctx, dir);
		assert.ok(true, "handleDiscuss returned without throwing on empty mission");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});
