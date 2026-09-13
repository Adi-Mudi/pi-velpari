/**
 * /velpari-approve revision gate tests (living documents).
 *
 * Asserts:
 *   - fresh publish (no published copy) still works (regression)
 *   - a valid PRD revision (version bump + new Change Log entry + all
 *     IDs kept) publishes and advances the stage
 *   - a revision that drops an FR row is blocked (psrs-compare-id-removed)
 *   - a revision without a version bump is blocked
 *   - a revision without a new Change Log entry is blocked
 *   - a blocked publish writes NOTHING and does NOT advance the stage
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { advanceStage, createRun, loadState, saveState } from "../../src/core/state.js";

interface Notice {
	message: string;
	level: string;
}

let tmpDir: string;
let notices: Notice[];

function makeCtx(): ExtensionCommandContext {
	notices = [];
	return {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
			setStatus: () => {},
		},
	} as unknown as ExtensionCommandContext;
}

function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

// --- Valid 20-section PSRS fixture (mirrors test/core/psrs.test.ts) ---

function frontmatter(version: string): string {
	return `---
documentType: product-software-requirements
version: ${version}
status: draft
profile: core-psrs-v1
profileVersion: 1.0.0
mission: TestApp
projectName: TestApp
---

# Product and Software Requirements Specification — TestApp
`;
}

function sectionBodies(opts: {
	frRows?: string;
	changeLog?: string;
}): Array<[string, string]> {
	return [
		["Objective", "One paragraph summary of the objective."],
		["Problem", "What problem this solves."],
		["System Actors", "Primary and secondary users."],
		[
			"User Stories",
			"| ID | Actor | Story | Source | Status |\n|---|---|---|---|---|\n| US-01 | user | As a user, I want to add an expense. | FR-01 | proposed |",
		],
		["Scope", "In-scope and out-of-scope summary."],
		["MVP", "MVP goal, users, requirements, and exit criteria captured here."],
		[
			"Success Metrics",
			"| ID | Metric | Target | Measurement | Status |\n|---|---|---|---|---|\n| SM-01 | Weekly active users | 100 | dashboard | proposed |",
		],
		["Phases", "Phase 0 foundation, Phase 1 MVP, each with goals and acceptance."],
		[
			"Functional Requirements",
			opts.frRows ??
				"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |\n|---|---|---|---|---|---|---|\n| FR-01 | Add expense | must | 1 | expense saved | Integration test | proposed |",
		],
		[
			"Non-Functional Requirements",
			"| ID | Category | Requirement | Phase | Verification | Status |\n|---|---|---|---|---|---|\n| NFR-01 | performance | p95 < 200ms | 1 | Performance test | proposed |",
		],
		[
			"Data and Interfaces",
			"| ID | Type | Name | Requirement | Source |\n|---|---|---|---|---|\n| DATA-01 | Entity | Expense | amount + category | FR-01 |",
		],
		[
			"Errors and Edge Cases",
			"| ID | Condition | Expected Behavior |\n|---|---|---|\n| ERR-01 | amount <= 0 | reject with validation error |",
		],
		["Constraints", "1. Offline-first storage."],
		["Dependencies and Risks", "1. Depends on local filesystem access."],
		["Out of Scope", "1. Multi-currency support."],
		[
			"Open Questions",
			"| ID | Question | Impact | Owner | Status |\n|---|---|---|---|---|\n| Q-01 | Sync strategy? | medium | user | Open |",
		],
		["Acceptance Criteria", "1. FR-01 verified by integration test."],
		[
			"Helper Function Candidates",
			"| ID | Name | Purpose | Source Requirements | Inputs | Outputs | Errors | Testable |\n|---|---|---|---|---|---|---|---|\n| HF-01 | validateExpense | Validate expense data. | FR-01 | amount | validated | invalid amount | yes |",
		],
		["Glossary", "| Term | Definition |\n|---|---|\n| Expense | A single spending record. |"],
		["Change Log", opts.changeLog ?? "- 2026-09-12 velpari initial draft"],
	];
}

function buildPsrs(opts: {
	version: string;
	frRows?: string;
	changeLog?: string;
}): string {
	const parts: string[] = [frontmatter(opts.version)];
	for (const [heading, body] of sectionBodies(opts)) {
		parts.push(`## ${heading}\n${body}\n`);
	}
	return parts.join("\n");
}

const FR_TABLE_TWO_ROWS =
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |\n" +
	"|---|---|---|---|---|---|---|\n" +
	"| FR-01 | Add expense | must | 1 | expense saved | Integration test | proposed |\n" +
	"| FR-02 | Edit expense | should | 2 | expense updated | Integration test | proposed |";

const FR_TABLE_REPLACED =
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |\n" +
	"|---|---|---|---|---|---|---|\n" +
	"| FR-02 | Edit expense | should | 2 | expense updated | Integration test | proposed |";

// --- Run / working-copy helpers ---

function publishedPrdPath(): string {
	return path.join(tmpDir, "Doc", "requirements", "PRD_TestApp.md");
}

function writeWorkingPrd(content: string): void {
	const runId = loadState(tmpDir).runId;
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "prd");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "PRD_TestApp.md"), content, "utf8");
}

/** Advance the fresh run into drafting-prd and write the working copy. */
function enterDraftingPrd(workingContent: string): void {
	const run = createRun("TestApp", tmpDir);
	const brainstormed = advanceStage(run, "/velpari-approve-brainstorm", tmpDir);
	advanceStage(brainstormed, "/velpari-prd", tmpDir);
	writeWorkingPrd(workingContent);
}

/**
 * Re-enter drafting-prd after an approve (update mode). The real flow gets
 * here via a change brainstorm → /velpari-prd; the test sets the stage
 * directly to keep the fixture focused on the approve gate.
 */
function reenterDraftingPrd(workingContent: string): void {
	const state = loadState(tmpDir);
	saveState({ ...state, currentStage: "drafting-prd" }, tmpDir);
	writeWorkingPrd(workingContent);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-approve-update-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("/velpari-approve — revision gate", () => {
	it("fresh publish still works when no published copy exists (regression)", async () => {
		enterDraftingPrd(buildPsrs({ version: "1.0.0" }));
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.ok(fs.existsSync(publishedPrdPath()), "published copy written");
		assert.match(allMessages(), /Published to /);
		assert.equal(loadState(tmpDir).currentStage, "drafted-prd");
	});

	it("valid revision publishes and advances", async () => {
		enterDraftingPrd(buildPsrs({ version: "1.0.0" }));
		await handleApprove(makeCtx(), undefined, tmpDir);
		assert.equal(loadState(tmpDir).currentStage, "drafted-prd");

		// Re-run the PRD stage (update mode) with a clean revision.
		reenterDraftingPrd(
			buildPsrs({
				version: "1.1.0",
				frRows: FR_TABLE_TWO_ROWS,
				changeLog:
					"- 2026-09-12 velpari initial draft\n- 2026-09-13 added FR-02 edit expense",
			}),
		);
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.match(allMessages(), /Published revision of PRD/);
		const published = fs.readFileSync(publishedPrdPath(), "utf8");
		assert.match(published, /version: 1\.1\.0/);
		assert.match(published, /FR-02/);
		assert.equal(loadState(tmpDir).currentStage, "drafted-prd");
	});

	it("blocks a revision that drops an FR row (deprecate, don't delete)", async () => {
		enterDraftingPrd(buildPsrs({ version: "1.0.0" }));
		await handleApprove(makeCtx(), undefined, tmpDir);
		const before = fs.readFileSync(publishedPrdPath(), "utf8");

		reenterDraftingPrd(
			buildPsrs({
				version: "2.0.0",
				frRows: FR_TABLE_REPLACED,
				changeLog: "- 2026-09-12 velpari initial draft\n- 2026-09-13 replaced FR-01",
			}),
		);
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.match(allMessages(), /psrs-compare-id-removed/);
		assert.match(allMessages(), /FR-01/);
		assert.equal(fs.readFileSync(publishedPrdPath(), "utf8"), before, "publish is all-or-nothing");
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd", "stage not advanced");
	});

	it("blocks a revision without a version bump", async () => {
		enterDraftingPrd(buildPsrs({ version: "1.0.0" }));
		await handleApprove(makeCtx(), undefined, tmpDir);
		const before = fs.readFileSync(publishedPrdPath(), "utf8");

		reenterDraftingPrd(
			buildPsrs({
				version: "1.0.0",
				frRows: FR_TABLE_TWO_ROWS,
				changeLog:
					"- 2026-09-12 velpari initial draft\n- 2026-09-13 added FR-02 edit expense",
			}),
		);
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.match(allMessages(), /psrs-compare-version-not-bumped/);
		assert.equal(fs.readFileSync(publishedPrdPath(), "utf8"), before);
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd");
	});

	it("blocks a revision without a new Change Log entry", async () => {
		enterDraftingPrd(buildPsrs({ version: "1.0.0" }));
		await handleApprove(makeCtx(), undefined, tmpDir);
		const before = fs.readFileSync(publishedPrdPath(), "utf8");

		reenterDraftingPrd(buildPsrs({ version: "1.1.0", frRows: FR_TABLE_TWO_ROWS }));
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.match(allMessages(), /psrs-compare-changelog-missing/);
		assert.equal(fs.readFileSync(publishedPrdPath(), "utf8"), before);
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd");
	});
});
