/**
 * Brainstorm guard layer tests (Phase 2).
 *
 * Covers every guard in src/stages/brainstorm/guard.ts: seed input, notes
 * content (missing / empty / _TBD_ / valid), artifact path (traversal, NUL,
 * escape, valid inside), dispatch count, approve readiness (hard lock +
 * open questions), and the mutation gate (blocks outside the brainstorm
 * folder, allows inside, lifts past the brainstorming stage, passes
 * non-edit/write tools through).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import * as path from "node:path";
import {
	guardApproveReadiness,
	guardArtifactPath,
	guardBrainstormMutation,
	guardDispatchCount,
	guardNotesContent,
	guardSeedInput,
	VELPARI_BRAINSTORM_DISPATCH_CAP,
} from "../../../src/stages/brainstorm/guard.js";
import type { RunState } from "../../../src/core/state.js";

const RUN_ID = "2026-09-12-02-00-test-run";
const CWD = path.resolve("/tmp/velpari-guard-test");

function makeState(overrides: Partial<RunState> = {}): RunState {
	return {
		version: 1,
		runId: RUN_ID,
		mission: "Test mission",
		currentStage: "brainstorming",
		history: [],
		updatedAt: "",
		...overrides,
	};
}

const VALID_NOTES = [
	"# Brainstorm Notes — Test mission",
	"",
	"## Mission",
	"Test mission",
	"",
	"## Interview Answers",
	"1. Q: Scope? A: MVP only",
	"",
	"## Scout Proposals",
	"",
	"### NEW EXTRACTOR",
	"- (new) extractor idea",
	"",
	"## Decision Summary",
	"- new-fr: [FR-01]",
	"",
	"## Agreed",
	"- Q1: Scope? — MVP only",
	"",
	"## Not wanted",
	"- (none)",
	"",
	"## Open",
	"- (none)",
].join("\n");

describe("guardSeedInput", () => {
	it("blocks empty and whitespace-only seeds", () => {
		assert.equal(guardSeedInput("").ok, false);
		assert.equal(guardSeedInput("   \n\t ").ok, false);
		assert.match(guardSeedInput("").reason ?? "", /\/velpari-brainstorm/);
	});

	it("passes a real seed", () => {
		assert.equal(guardSeedInput("todo CLI app").ok, true);
	});
});

describe("guardNotesContent", () => {
	it("passes a complete notes document", () => {
		assert.equal(guardNotesContent(VALID_NOTES).ok, true);
	});

	it("blocks a missing section", () => {
		const doc = VALID_NOTES.replace(/## Decision Summary[\s\S]*$/, "");
		const res = guardNotesContent(doc);
		assert.equal(res.ok, false);
		assert.ok(res.details?.some((d) => d.includes("Decision Summary")));
	});

	it("blocks an empty section", () => {
		const doc = VALID_NOTES.replace("## Mission\nTest mission", "## Mission");
		const res = guardNotesContent(doc);
		assert.equal(res.ok, false);
		assert.ok(res.details?.some((d) => d.includes("Mission (empty)")));
	});

	it("blocks a _TBD_ placeholder", () => {
		const doc = VALID_NOTES.replace("- new-fr: [FR-01]", "_TBD_");
		const res = guardNotesContent(doc);
		assert.equal(res.ok, false);
		assert.ok(res.details?.some((d) => d.includes("Decision Summary")));
	});

	it("ignores ### subsections inside Scout Proposals", () => {
		// The ### NEW EXTRACTOR subsection must not be read as the next ## section.
		assert.equal(guardNotesContent(VALID_NOTES).ok, true);
	});

	it("requires the 3 decision-ledger sections (Agreed / Not wanted / Open)", () => {
		// A pre-Phase-4 notes document with only the base 4 sections blocks.
		const legacyDoc = VALID_NOTES.replace(/\n## Agreed[\s\S]*$/, "");
		const res = guardNotesContent(legacyDoc);
		assert.equal(res.ok, false);
		assert.ok(res.details?.some((d) => d.includes("Agreed")));
		assert.ok(res.details?.some((d) => d.includes("Not wanted")));
		assert.ok(res.details?.some((d) => d.includes("Open")));
	});
});

describe("guardArtifactPath", () => {
	const runDir = path.join(CWD, ".IDE_Plans", "velpari", "runs", RUN_ID);

	it("allows a path inside the run dir", () => {
		assert.equal(
			guardArtifactPath(path.join(runDir, "brainstorm", "brainstorm-notes.md"), runDir).ok,
			true,
		);
	});

	it("blocks traversal escaping the run dir", () => {
		const res = guardArtifactPath(path.join(runDir, "..", "..", "state.json"), runDir);
		assert.equal(res.ok, false);
		assert.match(res.reason ?? "", /escapes the run dir/);
	});

	it("blocks an absolute path outside the run dir", () => {
		assert.equal(guardArtifactPath(path.join(CWD, "Doc", "x.md"), runDir).ok, false);
	});

	it("blocks NUL bytes and missing run dir", () => {
		assert.equal(guardArtifactPath("a\0b", runDir).ok, false);
		assert.equal(guardArtifactPath("x.md", "").ok, false);
	});
});

describe("guardDispatchCount", () => {
	it("allows counts below the cap", () => {
		assert.equal(guardDispatchCount(0).ok, true);
		assert.equal(guardDispatchCount(VELPARI_BRAINSTORM_DISPATCH_CAP - 1).ok, true);
	});

	it("blocks at the cap and rejects negatives", () => {
		const res = guardDispatchCount(VELPARI_BRAINSTORM_DISPATCH_CAP);
		assert.equal(res.ok, false);
		assert.match(res.reason ?? "", /cap reached/);
		assert.equal(guardDispatchCount(-1).ok, false);
	});
});

describe("guardApproveReadiness", () => {
	it("blocks when understanding is not confirmed", () => {
		const res = guardApproveReadiness(makeState());
		assert.equal(res.ok, false);
		assert.match(res.reason ?? "", /Understanding is not confirmed/);
	});

	it("passes with confirmed understanding and no questions", () => {
		assert.equal(
			guardApproveReadiness(makeState({ understandingConfirmed: true })).ok,
			true,
		);
	});

	it("blocks draft/discussing questions and names their ids", () => {
		const res = guardApproveReadiness(
			makeState({
				understandingConfirmed: true,
				brainstormQuestions: [
					{ id: "Q1", text: "Scope?", state: "draft" },
					{ id: "Q2", text: "Data?", state: "agreed" },
					{ id: "Q3", text: "Auth?", state: "discussing" },
				],
			}),
		);
		assert.equal(res.ok, false);
		assert.match(res.reason ?? "", /Q1/);
		assert.match(res.reason ?? "", /Q3/);
		assert.ok(!res.reason?.includes("Q2"));
		assert.deepEqual(
			res.details?.map((d) => d.split(":")[0]),
			["Q1", "Q3"],
		);
	});

	it("passes when every question is terminal (agreed / not-wanted / replaced)", () => {
		assert.equal(
			guardApproveReadiness(
				makeState({
					understandingConfirmed: true,
					brainstormQuestions: [
						{ id: "Q1", text: "a", state: "agreed" },
						{ id: "Q2", text: "b", state: "not-wanted", reason: "no" },
						{ id: "Q3", text: "c", state: "replaced", reason: "Q1" },
					],
				}),
			).ok,
			true,
		);
	});
});

describe("guardBrainstormMutation", () => {
	const brainstormDir = path.join(
		CWD, ".IDE_Plans", "velpari", "runs", RUN_ID, "brainstorm",
	);

	it("blocks edit/write outside the brainstorm folder while brainstorming", () => {
		const res = guardBrainstormMutation(
			"write",
			{ path: "src/index.ts" },
			makeState(),
			CWD,
		);
		assert.equal(res?.block, true);
		assert.match(res?.reason ?? "", /read-only/);
	});

	it("blocks edit/write with no path while brainstorming", () => {
		const res = guardBrainstormMutation("edit", {}, makeState(), CWD);
		assert.equal(res?.block, true);
	});

	it("allows writes inside the brainstorm folder", () => {
		const res = guardBrainstormMutation(
			"write",
			{ path: path.join(brainstormDir, "brainstorm-notes.md") },
			makeState(),
			CWD,
		);
		assert.equal(res, undefined);
	});

	it("lifts when the stage advanced past brainstorming (approve releases the lock)", () => {
		const res = guardBrainstormMutation(
			"write",
			{ path: "src/index.ts" },
			makeState({ currentStage: "drafting-prd" }),
			CWD,
		);
		assert.equal(res, undefined);
	});

	it("lifts when there is no active run", () => {
		const res = guardBrainstormMutation(
			"write",
			{ path: "src/index.ts" },
			makeState({ runId: "", currentStage: "none" }),
			CWD,
		);
		assert.equal(res, undefined);
	});

	it("passes non-edit/write tools through", () => {
		assert.equal(
			guardBrainstormMutation("bash", { command: "rm -rf /" }, makeState(), CWD),
			undefined,
		);
		assert.equal(
			guardBrainstormMutation("read", { path: "src/index.ts" }, makeState(), CWD),
			undefined,
		);
	});
});
