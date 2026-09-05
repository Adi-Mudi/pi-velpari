import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleDiscuss } from "../src/stages/discuss.js";
import { clearRun, loadState } from "../src/core/state.js";

/**
 * Smoke test for the v2.0 discussion flow.
 *
 * The real production flow is:
 * 1. Handler runs 6-question interview via ctx.ui.input + web-search confirm.
 * 2. Handler calls pi.sendUserMessage(prompt).
 * 3. Parent LLM (driven by skills/velpari-discuss.md) spawns 4 subagents via
 *    the subagent() tool from pi-interactive-subagents.
 * 4. Each subagent writes its JSON report to the assigned path.
 * 5. Parent LLM reads the 4 reports, merges them, writes discussion-notes.md.
 * 6. Parent LLM shows preview gate; on yes, tells user to run /velpari-approve-discuss.
 *
 * This smoke test stands in for steps 3-6: after the handler hands off via
 * pi.sendUserMessage, we (as the simulated parent) write the 4 JSON reports
 * and the discussion-notes.md working copy, then verify file IO contract.
 *
 * This is NOT a substitute for end-to-end testing in a real pi session; it
 * only verifies that the path construction in handleDiscuss + the file format
 * of the reports work correctly.
 */

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-integration-"));
}

function makeMockUI(inputAnswers: string[], confirms: boolean[]) {
	return {
		inputResults: [...inputAnswers],
		confirmResults: [...confirms],
		inputCalls: 0,
		confirmCalls: 0,
		notifies: [] as Array<{ msg: string; level: string }>,
		async input(_p: string) {
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

interface ScoutReport {
	proposals: Array<{ id: string; source: string; payload: unknown }>;
	source: string;
	timestamp: string;
}

function writeScoutReports(discussDir: string, scoutsDir: string, mission: string): void {
	const reports: Record<string, ScoutReport> = {
		"extractor-report.json": {
			proposals: [
				{
					id: "extractor-1",
					source: "extractor",
					payload: {
						rawText: `Build a ${mission} app`,
						classification: "new-requirement",
						suggestedFrId: undefined,
					},
				},
			],
			source: "extractor",
			timestamp: new Date().toISOString(),
		},
		"prd-checker-report.json": {
			proposals: [],
			source: "prd-checker",
			timestamp: new Date().toISOString(),
		},
		"rtm-checker-report.json": {
			proposals: [],
			source: "rtm-checker",
			timestamp: new Date().toISOString(),
		},
		"web-search-report.json": {
			proposals: [],
			source: "web-search-agent",
			timestamp: new Date().toISOString(),
		},
	};
	for (const [filename, report] of Object.entries(reports)) {
		writeFileSync(join(scoutsDir, filename), JSON.stringify(report, null, 2), "utf8");
	}
}

function writeWorkingCopy(discussDir: string, mission: string): void {
	const notes = `# Discussion Notes — ${mission}

## Mission
${mission}

## Interview Answers
1. Q: ... A: ...

## Scout Proposals

### NEW EXTRACTOR
- (new-requirement) Build a ${mission} app

## Decision Summary
- new-fr: ["Build a ${mission} app"]
- update-fr: []
- helper-update: []
- new-helper: []
`;
	writeFileSync(join(discussDir, "discussion-notes.md"), notes, "utf8");
}

test("smoke: handler → simulated LLM → 4 scout reports → working copy → preview approved", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["It's a todo app", "developers", "track tasks", "none", "none", "ship it"], [true]);
		const pi = {
			sentMessages: [] as Array<{ prompt: string }>,
			sendUserMessage(prompt: string) {
				this.sentMessages.push({ prompt });
			},
		};
		const ctx = { ui, cwd: dir } as never;

		// Phase 1: handler.
		await handleDiscuss("todo-app", ctx, pi as never, dir);

		// Verify handler set up paths correctly.
		const state = loadState(dir);
		const runDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId);
		const discussDir = join(runDir, "discuss");
		const scoutsDir = join(runDir, "scouts");
		assert.ok(existsSync(discussDir), "discuss dir must exist");
		assert.ok(existsSync(scoutsDir), "scouts dir must exist");
		assert.equal(pi.sentMessages.length, 1, "handler must call sendUserMessage once");
		assert.match(pi.sentMessages[0]!.prompt, /Mission: todo-app/);

		// Phase 2: simulated LLM writes 4 scout reports.
		writeScoutReports(discussDir, scoutsDir, "todo-app");
		assert.ok(existsSync(join(scoutsDir, "extractor-report.json")));
		assert.ok(existsSync(join(scoutsDir, "prd-checker-report.json")));
		assert.ok(existsSync(join(scoutsDir, "rtm-checker-report.json")));
		assert.ok(existsSync(join(scoutsDir, "web-search-report.json")));

		// Verify the extractor report contains the expected payload shape.
		const extractorReport = JSON.parse(readFileSync(join(scoutsDir, "extractor-report.json"), "utf8")) as ScoutReport;
		assert.equal(extractorReport.source, "extractor");
		assert.ok(Array.isArray(extractorReport.proposals));
		assert.equal((extractorReport.proposals[0]!.payload as { rawText: string }).rawText, "Build a todo-app app");

		// Phase 3: simulated LLM writes the working copy.
		writeWorkingCopy(discussDir, "todo-app");
		assert.ok(existsSync(join(discussDir, "discussion-notes.md")));
		const notes = readFileSync(join(discussDir, "discussion-notes.md"), "utf8");
		assert.match(notes, /Discussion Notes — todo-app/);
		assert.match(notes, /new-fr: \["Build a todo-app app"\]/);

		// Phase 4: state.stage must still be 'discussing' (preview gate is the LLM's job, not handler's).
		const afterState = loadState(dir);
		assert.equal(afterState.currentStage, "discussing", "handler must NOT advance state.stage");
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("smoke: handler works even when parent LLM produces no scout reports (degenerate)", async () => {
	const dir = tempDir();
	try {
		const ui = makeMockUI(["a", "b", "c", "d", "e", "f"], [false]);
		const pi = {
			sentMessages: [] as Array<{ prompt: string }>,
			sendUserMessage(prompt: string) {
				this.sentMessages.push({ prompt });
			},
		};
		const ctx = { ui, cwd: dir } as never;

		await handleDiscuss("M", ctx, pi as never, dir);

		// In a degenerate flow where the LLM produces no scout reports and writes nothing,
		// the handler's setup should still leave the directories in place.
		const state = loadState(dir);
		const discussDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "discuss");
		const scoutsDir = join(dir, ".IDE_Plans", "velpari", "runs", state.runId, "scouts");
		assert.ok(existsSync(discussDir));
		assert.ok(existsSync(scoutsDir));
		// No discussion-notes.md was written — the LLM is responsible, not the handler.
		assert.equal(existsSync(join(discussDir, "discussion-notes.md")), false);
	} finally {
		clearRun(dir);
		rmSync(dir, { recursive: true, force: true });
	}
});