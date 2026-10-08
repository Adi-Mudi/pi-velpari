/**
 * Approve-surface tests of the Phase-1 revision outcome (N2).
 *
 * The shared notify (velpari_stage_publish tool + the 9 per-stage fall-back
 * commands all funnel through handleApprove) must surface the revision
 * number; supersession arrives as a warning; a refusal leaves the stage
 * unchanged. Mirrors the db-era fixture (real temp git repo, DB-only
 * default mode, skipAutoDoctor for minimal cwds).
 */
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { handleApprove } from "../../src/ops/approve.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";
import { slugify } from "../../src/core/paths.js";
import { setFrozen } from "../../src/io/store.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";

const PROJECT = "Phase1Appr";
const MISSION = "Phase1 approve mission";

let dir: string;
const dirs: string[] = [];
let notices: Array<{ message: string; level: string }> = [];
const savedEnv: Record<string, string | undefined> = {};

/** Notice-capturing ctx (same idiom as test/ops/approve-*.test.ts). */
function makeCtx(): ExtensionCommandContext {
	notices = [];
	return {
		ui: {
			notify: (message: string, level?: string) => {
				notices.push({ message, level: level ?? "info" });
			},
			setStatus: () => {},
		},
	} as unknown as ExtensionCommandContext;
}

/** All notify text joined — assertions on the publish report. */
function noticesText(): string {
	return notices.map((n) => n.message).join("\n");
}

/** The 20 required PSRS section headings (core/psrs.ts REQUIRED_SECTIONS). */
const SECTION_TITLES = [
	"Objective",
	"Problem",
	"System Actors",
	"User Stories",
	"Scope",
	"MVP",
	"Success Metrics",
	"Phases",
	"Functional Requirements",
	"Non-Functional Requirements",
	"Data and Interfaces",
	"Errors and Edge Cases",
	"Constraints",
	"Dependencies and Risks",
	"Out of Scope",
	"Open Questions",
	"Acceptance Criteria",
	"Helper Function Candidates",
	"Glossary",
	"Change Log",
];

/**
 * A PSRS-shaped PRD the stage LLM would write.
 * @param {number} version - Frontmatter version (revisions bump it).
 * @param {string} changeLog - Change Log body lines.
 * @returns {string} The PRD markdown.
 */
function prdMarkdown(version = 1, changeLog = "- 2026-09-27: initial draft.", bump?: string): string {
	const head = [
		"---",
		"documentType: PSRS",
		`version: ${version}`,
		// D-F1 addendum (Phase 4, user-approved): a revision must declare
		// its bump (N27) — the gate was previously inert in DB-only mode,
		// which is the defect itself. v1 (fresh publish) omits it: exempt.
		...(bump ? [`bump: ${bump}`] : []),
		"status: draft",
		"profile: core-psrs-v1",
		"profileVersion: 1",
		`mission: ${MISSION}`,
		`projectName: ${PROJECT}`,
		"---",
		"",
		`# PRD — ${PROJECT}`,
		"",
	];
	const body = SECTION_TITLES.map((title) => {
		if (title === "Functional Requirements") {
			return [
				"## Functional Requirements",
				"",
				"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
				"|---|---|---|---|---|---|---|",
				"| FR-01 | The system SHALL accept text input. | must | 1 | input stored | Integration test | proposed |",
				"",
			].join("\n");
		}
		if (title === "Non-Functional Requirements") {
			return [
				"## Non-Functional Requirements",
				"",
				"| ID | Category | Requirement | Phase | Verification | Status |",
				"|---|---|---|---|---|---|---|",
				"| NFR-01 | performance | p95 SHALL stay under 200 ms. | 1 | Performance test | proposed |",
				"",
			].join("\n");
		}
		if (title === "Change Log") return `## Change Log\n\n${changeLog}\n`;
		return `## ${title}\n\nProse for the ${title} section of the requirements package.\n`;
	});
	return [...head, ...body].join("\n");
}

/** Payload rows matching the fixture PRD (DB rows are the publish source). */
function payloadRows() {
	return {
		fr: [{ id: "FR-01", phase: 1, textHash: "a".repeat(64), text: "The system shall accept text input." }],
		nfr: [{ id: "NFR-01", phase: 1, textHash: "b".repeat(64), text: "p95 latency shall stay under 200 ms." }],
		prdSection: SECTION_TITLES.map((title, i) => ({ no: i + 1, title, body: `Prose for ${title}.` })),
	};
}

/**
 * Build a fixture project parked at `drafting-prd`: valid PRD working copy +
 * payload, published brainstorm input, real git repo (identity pinned).
 * @returns {{cwd: string, runId: string, workingCopy: string, payloadPath: string}} Fixture handles.
 */
function buildFixture(): { runId: string; workingCopy: string; payloadPath: string } {
	const cwd = dir;
	const filesJson = {
		version: 4,
		projectName: PROJECT,
		framework: { language: "typescript", runtime: "node" },
		inputDocuments: [],
		outputPaths: {},
		codePaths: [],
		testPaths: [],
		excludedPaths: [],
	};
	const write = (rel: string, content: string): string => {
		const abs = join(cwd, rel);
		mkdirSync(join(abs, ".."), { recursive: true });
		writeFileSync(abs, content, "utf8");
		return abs;
	};

	write(".pi/velpari/files.json", JSON.stringify(filesJson, null, 2) + "\n");
	const run = createRun(MISSION, cwd);
	saveState({ ...run, currentStage: "drafting-prd" }, cwd);
	const runId = loadState(cwd).runId!;

	write(`Doc/brainstorm/brainstorm-${slugify(MISSION)}.md`, "# Brainstorm\n\nPhase 1 approve fixture topic.\n");

	const runDir = join(".IDE_Plans", "velpari", "runs", runId);
	const workingCopy = write(join(runDir, "prd", `PRD_${PROJECT}.md`), prdMarkdown(1));
	const payloadPath = write(
		join(runDir, "prd", "payload", "prd-payload.json"),
		JSON.stringify(
			{
				envelope: {
					version: 1,
					stage: "drafting-prd",
					generatedAt: "2026-09-27T00:00:00.000Z",
					inputs: {},
					reviewerVerdict: null,
					changeLog: ["2026-09-27: phase 1 approve fixture publish."],
				},
				rows: payloadRows(),
			},
			null,
			2,
		) + "\n",
	);

	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["config", "user.name", "Velpari Phase1"], { cwd });
	execFileSync("git", ["config", "user.email", "phase1@velpari.local"], { cwd });
	const gitConfigGlobal = join(cwd, "gitconfig-global");
	writeFileSync(gitConfigGlobal, "[user]\n\tname = Velpari Phase1\n\temail = phase1@velpari.local\n", "utf8");
	savedEnv.GIT_CONFIG_GLOBAL = process.env.GIT_CONFIG_GLOBAL;
	savedEnv.GIT_CONFIG_SYSTEM = process.env.GIT_CONFIG_SYSTEM;
	savedEnv.GIT_CONFIG_NOSYSTEM = process.env.GIT_CONFIG_NOSYSTEM;
	process.env.GIT_CONFIG_GLOBAL = gitConfigGlobal;
	process.env.GIT_CONFIG_SYSTEM = "/dev/null";
	process.env.GIT_CONFIG_NOSYSTEM = "1";

	return { runId, workingCopy, payloadPath };
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "velpari-phase1-approve-"));
	dirs.push(dir);
	delete process.env.VELPARI_SKIP_DB_PUBLISH;
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

after(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	for (const key of Object.keys(savedEnv)) {
		const before = savedEnv[key];
		if (before === undefined) delete process.env[key];
		else process.env[key] = before;
	}
});

describe("Phase 1 approve surface — revision outcome (N2)", () => {
	test("success notify names revision 1; stage advances", async () => {
		buildFixture();
		await handleApprove(makeCtx(), undefined, dir, { skipAutoDoctor: true });

		assert.equal(loadState(dir).currentStage, "drafted-prd", `publish must advance; notices:\n${noticesText()}`);
		assert.match(noticesText(), /published as revision 1/, `the notify must name the revision:\n${noticesText()}`);
	});

	test("republish notify names revision 2 and the supersession warning surfaces", async () => {
		const fx = buildFixture();
		await handleApprove(makeCtx(), undefined, dir, { skipAutoDoctor: true });
		assert.equal(loadState(dir).currentStage, "drafted-prd");

		// Re-arm: back to drafting-prd with a v2 working copy + payload.
		const state = loadState(dir);
		saveState({ ...state, currentStage: "drafting-prd" }, dir);
		const runDir = join(dir, ".IDE_Plans", "velpari", "runs", fx.runId);
		writeFileSync(
			join(runDir, "prd", `PRD_${PROJECT}.md`),
			prdMarkdown(2, "- 2026-09-27: revision 2 changes.", "patch"),
			"utf8",
		);
		writeFileSync(
			join(runDir, "prd", "payload", "prd-payload.json"),
			JSON.stringify(
				{
					envelope: {
						version: 2,
						stage: "drafting-prd",
						generatedAt: "2026-09-27T00:00:00.000Z",
						inputs: {},
						reviewerVerdict: null,
						changeLog: ["2026-09-27: phase 1 approve fixture publish v2."],
					},
					rows: payloadRows(),
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		notices = [];
		await handleApprove(makeCtx(), undefined, dir, { skipAutoDoctor: true });

		assert.equal(loadState(dir).currentStage, "drafted-prd", `republish must advance:\n${noticesText()}`);
		assert.match(noticesText(), /published as revision 2/, `notify names revision 2:\n${noticesText()}`);
		assert.match(
			noticesText(),
			/Superseded prd revision 1; head is now revision 2\./,
			`supersession surfaces as a warning:\n${noticesText()}`,
		);
	});

	test("frozen refusal: notify fires, stage does NOT advance", async () => {
		const fx = buildFixture();
		await handleApprove(makeCtx(), undefined, dir, { skipAutoDoctor: true });
		assert.equal(loadState(dir).currentStage, "drafted-prd");

		// Freeze the published chain, then re-arm a revision attempt.
		const db = openStoreDb(join(dir, "Doc", "store", PROJECT, "index.db"));
		try {
			setFrozen(db, fx.runId, "prd", true, "hold for review");
		} finally {
			closeStoreDb(db);
		}
		const state = loadState(dir);
		saveState({ ...state, currentStage: "drafting-prd" }, dir);
		const runDir = join(dir, ".IDE_Plans", "velpari", "runs", fx.runId);
		writeFileSync(join(runDir, "prd", `PRD_${PROJECT}.md`), prdMarkdown(2, "- 2026-09-27: revision 2 changes.", "patch"), "utf8");
		writeFileSync(
			join(runDir, "prd", "payload", "prd-payload.json"),
			JSON.stringify(
				{
					envelope: {
						version: 2,
						stage: "drafting-prd",
						generatedAt: "2026-09-27T00:00:00.000Z",
						inputs: {},
						reviewerVerdict: null,
						changeLog: ["2026-09-27: phase 1 approve fixture publish v2."],
					},
					rows: payloadRows(),
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		notices = [];
		await handleApprove(makeCtx(), undefined, dir, { skipAutoDoctor: true });

		assert.match(noticesText(), /is frozen/, `the frozen refusal must surface:\n${noticesText()}`);
		assert.equal(loadState(dir).currentStage, "drafting-prd", "a refused publish must NOT advance");
	});
});
