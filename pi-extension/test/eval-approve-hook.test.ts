// Tests — ops/approve.ts eval recording hook (velpari-evals Phase A, Lane A1.6).
// Covers: a successful publish writes exactly one eval row (with the right
// stage/artifact/model + gate-derived DetScores), the first-create notice +
// `.gitignore` heal, fail-open when the Eval path is unwritable, and the
// notice NOT firing when the eval DB already exists.

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { handleApprove } from "../src/ops/approve.js";
import { createRun, loadState, saveState } from "../src/core/state.js";
import { buildRunDir, evalDbPath } from "../src/core/paths.js";
import { blendTotal, computeTotalScore } from "../src/core/eval.js";
import { closeStoreDb, listEvalRows, openEvalDb } from "../src/io/db.js";

interface Notice {
	message: string;
	level: string;
}

let tmpDir: string;
let notices: Notice[];

/** Minimal ExtensionCommandContext with a notice-capturing ui. */
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

const PSRS = [
	"# PSRS",
	"",
	"## Functional Requirements",
	"",
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|---|",
	"| FR-01 | When a user submits an expense, the system SHALL save it | must | 1 | expense saved | Integration test | proposed |",
	"",
].join("\n");

/** Minimal valid RTM JSON sidecar. */
function rtmJson(): string {
	return JSON.stringify({
		project: "TestApp",
		version: "1.0.0",
		rows: [
			{
				id: "FR-01",
				title: "FR-01 title",
				phase: 1,
				design: "",
				implementation: "",
				tests: [],
				status: "proposed",
				coverage: "covered",
			},
		],
	});
}

/** Place the fixture repo at building-rtm with a published PRD + RTM working copy. */
function enterBuildingRtm(): void {
	const run = createRun("TestApp", tmpDir);
	saveState({ ...run, currentStage: "building-rtm" }, tmpDir);
	const docDir = path.join(tmpDir, "Doc", "requirements");
	fs.mkdirSync(docDir, { recursive: true });
	fs.writeFileSync(path.join(docDir, "PRD_TestApp.md"), PSRS, "utf8");
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", loadState(tmpDir).runId, "rtm");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "RTM_TestApp.md"), "# RTM preview\n", "utf8");
	fs.writeFileSync(path.join(dir, "RTM_TestApp.json"), rtmJson(), "utf8");
}

/** Pseudocode rubric criterion ids (mirrors skills/eval-rubrics/pseudocode.yaml). */
const PSEUDOCODE_RUBRIC_IDS = [
	"per-atomic-function-coverage",
	"algorithmic-completeness",
	"complexity-within-tier-limit",
	"edge-case-and-error-handling",
	"dependency-acyclic",
	"cross-scout-consistency",
	"standards-traceability",
];

/**
 * Place the fixture repo at `writing-pseudocode` with a working copy AND a
 * reviewer report whose payload carries a valid `scores` block (advanced tier
 * so the reviewer verdict is required).
 */
function enterWritingPseudocode(): void {
	const run = createRun("TestApp", tmpDir);
	saveState({ ...run, currentStage: "writing-pseudocode" }, tmpDir);
	const runId = loadState(tmpDir).runId;

	const metaDir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(metaDir, { recursive: true });
	fs.writeFileSync(
		path.join(metaDir, "files.json"),
		JSON.stringify({
			version: 4,
			framework: { language: "typescript" },
			projectName: "TestApp",
			codePaths: ["src/**/*.ts"],
			testPaths: ["test/**/*.test.ts"],
			documentPaths: ["Doc/**/*.md"],
			excludedPaths: ["node_modules/**"],
			atomic: { tier: "advanced" },
		}),
		"utf8",
	);

	// Both the declared upstream inputs (B4 freshness) and the publish gate
	// resolve these legacy flat paths.
	const docDir = path.join(tmpDir, "Doc");
	fs.mkdirSync(docDir, { recursive: true });
	for (const a of ["PRD", "RTM", "feasibility-study", "design", "atomic-functions"]) {
		fs.writeFileSync(path.join(docDir, `${a}_TestApp.md`), `# ${a}\n`, "utf8");
	}

	const workingDir = path.join(buildRunDir(runId, tmpDir), "pseudocode");
	fs.mkdirSync(workingDir, { recursive: true });
	fs.writeFileSync(
		path.join(workingDir, "pseudocode_TestApp.md"),
		"---\nartifact: pseudocode\nversion: 1.0.0\n---\n# fixture\n",
		"utf8",
	);

	const scoutsDir = path.join(workingDir, "scouts");
	fs.mkdirSync(scoutsDir, { recursive: true });
	const scores = {
		rubricId: "pseudocode",
		rubricVersion: 1,
		rubricHash: "0123456789abcdef",
		judgeModel: "test/judge-model",
		criteria: PSEUDOCODE_RUBRIC_IDS.map((id) => ({ id, score: 1 })),
		overall: 1,
	};
	fs.writeFileSync(
		path.join(scoutsDir, "pseudocode-reviewer-report.json"),
		JSON.stringify(
			{ verdict: "approve", issues: [], summary: "fixture", timestamp: new Date().toISOString(), scores },
			null,
			2,
		),
		"utf8",
	);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-eval-hook-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("publish → eval recording (Phase A)", () => {
	it("records exactly one eval row on a successful publish", async () => {
		enterBuildingRtm();

		await handleApprove(makeCtx(), undefined, tmpDir, { skipAutoDoctor: true, skipDbPublish: true });

		// Publish still advanced.
		assert.equal(loadState(tmpDir).currentStage, "built-rtm");

		const dbPath = evalDbPath(tmpDir, "TestApp");
		assert.equal(fs.existsSync(dbPath), true, "eval DB must exist after publish");

		const db = openEvalDb(dbPath);
		try {
			const rows = listEvalRows(db, "TestApp");
			assert.equal(rows.length, 1);
			const row = rows[0]!;
			assert.equal(row.project, "TestApp");
			assert.equal(row.stage, "building-rtm", "the stage that RAN (in-progress enum)");
			assert.equal(row.artifactKind, "RTM");
			assert.equal(row.model, "unknown", "no ctx.model in the test harness");
			assert.equal(row.judgeScores, null, "RTM is not a reviewer stage → deterministic-only row");
			assert.match(row.detConfigHash, /^[0-9a-f]{16}$/);
			assert.equal(typeof row.totalScore, "number");
			assert.ok(row.attempts === null || row.attempts >= 1);
			// skipAutoDoctor → the only DetScore is the publish-gate aggregate.
			assert.deepEqual(
				row.detScores.map((s) => s.name),
				["publish-gate"],
			);
			assert.equal(row.totalScore > 0 && row.totalScore <= 1, true, `total in (0,1], got ${row.totalScore}`);
		} finally {
			closeStoreDb(db);
		}
	});

	it("announces quality tracking + heals .gitignore on first create", async () => {
		enterBuildingRtm();

		await handleApprove(makeCtx(), undefined, tmpDir, { skipAutoDoctor: true, skipDbPublish: true });

		assert.ok(
			notices.some((n) => /Quality tracking on/.test(n.message)),
			"first-create notice fires",
		);
		const gitignorePath = path.join(tmpDir, ".gitignore");
		assert.equal(fs.existsSync(gitignorePath), true);
		assert.match(fs.readFileSync(gitignorePath, "utf8"), /^Eval\/$/m);
	});

	it("does NOT announce first-create when the eval DB already exists", async () => {
		enterBuildingRtm();
		// Pre-create the eval DB so this publish is not a first create.
		const db = openEvalDb(evalDbPath(tmpDir, "TestApp"));
		closeStoreDb(db);

		await handleApprove(makeCtx(), undefined, tmpDir, { skipAutoDoctor: true, skipDbPublish: true });

		assert.equal(
			notices.filter((n) => /Quality tracking on/.test(n.message)).length,
			0,
			"no first-create notice when the DB pre-exists",
		);
		const check = openEvalDb(evalDbPath(tmpDir, "TestApp"));
		try {
			assert.equal(listEvalRows(check, "TestApp").length, 1);
		} finally {
			closeStoreDb(check);
		}
	});

	it("fails open when the Eval path is unwritable (publish still advances)", async () => {
		enterBuildingRtm();
		// Make `Eval` a FILE so `mkdirSync(<tmp>/Eval/TestApp)` must throw.
		fs.writeFileSync(path.join(tmpDir, "Eval"), "not a directory", "utf8");

		await handleApprove(makeCtx(), undefined, tmpDir, { skipAutoDoctor: true, skipDbPublish: true });

		assert.equal(loadState(tmpDir).currentStage, "built-rtm", "advance must not be blocked");
		assert.ok(
			notices.some((n) => /eval recording skipped/.test(n.message)),
			"a notice reports the swallowed eval error",
		);
	});
});

describe("publish → judge scores (Phase B)", () => {
	it("reviewer-stage publish stores the report's scores block + blends the total", async () => {
		enterWritingPseudocode();

		await handleApprove(makeCtx(), undefined, tmpDir, { skipAutoDoctor: true, skipDbPublish: true });

		assert.equal(loadState(tmpDir).currentStage, "wrote-pseudocode", "pseudocode publish advanced");

		const db = openEvalDb(evalDbPath(tmpDir, "TestApp"));
		try {
			const rows = listEvalRows(db, "TestApp");
			assert.equal(rows.length, 1);
			const row = rows[0]!;
			assert.ok(row.judgeScores, "reviewer-stage publish must store judge scores");
			assert.equal(row.judgeScores?.rubricId, "pseudocode");
			assert.equal(row.judgeScores?.judgeModel, "test/judge-model");
			assert.equal(row.judgeScores?.overall, 1);
			assert.equal(row.judgeScores?.criteria.length, PSEUDOCODE_RUBRIC_IDS.length);
			assert.equal(row.judgeScores?.note, undefined, "matching recompute → no mismatch note");
			const detTotal = computeTotalScore(row.detScores);
			assert.ok(
				Math.abs(row.totalScore - blendTotal(detTotal, 1)) < 1e-9,
				"total must be the 50/50 blend of det total and judge overall",
			);
		} finally {
			closeStoreDb(db);
		}
	});

	it("fails open (judge_scores NULL) when the reviewer report carries no scores block", async () => {
		enterWritingPseudocode();
		// Keep a valid approve verdict (so the advanced-tier gate passes) but
		// drop the scores block — the row must degrade to deterministic-only.
		fs.writeFileSync(
			path.join(
				buildRunDir(loadState(tmpDir).runId, tmpDir),
				"pseudocode",
				"scouts",
				"pseudocode-reviewer-report.json",
			),
			JSON.stringify({ verdict: "approve", issues: [], summary: "fixture", timestamp: new Date().toISOString() }),
			"utf8",
		);

		await handleApprove(makeCtx(), undefined, tmpDir, { skipAutoDoctor: true, skipDbPublish: true });

		assert.equal(loadState(tmpDir).currentStage, "wrote-pseudocode");
		const db = openEvalDb(evalDbPath(tmpDir, "TestApp"));
		try {
			const row = listEvalRows(db, "TestApp")[0]!;
			assert.equal(row.judgeScores, null, "no report → deterministic-only row");
			assert.equal(row.totalScore, computeTotalScore(row.detScores));
		} finally {
			closeStoreDb(db);
		}
	});
});
