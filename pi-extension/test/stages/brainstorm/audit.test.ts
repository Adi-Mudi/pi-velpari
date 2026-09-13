/**
 * Brainstorm audit log tests (Phase 4).
 *
 * Covers: session create / append / summarizeDecisions / buildSummary /
 * renderDecision / renderAuditLog, countNotesSections against the 7
 * required sections, and the write/read round-trip of
 * brainstorm-dispatch.md (marker on line 1, atomic write).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	appendDecision,
	auditLogPath,
	AUDIT_LOG_MARKER,
	buildSummary,
	countNotesSections,
	createAuditSession,
	readAuditLog,
	renderAuditLog,
	renderDecision,
	summarizeDecisions,
	writeAuditLog,
	type DispatchDecision,
} from "../../../src/stages/brainstorm/audit.js";

const RUN_ID = "2026-09-12-02-30-audit-run";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-audit-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function decision(overrides: Partial<DispatchDecision> = {}): DispatchDecision {
	return {
		turn: 1,
		timestamp: "2026-09-12T02:30:00.000Z",
		userInput: "how does sync work?",
		decision: "inline",
		reason: "answered from the codebase read",
		...overrides,
	};
}

describe("audit session + summary", () => {
	it("creates an empty session keyed on the run id", () => {
		const s = createAuditSession(RUN_ID, "todo CLI app");
		assert.equal(s.runId, RUN_ID);
		assert.equal(s.seed, "todo CLI app");
		assert.deepEqual(s.decisions, []);
		assert.ok(!Number.isNaN(Date.parse(s.startedAt)));
	});

	it("appendDecision accumulates in turn order and chains", () => {
		const s = createAuditSession(RUN_ID, "seed");
		const returned = appendDecision(s, decision({ turn: 1 }));
		appendDecision(s, decision({ turn: 2, decision: "dispatched", agent: "extractor" }));
		assert.equal(returned, s);
		assert.equal(s.decisions.length, 2);
		assert.equal(s.decisions[1]!.turn, 2);
	});

	it("summarizeDecisions counts by kind and by agent", () => {
		const summary = summarizeDecisions([
			decision({ decision: "dispatched", agent: "extractor" }),
			decision({ decision: "dispatched", agent: "extractor" }),
			decision({ decision: "dispatched", agent: "web-search-agent" }),
			decision({ decision: "inline" }),
			decision({ decision: "skipped" }),
			decision({ decision: "side-channel", agent: "prd-checker" }),
		]);
		assert.equal(summary.totalDispatches, 3);
		assert.deepEqual(summary.dispatchesByAgent, { extractor: 2, "web-search-agent": 1 });
		assert.equal(summary.inlineReads, 1);
		assert.equal(summary.skipped, 1);
		assert.equal(summary.sideChannel, 1);
	});

	it("buildSummary merges decision counts with caller extras", () => {
		const s = createAuditSession(RUN_ID, "seed");
		appendDecision(s, decision({ decision: "dispatched", agent: "extractor" }));
		const summary = buildSummary(s, {
			wallClockMs: 12_000,
			notesSectionsFilled: 6,
			notesSectionsTotal: 7,
		});
		assert.equal(summary.totalDispatches, 1);
		assert.equal(summary.wallClockMs, 12_000);
		assert.equal(summary.notesSectionsFilled, 6);
		assert.equal(summary.notesSectionsTotal, 7);
	});
});

describe("renderDecision + renderAuditLog", () => {
	it("renders a decision block with optional fields", () => {
		const block = renderDecision(
			decision({
				turn: 3,
				decision: "dispatched",
				agent: "extractor",
				task: "Scan the codebase",
				expectedOutput: "JSON report",
				tokens: 4000,
				elapsedMs: 9000,
			}),
		);
		assert.match(block, /### Turn 3 — 02:30/);
		assert.match(block, /- Decision: dispatched extractor/);
		assert.match(block, /- Task: Scan the codebase/);
		assert.match(block, /- Expected output: JSON report/);
		assert.match(block, /- Tokens: ~4000/);
		assert.match(block, /- Elapsed: ~9000ms/);
	});

	it("renders the full log with marker on line 1 and a summary section", () => {
		const s = createAuditSession(RUN_ID, "todo CLI app");
		appendDecision(s, decision({ decision: "dispatched", agent: "extractor" }));
		const log = renderAuditLog(s, buildSummary(s, {
			wallClockMs: 5000,
			notesSectionsFilled: 7,
			notesSectionsTotal: 7,
		}));
		assert.ok(log.split("\n")[0] === AUDIT_LOG_MARKER);
		assert.match(log, /- Run: 2026-09-12-02-30-audit-run/);
		assert.match(log, /- Seed: "todo CLI app"/);
		assert.match(log, /- Total dispatches: 1/);
		assert.match(log, /- Dispatches by agent: extractor x1/);
		assert.match(log, /- Notes sections filled: 7 \/ 7/);
	});

	it("renders the empty-decisions fallback", () => {
		const s = createAuditSession(RUN_ID, "seed");
		const log = renderAuditLog(s, buildSummary(s, {
			wallClockMs: 0,
			notesSectionsFilled: 0,
			notesSectionsTotal: 7,
		}));
		assert.match(log, /no scout dispatches/);
	});
});

describe("countNotesSections", () => {
	it("counts filled sections against the 7 required ones", () => {
		const doc = [
			"## Mission", "x", "",
			"## Interview Answers", "x", "",
			"## Scout Proposals", "x", "",
			"## Decision Summary", "x", "",
			"## Agreed", "x", "",
			"## Not wanted", "x", "",
			"## Open", "x",
		].join("\n");
		assert.deepEqual(countNotesSections(doc), { filled: 7, total: 7 });
	});

	it("does not count missing, empty, or _TBD_-only sections", () => {
		const doc = [
			"## Mission", "x", "",
			"## Interview Answers", "_TBD_", "",
			"## Scout Proposals", "",
			"## Decision Summary", "x",
		].join("\n");
		assert.deepEqual(countNotesSections(doc), { filled: 2, total: 7 });
	});
});

describe("writeAuditLog / readAuditLog round-trip", () => {
	it("writes atomically to the run's brainstorm folder and reads back", () => {
		const s = createAuditSession(RUN_ID, "todo CLI app");
		appendDecision(s, decision({ decision: "dispatched", agent: "extractor" }));
		const written = writeAuditLog(tmpDir, s, buildSummary(s, {
			wallClockMs: 1000,
			notesSectionsFilled: 7,
			notesSectionsTotal: 7,
		}));

		const expected = path.join(
			tmpDir, ".IDE_Plans", "velpari", "runs", RUN_ID, "brainstorm", "brainstorm-dispatch.md",
		);
		assert.equal(written, expected);
		assert.equal(auditLogPath(RUN_ID, tmpDir), expected);

		const raw = fs.readFileSync(expected, "utf8");
		assert.equal(raw.split("\n")[0], AUDIT_LOG_MARKER);

		const back = readAuditLog(tmpDir, RUN_ID);
		assert.ok(back);
		assert.equal(back.runId, RUN_ID);
		assert.equal(back.seed, "todo CLI app");
		assert.equal(back.startedAt, s.startedAt);
		assert.ok(back.content.includes("## Summary"));
	});

	it("readAuditLog returns null when the file is missing or unmarked", () => {
		assert.equal(readAuditLog(tmpDir, "no-such-run"), null);

		const s = createAuditSession(RUN_ID, "seed");
		const filePath = writeAuditLog(tmpDir, s, buildSummary(s, {
			wallClockMs: 0,
			notesSectionsFilled: 0,
			notesSectionsTotal: 7,
		}));
		fs.writeFileSync(filePath, "not an audit log", "utf8");
		assert.equal(readAuditLog(tmpDir, RUN_ID), null);
	});
});
