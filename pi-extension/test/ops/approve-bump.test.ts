/**
 * N27 — declared-vs-actual bump gate at publish, exercised via handleApprove
 * (the single path for the velpari_stage_publish tool and all 9 fall-back
 * approve commands).
 *
 * Asserts:
 *   - (a) revision removes an id (TC-1) but declares `bump: patch` →
 *     BLOCKED with `bump-violation` naming MAJOR + the removed id
 *     (exercised on final-design: the PRD's comparePsrs removes-id rule
 *     fires first, so a non-PRD artifact is where the bump gate itself
 *     decides)
 *   - (b) wording-only revision declaring `bump: major` → publishes with
 *     a `bump-over` warning notice (allowed)
 *   - (c) revision with NO frontmatter bump → blocked with the exact
 *     "add `bump: major|minor|patch`" message
 *   - (d) revision `bump: minor` adding an FR → publishes + advances
 *   - (e) fresh publish without `bump:` → publishes (exemption proof)
 *   - (f) `bump: bogus` → blocked `bump-invalid` quoting the value
 *
 * Fixture recipes: test/ops/approve-update.test.ts (PSRS PRD revision
 * walk) + test/ops/approve-final-design.test.ts (final-design doc).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { advanceStage, clearRun, createRun, loadState, saveState } from "../../src/core/state.js";

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

// ---------------------------------------------------------------------------
// PRD fixture (approve-update.test.ts recipe) — projectName TestApp
// ---------------------------------------------------------------------------

function prdFrontmatter(version: string, bump?: string): string {
	// PHASE-D (N27) fixture: optional declared `bump:` — revision fixtures
	// that pass the revision gate must declare one (fresh publishes exempt).
	const bumpLine = bump ? `bump: ${bump}\n` : "";
	return `---\ndocumentType: product-software-requirements\nversion: ${version}\n${bumpLine}status: draft\nprofile: core-psrs-v1\nprofileVersion: 1.0.0\nmission: TestApp\nprojectName: TestApp\n---\n\n# Product and Software Requirements Specification — TestApp\n`;
}

function prdSectionBodies(opts: { frRows?: string; changeLog?: string; objective?: string }): Array<[string, string]> {
	return [
		["Objective", opts.objective ?? "One paragraph summary of the objective."],
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
	bump?: string;
	objective?: string;
}): string {
	const parts: string[] = [prdFrontmatter(opts.version, opts.bump)];
	for (const [heading, body] of prdSectionBodies(opts)) {
		parts.push(`## ${heading}\n${body}\n`);
	}
	return parts.join("\n");
}

const FR_TABLE_TWO_ROWS =
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |\n" +
	"|---|---|---|---|---|---|---|\n" +
	"| FR-01 | Add expense | must | 1 | expense saved | Integration test | proposed |\n" +
	"| FR-02 | Edit expense | should | 2 | expense updated | Integration test | proposed |";

function prdPath(): string {
	return join(tmpDir, "Doc", "requirements", "PRD_TestApp.md");
}

function seedPublishedBrainstorm(): void {
	const dir = join(tmpDir, "Doc", "brainstorm");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "brainstorm-testapp.md"), "# brainstorm\n", "utf8");
}

function writeWorkingPrd(content: string): void {
	const runId = loadState(tmpDir).runId!;
	const dir = join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "prd");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "PRD_TestApp.md"), content, "utf8");
}

/** Advance the fresh run into drafting-prd and write the working copy. */
function enterDraftingPrd(workingContent: string): void {
	clearRun(tmpDir);
	setupPrdFilesConfig();
	const run = createRun("TestApp", tmpDir);
	const brainstormed = advanceStage(run, "/velpari-approve-brainstorm", tmpDir);
	advanceStage(brainstormed, "/velpari-prd", tmpDir);
	seedPublishedBrainstorm();
	writeWorkingPrd(workingContent);
}

/** Re-enter drafting-prd after an approve (update mode). */
function reenterDraftingPrd(workingContent: string): void {
	const state = loadState(tmpDir);
	saveState({ ...state, currentStage: "drafting-prd" }, tmpDir);
	seedPublishedBrainstorm();
	writeWorkingPrd(workingContent);
}

function setupPrdFilesConfig(): void {
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TestApp" }),
		"utf8",
	);
}

// ---------------------------------------------------------------------------
// final-design fixture (approve-final-design.test.ts recipe) — FinalApp
// ---------------------------------------------------------------------------

function fdFrontmatter(version: string, bump?: string): string {
	const bumpLine = bump ? `bump: ${bump}\n` : "";
	return `---\nartifact: final-design\nproject: FinalApp\nversion: ${version}\n${bumpLine}status: draft\nstage: finalizing-design\nrun: TBD\ncreated: 2026-09-13T00:00:00.000Z\nupdated: 2026-09-13T00:00:00.000Z\n---\n\n`;
}

function fdSections(extraChangeLogLine?: string, dropTc?: boolean): string {
	const parts = [
		"# Final Design — FinalApp",
		"",
		"## Overview",
		"",
		"One-paragraph summary referencing the approved design.",
		"",
		"## Module Inventory",
		"",
		"| ID | Name | Pseudocode | Tests | Notes |",
		"|---|---|---|---|---|",
		"| M-1 | auth | yes | yes | |",
		"",
		"## Contract Map",
		"",
		"| Contract | Signature | Pseudocode call sites | Test exercises | Status |",
		"|---|---|---|---|---|",
		"| API-AUTH-LOGIN | POST /auth/login | 1 | TC-1 | ok |",
		"",
		"## Consistency Notes",
		"",
		"- No id mismatches.",
		"- No name drift.",
		"- No orphan ids.",
		"",
		"## Mismatches Found + Resolution",
		"",
		"| Source | Item | Resolution |",
		"|---|---|---|",
		"| coverage | none | — |",
		"",
		"## Final Contracts",
		"",
		"- API-AUTH-LOGIN: POST /auth/login → { token }.",
		"",
		"## Change Log",
		"",
		"- 1.0.0 — initial consolidated final design.",
	];
	if (extraChangeLogLine) parts.push(extraChangeLogLine);
	let body = parts.join("\n") + "\n";
	if (dropTc) {
		// Removes the id that classifyChange will see as deleted → MAJOR.
		body = body.split("TC-1").join("—");
	}
	return body;
}

function seedFdInputs(): void {
	mkdirSync(join(tmpDir, "Doc"), { recursive: true });
	for (const name of ["design", "atomic-functions", "pseudocode", "test-plan", "test-cases", "development-order"]) {
		writeFileSync(join(tmpDir, "Doc", `${name}_FinalApp.md`), `# ${name}\n`, "utf8");
	}
}

function walkToFinalizing(): void {
	clearRun(tmpDir);
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "FinalApp" }),
		"utf8",
	);
	let state = createRun("Final design bump", tmpDir);
	state = advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
	state = advanceStage(state, "/velpari-prd", tmpDir);
	state = advanceStage(state, "/velpari-prd-approve", tmpDir);
	state = advanceStage(state, "/velpari-rtm", tmpDir);
	state = advanceStage(state, "/velpari-rtm-approve", tmpDir);
	state = advanceStage(state, "/velpari-feasibility", tmpDir);
	state = advanceStage(state, "/velpari-feasibility-approve", tmpDir);
	state = advanceStage(state, "/velpari-architecture-generator", tmpDir);
	state = advanceStage(state, "/velpari-architecture-generator-approve", tmpDir);
	state = advanceStage(state, "/velpari-atomic-function", tmpDir);
	state = advanceStage(state, "/velpari-atomic-function-approve", tmpDir);
	state = advanceStage(state, "/velpari-pseudocode", tmpDir);
	state = advanceStage(state, "/velpari-pseudocode-approve", tmpDir);
	state = advanceStage(state, "/velpari-testplan", tmpDir);
	state = advanceStage(state, "/velpari-testplan-approve", tmpDir);
	state = advanceStage(state, "/velpari-development-order", tmpDir);
	state = advanceStage(state, "/velpari-development-order-approve", tmpDir);
	state = advanceStage(state, "/velpari-final-design", tmpDir);
	assert.strictEqual(state.currentStage, "finalizing-design");
}

function fdWorkingFile(content: string): void {
	const runId = loadState(tmpDir).runId!;
	const dir = join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "final-design");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "final-design_FinalApp.md"), content, "utf8");
}

function fdPublishedPath(): string {
	return join(tmpDir, "Doc", "design", "final-design_FinalApp.md");
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-bump-gate-"));
	// v1.2.1 opt-out for minimal-cwd test fixtures.
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("N27 — bump gate on PRD revisions", () => {
	it("(e) fresh publish without `bump:` publishes (exemption)", async () => {
		enterDraftingPrd(buildPsrs({ version: "1.0.0" }));
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.ok(existsSync(prdPath()), `expected fresh publish; messages: ${allMessages()}`);
		assert.match(allMessages(), /Published to /);
		assert.ok(
			!/bump-missing|bump-invalid|bump-violation|bump-over/.test(allMessages()),
			`fresh publish is bump-exempt; got: ${allMessages()}`,
		);
		assert.equal(loadState(tmpDir).currentStage, "drafted-prd");
	});

	it("(c) revision without a bump is blocked with the exact fix message", async () => {
		enterDraftingPrd(buildPsrs({ version: "1.0.0" }));
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });
		const before = readFileSync(prdPath(), "utf8");

		reenterDraftingPrd(
			buildPsrs({
				version: "1.1.0",
				frRows: FR_TABLE_TWO_ROWS,
				changeLog: "- 2026-09-12 velpari initial draft\n- 2026-09-13 added FR-02 edit expense",
			}),
		);
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.match(allMessages(), /bump-missing/);
		assert.ok(
			allMessages().includes("add `bump: major|minor|patch`"),
			`message must name the exact fix; got: ${allMessages()}`,
		);
		assert.match(allMessages(), /Bump gate blocked the publish/);
		assert.equal(readFileSync(prdPath(), "utf8"), before, "blocked publish writes nothing");
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd", "stage not advanced");
	});

	it("(f) `bump: bogus` is blocked with bump-invalid quoting the value", async () => {
		enterDraftingPrd(buildPsrs({ version: "1.0.0" }));
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		reenterDraftingPrd(
			buildPsrs({
				version: "1.1.0",
				bump: "bogus",
				frRows: FR_TABLE_TWO_ROWS,
				changeLog: "- 2026-09-12 velpari initial draft\n- 2026-09-13 added FR-02 edit expense",
			}),
		);
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.match(allMessages(), /bump-invalid/);
		assert.ok(allMessages().includes("`bump: bogus`"), `must quote the bad value; got: ${allMessages()}`);
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd", "stage not advanced");
	});

	it("(d) revision declaring `bump: minor` while adding an FR publishes and advances", async () => {
		enterDraftingPrd(buildPsrs({ version: "1.0.0" }));
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		reenterDraftingPrd(
			buildPsrs({
				version: "1.1.0",
				bump: "minor",
				frRows: FR_TABLE_TWO_ROWS,
				changeLog: "- 2026-09-12 velpari initial draft\n- 2026-09-13 added FR-02 edit expense",
			}),
		);
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.match(allMessages(), /Published revision of PRD/);
		assert.ok(
			!/bump-missing|bump-invalid|bump-violation|bump-over/.test(allMessages()),
			`no bump complaints for a correctly declared minor; got: ${allMessages()}`,
		);
		const published = readFileSync(prdPath(), "utf8");
		assert.match(published, /version: 1\.1\.0/);
		assert.match(published, /bump: minor/);
		assert.equal(loadState(tmpDir).currentStage, "drafted-prd");
	});

	it("(b) wording-only revision declaring `bump: major` publishes with a bump-over warning", async () => {
		enterDraftingPrd(buildPsrs({ version: "1.0.0" }));
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		reenterDraftingPrd(
			buildPsrs({
				version: "1.1.0",
				bump: "major",
				// Reworded prose only: no id, no heading change → actual PATCH.
				objective: "One paragraph summary of the objective, clarified for readers.",
				changeLog: "- 2026-09-12 velpari initial draft\n- 2026-09-13 clarified the objective wording",
			}),
		);
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.match(allMessages(), /bump-over/);
		assert.match(allMessages(), /Bump gate warnings \(publish allowed\)/);
		assert.match(allMessages(), /Published revision of PRD/);
		assert.equal(loadState(tmpDir).currentStage, "drafted-prd", "over-bump must NOT block");
	});
});

describe("N27 — bump gate decides where the revision gate does not (non-PRD artifact)", () => {
	it("(a) final-design revision removing TC-1 with `bump: patch` → bump-violation naming MAJOR", async () => {
		walkToFinalizing();
		seedFdInputs();

		// Fresh publish (bump-exempt).
		fdWorkingFile(fdFrontmatter("1.0.0") + fdSections());
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });
		assert.ok(existsSync(fdPublishedPath()), `expected fresh publish; messages: ${allMessages()}`);
		assert.equal(loadState(tmpDir).currentStage, "finalized-design");

		// Revision: drops the TC-1 id (→ actual MAJOR) but declares patch.
		saveState({ ...loadState(tmpDir), currentStage: "finalizing-design" }, tmpDir);
		fdWorkingFile(
			fdFrontmatter("1.1.0", "patch") +
				fdSections("- 1.1.0 — dropped the legacy TC-1 contract reference.", true),
		);
		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		assert.match(allMessages(), /bump-violation/);
		assert.ok(allMessages().includes("MAJOR"), `violation must name MAJOR; got: ${allMessages()}`);
		assert.ok(allMessages().includes("TC-1"), `violation must name the removed id; got: ${allMessages()}`);
		assert.match(allMessages(), /Bump gate blocked the publish/);
		assert.equal(
			readFileSync(fdPublishedPath(), "utf8").includes("bump: patch"),
			false,
			"blocked revision must not stamp the published copy",
		);
		assert.equal(loadState(tmpDir).currentStage, "finalizing-design", "stage not advanced");
	});
});
