/**
 * velpari_brainstorm_session tool (Phase 1).
 *
 * Drives each action against a mock ExtensionAPI (senai test pattern:
 * capture the ToolDefinition from registerTool, invoke execute directly).
 * Asserts:
 *   - gating: every action errors when no brainstorm is active
 *   - confirm-understanding / set-scans / upsert-question mutate state.json
 *     and return a snapshot containing the session fields
 *   - pi.appendEntry is called with "velpari-brainstorm" on every success
 *   - upsert-question enforces reason for not-wanted / replaced
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBrainstormSessionTool } from "../../src/stages/brainstorm-state-tool.js";
import { createRun, loadState } from "../../src/core/state.js";

interface ToolDef {
	name: string;
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal: undefined,
		onUpdate: undefined,
		ctx: { cwd: string },
	) => Promise<{ content: Array<{ text: string }>; details: unknown; isError?: boolean }>;
}

let tmpDir: string;
let tool: ToolDef;
let entries: Array<{ customType: string; data: unknown }>;

function makePi(): ExtensionAPI {
	entries = [];
	const pi = {
		registerTool: (def: ToolDef) => {
			tool = def;
		},
		appendEntry: (customType: string, data: unknown) => {
			entries.push({ customType, data });
		},
	};
	return pi as unknown as ExtensionAPI;
}

function exec(params: Record<string, unknown>) {
	return tool.execute("tc-1", params, undefined, undefined, { cwd: tmpDir });
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-brainstorm-tool-"));
	registerBrainstormSessionTool(makePi());
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("velpari_brainstorm_session — request-scan-gate (v2.1)", () => {
	it("errors when no brainstorm is active", async () => {
		const res = await exec({ action: "request-scan-gate" });
		assert.equal(res.isError, true);
		assert.match(res.content[0]!.text, /\/velpari-brainstorm/);
	});

	it("returns [] and persists empty scans when ui.select is unavailable", async () => {
		createRun("Test mission", tmpDir);
		const res = await exec({ action: "request-scan-gate" });
		assert.equal(res.isError, undefined);
		assert.deepEqual((res.details as Record<string, unknown>).scansSelected, []);
		assert.deepEqual(loadState(tmpDir).scansSelected, []);
		assert.equal(entries.length, 1);
		assert.equal(entries[0]!.customType, "velpari-brainstorm");
	});
});

describe("velpari_brainstorm_session tool", () => {
	it("registers under the velpari_brainstorm_session name", () => {
		assert.equal(tool.name, "velpari_brainstorm_session");
	});

	it("errors when no brainstorm is active", async () => {
		const res = await exec({ action: "confirm-understanding" });
		assert.equal(res.isError, true);
		assert.match(res.content[0]!.text, /\/velpari-brainstorm/);
		assert.equal(entries.length, 0);
	});

	it("confirm-understanding releases the lock, returns a snapshot, appends an entry", async () => {
		const run = createRun("Test mission", tmpDir);
		const res = await exec({ action: "confirm-understanding" });
		assert.equal(res.isError, undefined);

		const snap = res.details as Record<string, unknown>;
		assert.equal(snap.understandingConfirmed, true);
		assert.equal(snap.runId, run.runId);
		assert.deepEqual(snap.scansSelected, []);
		assert.deepEqual(snap.questions, []);
		assert.equal(snap.brainstormDispatchCount, 0);

		// Persisted to state.json; stage machine untouched.
		const loaded = loadState(tmpDir);
		assert.equal(loaded.understandingConfirmed, true);
		assert.equal(loaded.currentStage, "brainstorming");

		// Mirrored into the session.
		assert.equal(entries.length, 1);
		assert.equal(entries[0]!.customType, "velpari-brainstorm");
		assert.deepEqual(entries[0]!.data, snap);
	});

	it("set-scans persists the selection (empty array = skipped)", async () => {
		createRun("Test mission", tmpDir);
		const res = await exec({ action: "set-scans", scans: ["code", "doc"] });
		assert.equal(res.isError, undefined);
		assert.deepEqual((res.details as Record<string, unknown>).scansSelected, ["code", "doc"]);
		assert.deepEqual(loadState(tmpDir).scansSelected, ["code", "doc"]);
		assert.equal(entries[0]!.customType, "velpari-brainstorm");

		const skipped = await exec({ action: "set-scans", scans: [] });
		assert.equal(skipped.isError, undefined);
		assert.deepEqual(loadState(tmpDir).scansSelected, []);
	});

	it("set-scans rejects a missing array and unknown scan types", async () => {
		createRun("Test mission", tmpDir);
		const missing = await exec({ action: "set-scans" });
		assert.equal(missing.isError, true);
		assert.match(missing.content[0]!.text, /scans array/);

		const invalid = await exec({ action: "set-scans", scans: ["code", "web"] });
		assert.equal(invalid.isError, true);
		assert.match(invalid.content[0]!.text, /Unknown scan type/);
		assert.equal(loadState(tmpDir).scansSelected, undefined);
		assert.equal(entries.length, 0);
	});

	it("upsert-question records state changes and returns them in the snapshot", async () => {
		createRun("Test mission", tmpDir);
		const draft = await exec({
			action: "upsert-question",
			question: { id: "Q1", text: "Scope?", state: "draft", suggestedAnswer: "MVP only" },
		});
		assert.equal(draft.isError, undefined);
		const questions = (draft.details as Record<string, unknown>).questions as Array<
			Record<string, unknown>
		>;
		assert.equal(questions.length, 1);
		assert.equal(questions[0]!.state, "draft");

		const agreed = await exec({
			action: "upsert-question",
			question: { id: "Q1", text: "Scope?", state: "agreed" },
		});
		assert.equal(agreed.isError, undefined);
		assert.equal(loadState(tmpDir).brainstormQuestions?.[0]?.state, "agreed");
		assert.equal(entries.length, 2);
	});

	it("upsert-question enforces reason for not-wanted and replaced", async () => {
		createRun("Test mission", tmpDir);
		const noReason = await exec({
			action: "upsert-question",
			question: { id: "Q1", text: "x", state: "not-wanted" },
		});
		assert.equal(noReason.isError, true);
		assert.match(noReason.content[0]!.text, /requires a reason/);
		assert.equal(loadState(tmpDir).brainstormQuestions, undefined);
		assert.equal(entries.length, 0);

		const withReason = await exec({
			action: "upsert-question",
			question: { id: "Q1", text: "x", state: "replaced", reason: "Superseded by Q2" },
		});
		assert.equal(withReason.isError, undefined);
		assert.equal(loadState(tmpDir).brainstormQuestions?.[0]?.reason, "Superseded by Q2");
	});

	it("upsert-question rejects invalid states and missing fields", async () => {
		createRun("Test mission", tmpDir);
		const bogus = await exec({
			action: "upsert-question",
			question: { id: "Q1", text: "x", state: "bogus" },
		});
		assert.equal(bogus.isError, true);
		assert.match(bogus.content[0]!.text, /Unknown question state/);

		const missing = await exec({ action: "upsert-question" });
		assert.equal(missing.isError, true);
		assert.match(missing.content[0]!.text, /needs question/);
	});
});
