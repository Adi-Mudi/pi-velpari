/**
 * velpari_stage_publish tool (one-command stage publish).
 *
 * Drives the tool against a mock ExtensionAPI (senai test pattern:
 * capture the ToolDefinition from registerTool, invoke execute directly)
 * and a minimal cwd fixture built the same way as the ops/approve tests:
 *
 *   - registration: tool registers under the velpari_stage_publish name
 *   - gating: errors with no active run, at brainstorm stages, and at
 *     completed/handoff stages
 *   - happy path: at drafting-prd with a minimal PRD working copy, the
 *     tool delegates to handleApprove — the PRD is published to
 *     Doc/requirements/ and the stage advances to built-rtm's
 *     predecessor chain (drafted-prd → building-rtm via advanceStage's
 *     chained transition; asserted via state.json)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerStagePublishTool } from "../../src/stages/stage-publish-tool.js";
import { advanceStage, createRun, loadState } from "../../src/core/state.js";

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

/** Notices captured from ctx.ui.notify (handleApprove reports gates via notify). */
let notices: string[];

function makePi(): ExtensionAPI {
	const pi = {
		registerTool: (def: ToolDef) => {
			tool = def;
		},
		// appendStageEntry (state.ts) calls pi.appendEntry when a pi instance
		// is present — required for the advance path in the happy-path test.
		appendEntry: () => {},
	};
	return pi as unknown as ExtensionAPI;
}

function exec(params: Record<string, unknown> = {}) {
	// Pi's ExtensionContext always carries ui (ExtensionUIContext) — the
	// mock mirrors the approve-test ctx shape so handleApprove's notify
	// calls land somewhere observable.
	notices = [];
	const ctx = {
		cwd: tmpDir,
		ui: {
			notify: (message: string) => {
				notices.push(message);
			},
			setStatus: () => {},
		},
	};
	return tool.execute("tc-1", params, undefined, undefined, ctx);
}

/** Minimal PRD working copy so handleApprove's publish path succeeds
 *  (validatePsrs would fail a real publish gate for a stub — the fresh
 *  publish of a stub still writes the file because the PRD gate runs
 *  validatePsrs and BLOCKS. So for the happy path we assert the gate
 *  blocked: publish NOT done, stage NOT advanced. The delegation itself
 *  is what this suite verifies — gate semantics belong to the
 *  approve-doctor-gate suite.) */
function enterDraftingPrd(): void {
	createRun("TestApp", tmpDir);
	advanceStage(loadState(tmpDir), "/velpari-approve-brainstorm", tmpDir);
	advanceStage(loadState(tmpDir), "/velpari-prd", tmpDir);
	const runId = loadState(tmpDir).runId;
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "prd");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "PRD_TestApp.md"), "# PRD\n", "utf8");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-stage-publish-"));
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
	registerStagePublishTool(makePi());
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("velpari_stage_publish tool", () => {
	it("registers under the velpari_stage_publish name", () => {
		assert.equal(tool.name, "velpari_stage_publish");
	});

	it("errors when no active run exists", async () => {
		const res = await exec();
		assert.equal(res.isError, true);
		assert.match(res.content[0]!.text, /No active run/);
	});

	it("errors at brainstorming and names /velpari-approve-brainstorm", async () => {
		createRun("Test mission", tmpDir); // brainstorming
		const res = await exec();
		assert.equal(res.isError, true);
		assert.match(res.content[0]!.text, /\/velpari-approve-brainstorm/);
	});

	it("errors at brainstormed and names /velpari-approve-brainstorm", async () => {
		createRun("Test mission", tmpDir);
		advanceStage(loadState(tmpDir), "/velpari-approve-brainstorm", tmpDir);
		const res = await exec();
		assert.equal(res.isError, true);
		assert.match(res.content[0]!.text, /\/velpari-approve-brainstorm/);
	});

	it("errors at handoff-ready (nothing left to publish)", async () => {
		createRun("Test mission", tmpDir);
		let state = loadState(tmpDir);
		for (const cmd of [
			"/velpari-approve-brainstorm",
			"/velpari-prd",
			"/velpari-prd-approve",
			"/velpari-rtm",
			"/velpari-rtm-approve",
			"/velpari-feasibility",
			"/velpari-feasibility-approve",
			"/velpari-architecture-generator",
			"/velpari-architecture-generator-approve",
			"/velpari-atomic-function",
			"/velpari-atomic-function-approve",
			"/velpari-pseudocode",
			"/velpari-pseudocode-approve",
			"/velpari-testplan",
			"/velpari-testplan-approve",
			"/velpari-development-order",
			"/velpari-development-order-approve",
			"/velpari-final-design",
			"/velpari-final-design-approve",
		]) {
			state = advanceStage(state, cmd, tmpDir);
		}
		state = advanceStage(state, "/velpari-handoff", tmpDir);
		assert.equal(loadState(tmpDir).currentStage, "handoff-ready");
		const res = await exec();
		assert.equal(res.isError, true);
		assert.match(res.content[0]!.text, /already published|correct stage command/);
	});

	it("happy path: delegates to handleApprove — publish gate blocks a stub PRD, stage does not advance", async () => {
		enterDraftingPrd();
		const before = loadState(tmpDir).currentStage;
		assert.equal(before, "drafting-prd");

		const res = await exec();
		// The tool itself succeeds (delegation ran); handleApprove notified
		// the publish-gate block through ctx.ui.notify.
		assert.equal(res.isError, undefined);
		assert.match(notices.join("\n"), /Publish gate blocked/);
		const snap = res.details as Record<string, unknown>;
		assert.equal(snap.published, false);
		assert.equal(snap.stage, "drafting-prd");
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd");
	});

	it("happy path: publishes a valid PSRS working copy and advances the stage", async () => {
		enterDraftingPrd();
		const runId = loadState(tmpDir).runId;
		const prdPath = path.join(
			tmpDir,
			".IDE_Plans",
			"velpari",
			"runs",
			runId,
			"prd",
			"PRD_TestApp.md",
		);
		// Minimal PSRS that passes validatePsrs: frontmatter + all 20
		// required sections. Section bodies may be minimal.
		const psrs = [
			"---",
			"documentType: product-software-requirements",
			"version: 1.0.0",
			"status: draft",
			"profile: core-psrs-v1",
			"profileVersion: 1.0.0",
			"mission: TestApp",
			"projectName: TestApp",
			"---",
			"",
			"# PSRS — TestApp",
			"",
			"## 1. Objective",
			"Objective body.",
			"",
			"## 2. Problem",
			"Problem body.",
			"",
			"## 3. System Actors",
			"Primary user.",
			"",
			"## 4. User Stories",
			"| ID | Actor | Story | Source | Status |",
			"|---|---|---|---|---|",
			"| US-01 | user | As a user, I want x so that y. | FR-01 | proposed |",
			"",
			"## 5. Scope",
			"In scope.",
			"",
			"## 6. MVP",
			"### MVP Goal",
			"Ship the core flow.",
			"",
			"### MVP Users",
			"Primary user.",
			"",
			"### MVP Requirements",
			"- FR-01",
			"",
			"### MVP Exit Criteria",
			"- Core flow verifiable.",
			"",
			"## 7. Success Metrics",
			"| ID | Metric | Target | Measurement | Status |",
			"|---|---|---|---|---|",
			"| SM-01 | m | t | how | proposed |",
			"",
			"## 8. Phases",
			"### Phase 1 — MVP",
			"Phase body.",
			"",
			"## 9. Functional Requirements",
			"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
			"|---|---|---|---|---|---|---|",
			"| FR-01 | The system SHALL do x | must | 1 | done | test | proposed |",
			"",
			"## 10. Non-Functional Requirements",
			"| ID | Category | Requirement | Phase | Verification | Status |",
			"|---|---|---|---|---|---|---|",
			"| NFR-01 | performance | The system SHALL be fast | 1 | test | proposed |",
			"",
			"## 11. Data and Interfaces",
			"| ID | Type | Name | Requirement | Source |",
			"|---|---|---|---|---|",
			"| DATA-01 | Entity | Thing | fields | FR-01 |",
			"",
			"## 12. Errors and Edge Cases",
			"| ID | Condition | Expected Behavior |",
			"|---|---|---|",
			"| ERR-01 | bad input | reject |",
			"",
			"## 13. Constraints",
			"1. None.",
			"",
			"## 14. Dependencies and Risks",
			"1. None.",
			"",
			"## 15. Out of Scope",
			"1. None.",
			"",
			"## 16. Open Questions",
			"| ID | Question | Impact | Owner | Status |",
			"|---|---|---|---|---|",
			"| Q-01 | q | i | o | Open |",
			"",
			"## 17. Acceptance Criteria",
			"1. Verifiable.",
			"",
			"## 18. Helper Function Candidates",
			"| ID | Name | Purpose | Source Requirements | Inputs | Outputs | Errors | Testable |",
			"|---|---|---|---|---|---|---|---|",
			"| HF-01 | f | p | FR-01 | in | out | err | yes |",
			"",
			"## 19. Glossary",
			"| Term | Definition |",
			"|---|---|",
			"| t | d |",
			"",
			"## 20. Change Log",
			"- 2026-09-16 initial draft",
		].join("\n");
		fs.writeFileSync(prdPath, psrs, "utf8");

		const res = await exec();
		assert.equal(res.isError, undefined);
		assert.ok(
			notices.join("\n"),
			`expected publish to proceed; notices: ${JSON.stringify(notices)}`,
		);
		const snap = res.details as Record<string, unknown>;
		assert.equal(snap.published, true);
		// advanceStage performs ONE transition (drafting-prd → drafted-prd);
		// building-rtm starts when the user runs /velpari-rtm.
		assert.equal(snap.stage, "drafted-prd");
		assert.equal(loadState(tmpDir).currentStage, "drafted-prd");
		assert.ok(
			fs.existsSync(path.join(tmpDir, "Doc", "requirements", "PRD_TestApp.md")),
			"published PRD should exist in Doc/requirements/",
		);
	});
});
