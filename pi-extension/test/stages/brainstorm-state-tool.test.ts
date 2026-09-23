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
import {
	appendWebDispatchConsent,
	confirmUnderstanding,
	createRun,
	loadState,
	openBrainstormSession,
	saveState,
	type RunState,
} from "../../src/core/state.js";

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
		const questions = (draft.details as Record<string, unknown>).questions as Array<Record<string, unknown>>;
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

describe("velpari_brainstorm_session — v1.x dynamic scan actions", () => {
	it("request-extra-scan errors when no brainstorm is active", async () => {
		const res = await exec({ action: "request-extra-scan" });
		assert.equal(res.isError, true);
		assert.match(res.content[0]!.text, /\/velpari-brainstorm/);
	});

	it("request-extra-scan returns empty addedScans when picker is unavailable", async () => {
		createRun("Test mission", tmpDir);
		const res = await exec({ action: "request-extra-scan" });
		assert.equal(res.isError, undefined);
		const snap = res.details as Record<string, unknown>;
		assert.deepEqual(snap.addedScans, []);
		assert.equal(snap.cancelled, true);
		assert.deepEqual(snap.scansSelected, []);
		// Cancelled early-return does NOT persist state — scansSelected
		// stays undefined on disk (state was never written).
		assert.equal(loadState(tmpDir).scansSelected, undefined);
		// No session entry on cancel.
		assert.equal(entries.length, 0);
	});

	it("confirm-web-dispatch errors when topic is empty or missing", async () => {
		createRun("Test mission", tmpDir);
		const empty = await exec({ action: "confirm-web-dispatch", topic: "" });
		assert.equal(empty.isError, true);
		assert.match(empty.content[0]!.text, /non-empty topic/);

		const missing = await exec({ action: "confirm-web-dispatch" });
		assert.equal(missing.isError, true);
		assert.match(missing.content[0]!.text, /non-empty topic/);

		assert.equal(loadState(tmpDir).webDispatchConfirmations, undefined);
		assert.equal(entries.length, 0);
	});

	it("confirm-web-dispatch returns cancelled when confirm is unavailable", async () => {
		createRun("Test mission", tmpDir);
		const res = await exec({
			action: "confirm-web-dispatch",
			topic: "community patterns for BSE",
		});
		assert.equal(res.isError, undefined);
		const snap = res.details as Record<string, unknown>;
		assert.equal(snap.cancelled, true);
		assert.deepEqual(snap.webDispatchConfirmations, []);
		assert.equal(loadState(tmpDir).webDispatchConfirmations, undefined);
		// No session entry on cancel.
		assert.equal(entries.length, 0);
	});

	it("snapshot exposes webDispatchConfirmations field", async () => {
		createRun("Test mission", tmpDir);
		const res = await exec({ action: "confirm-understanding" });
		const snap = res.details as Record<string, unknown>;
		assert.ok("webDispatchConfirmations" in snap);
		assert.deepEqual(snap.webDispatchConfirmations, []);
	});
});

describe("appendWebDispatchConsent (core/state.ts helper)", () => {
	it("appends an entry to the ledger and persists", () => {
		const run = createRun("Test mission", tmpDir);
		const next = appendWebDispatchConsent(run, "BSE patterns", tmpDir);
		assert.equal(next.webDispatchConfirmations?.length, 1);
		assert.equal(next.webDispatchConfirmations?.[0]?.topic, "BSE patterns");
		assert.ok(next.webDispatchConfirmations?.[0]?.confirmedAt);
		assert.deepEqual(loadState(tmpDir).webDispatchConfirmations, next.webDispatchConfirmations);
	});

	it("dedupes the same topic in the same ISO minute", () => {
		const run = createRun("Test mission", tmpDir);
		const a = appendWebDispatchConsent(run, "BSE patterns", tmpDir);
		const b = appendWebDispatchConsent(a, "BSE patterns", tmpDir);
		assert.equal(b.webDispatchConfirmations?.length, 1);
	});

	it("keeps different topics separate and ignores whitespace-only", () => {
		const run = createRun("Test mission", tmpDir);
		const a = appendWebDispatchConsent(run, "BSE patterns", tmpDir);
		const b = appendWebDispatchConsent(a, "ISO standards", tmpDir);
		const c = appendWebDispatchConsent(b, "   ", tmpDir);
		assert.equal(c.webDispatchConfirmations?.length, 2);
		assert.deepEqual(
			c.webDispatchConfirmations?.map((e: { topic: string }) => e.topic),
			["BSE patterns", "ISO standards"],
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────
// v3 — spawn-sessions + close-sessions (Phase 6)
// ─────────────────────────────────────────────────────────────────────────

describe("velpari_brainstorm_session — v3 spawn-sessions / close-sessions", () => {
	it("spawn-sessions persists both handles to state.activeSubagents", async () => {
		createRun("Test mission", tmpDir);
		const result = await exec({ action: "spawn-sessions", web: "web", docCode: "doc-code" });
		assert.ok(!result.isError);
		const loaded = loadState(tmpDir);
		assert.equal(loaded.activeSubagents?.web, "web");
		assert.equal(loaded.activeSubagents?.docCode, "doc-code");
		assert.ok(loaded.activeSubagents?.spawnedAt);
	});

	it("spawn-sessions round-trips through snapshot (returned to parent LLM)", async () => {
		createRun("Test mission", tmpDir);
		const result = await exec({ action: "spawn-sessions", web: "web", docCode: "doc-code" });
		assert.ok(!result.isError);
		const details = result.details as { activeSubagents: { web: string; docCode: string } | null };
		assert.equal(details.activeSubagents?.web, "web");
		assert.equal(details.activeSubagents?.docCode, "doc-code");
	});

	it("spawn-sessions mirrors to pi.appendEntry", async () => {
		createRun("Test mission", tmpDir);
		await exec({ action: "spawn-sessions", web: "web", docCode: "doc-code" });
		assert.ok(entries.length >= 1);
		const last = entries[entries.length - 1]!;
		assert.equal(last.customType, "velpari-brainstorm");
	});

	it("spawn-sessions errors when web is missing", async () => {
		createRun("Test mission", tmpDir);
		const result = await exec({ action: "spawn-sessions", docCode: "doc-code" });
		assert.equal(result.isError, true);
		assert.match(result.content[0]!.text, /both `web` and `docCode` non-empty/);
	});

	it("spawn-sessions errors when docCode is missing", async () => {
		createRun("Test mission", tmpDir);
		const result = await exec({ action: "spawn-sessions", web: "web" });
		assert.equal(result.isError, true);
		assert.match(result.content[0]!.text, /both `web` and `docCode` non-empty/);
	});

	it("spawn-sessions errors when handles are whitespace-only", async () => {
		createRun("Test mission", tmpDir);
		const result = await exec({
			action: "spawn-sessions",
			web: "  ",
			docCode: "doc-code",
		});
		assert.equal(result.isError, true);
	});

	it("spawn-sessions errors when no brainstorm is active", async () => {
		// No createRun — no state.json.
		const result = await exec({ action: "spawn-sessions", web: "web", docCode: "doc-code" });
		assert.equal(result.isError, true);
		assert.match(result.content[0]!.text, /No active brainstorm/);
	});

	it("close-sessions clears state.activeSubagents (graceful close)", async () => {
		createRun("Test mission", tmpDir);
		await exec({ action: "spawn-sessions", web: "web", docCode: "doc-code" });
		assert.ok(loadState(tmpDir).activeSubagents);

		const result = await exec({ action: "close-sessions" });
		assert.ok(!result.isError);
		assert.equal(loadState(tmpDir).activeSubagents, undefined);
	});

	it("close-sessions is idempotent when activeSubagents is already undefined", async () => {
		createRun("Test mission", tmpDir);
		// No prior spawn-sessions call.
		const result = await exec({ action: "close-sessions" });
		assert.ok(!result.isError);
		assert.equal(loadState(tmpDir).activeSubagents, undefined);
	});

	it("close-sessions errors when no brainstorm is active", async () => {
		const result = await exec({ action: "close-sessions" });
		assert.equal(result.isError, true);
		assert.match(result.content[0]!.text, /No active brainstorm/);
	});
});

describe("velpari_brainstorm_session — discard (brainstorm-anytime, D7)", () => {
	function enterPausedSession(pausedStage: string): RunState {
		const run = createRun("Test mission", tmpDir);
		const paused: RunState = { ...run, currentStage: pausedStage as never };
		saveState(paused, tmpDir);
		const opened = openBrainstormSession(tmpDir);
		return confirmUnderstanding(opened, tmpDir);
	}

	it("errors when no brainstorm is active", async () => {
		const result = await exec({ action: "discard" });
		assert.equal(result.isError, true);
		assert.match(result.content[0]!.text, /No active brainstorm/);
	});

	it("discard mid-run: clears the session, resumes the paused stage, publishes nothing", async () => {
		enterPausedSession("building-rtm");

		const result = await exec({ action: "discard" });
		assert.ok(!result.isError);
		const details = result.details as Record<string, unknown>;
		assert.equal(details.discarded, true);
		assert.equal(details.resumedStage, "building-rtm");
		assert.match(String(details.message), /Resumed "building-rtm"/);

		const loaded = loadState(tmpDir);
		assert.equal(loaded.currentStage, "building-rtm");
		assert.equal(loaded.pausedStage, undefined);
		assert.equal(loaded.understandingConfirmed, undefined);
		assert.equal(loaded.brainstormQuestions, undefined);
		assert.equal(fs.existsSync(path.join(tmpDir, "Doc", "brainstorm")), false, "discard must not publish");
	});

	it("discard on a first run (no pausedStage): clears the session back to none", async () => {
		const run = createRun("Test mission", tmpDir);
		confirmUnderstanding(run, tmpDir);

		const result = await exec({ action: "discard" });
		assert.ok(!result.isError);
		const details = result.details as Record<string, unknown>;
		assert.equal(details.discarded, true);
		assert.equal(details.resumedStage, "none");

		const loaded = loadState(tmpDir);
		assert.equal(loaded.currentStage, "none");
		assert.equal(loaded.pausedStage, undefined);
		assert.equal(loaded.understandingConfirmed, undefined);
	});

	it("discard mirrors to pi.appendEntry", async () => {
		enterPausedSession("designing");
		const before = entries.length;
		await exec({ action: "discard" });
		assert.ok(entries.length > before);
		assert.equal(entries[entries.length - 1]!.customType, "velpari-brainstorm");
	});
});
