/**
 * Handoff execution-lanes block (Phase 7 / N16 — subphase 7.8.2).
 *
 * Covers:
 *   (a) published dev-order WITH lanes ⇒ payload.lanes carries every
 *       lane, the integration plan in merge order, the lock rules, and
 *       the name-match pair (worktree === branch) everywhere;
 *   (b) published dev-order WITHOUT lanes ⇒ no `lanes` key at all —
 *       the payload's key set is exactly the legacy shape;
 *   (c) malformed store rows ⇒ section omitted + warning notified
 *       (handoff never hard-fails on a store oddity the doctor reports);
 *   (d) validateSenaiSchema still returns true with the new key.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLanesSection, runHandoff, validateSenaiSchema } from "../../src/ops/handoff.js";
import { LANE_LOCK_RULES, LANE_MERGE_GATES } from "../../src/core/dev-lanes.js";
import { loadState, saveState, type RunState } from "../../src/core/state.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";

const PROJECT = "PrimaryApp";
const RUN = "r";
const KIND = "development-order";

let cwd: string;

/**
 * Write a run state at `finalized-design` (handoff-eligible) into the temp cwd.
 * @param {Partial<RunState>} [patch] - Field overrides merged over the default run.
 * @returns {void}
 */
function seedState(patch: Partial<RunState> = {}): void {
	const state: RunState = {
		version: 1,
		runId: RUN,
		mission: "m",
		currentStage: "finalized-design",
		history: [],
		updatedAt: new Date().toISOString(),
		...patch,
	};
	saveState(state, cwd);
}

/**
 * Write a minimal files.json v4 config (projectName + path groups) for the temp cwd.
 * @returns {void}
 */
function seedConfig(): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "velpari", "files.json"),
		JSON.stringify({
			version: 4,
			projectName: PROJECT,
			codePaths: ["src/"],
			testPaths: ["test/"],
			docPaths: ["Doc/"],
			excludedPaths: [],
		}),
	);
}

/**
 * Create every grouped Doc/ directory and stub artifact /velpari-handoff requires.
 * @returns {void}
 */
function seedAllRequiredDocs(): void {
	mkdirSync(join(cwd, "Doc", "requirements"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "feasibility"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "design"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "atomic-functions"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "pseudocode"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "tests"), { recursive: true });
	mkdirSync(join(cwd, "Doc", "development-order"), { recursive: true });

	const stub = "## section\n\nbody";
	writeFileSync(join(cwd, "Doc", "requirements", `PRD_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "requirements", `RTM_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "feasibility", `feasibility-study_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "design", `design_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "atomic-functions", `atomic-functions_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "pseudocode", `pseudocode_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "tests", `test-plan_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "tests", `test-cases_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "development-order", `development-order_${PROJECT}.md`), stub);
	writeFileSync(join(cwd, "Doc", "design", `final-design_${PROJECT}.md`), stub);
}

interface LaneSeed {
	laneId: string;
	stepId: string;
	position: number;
	worktree: string;
	branch: string;
	status?: string;
}

/** 4 steps / 2 lanes / 1 cross-lane integration point (the worked example). */
function seedDevOrderStore(opts: { withLanes: boolean; lanes?: LaneSeed[] }): void {
	const db = openStoreDb(buildStoreDbPath(PROJECT, cwd));
	try {
		db.prepare(
			`INSERT INTO artifacts
			 (run_id, kind, version, stage, generated_at, sha256_fingerprint, inputs, change_log, status)
			 VALUES (?, ?, 1, 'ordering-development', '2026-09-27T00:00:00Z', 'f', '{}', '[]', 'published')`,
		).run(RUN, KIND);
		const steps: Array<[string, string]> = [
			["DO-1", "auth"],
			["DO-2", "db"],
			["DO-3", "api"],
			["DO-4", "web"],
		];
		const stepStmt = db.prepare("INSERT INTO dev_step (run_id, kind, id, module) VALUES (?, ?, ?, ?)");
		for (const [id, module] of steps) stepStmt.run(RUN, KIND, id, module);
		const depStmt = db.prepare("INSERT INTO step_dep (run_id, kind, step_id, depends_on_id) VALUES (?, ?, ?, ?)");
		depStmt.run(RUN, KIND, "DO-3", "DO-1");
		depStmt.run(RUN, KIND, "DO-3", "DO-2");
		depStmt.run(RUN, KIND, "DO-4", "DO-3");
		if (opts.withLanes) {
			const laneStmt = db.prepare(
				`INSERT INTO dev_lane (run_id, kind, lane_id, step_id, position, worktree, branch, status)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const l of opts.lanes ?? defaultLanes()) {
				laneStmt.run(RUN, KIND, l.laneId, l.stepId, l.position, l.worktree, l.branch, l.status ?? "active");
			}
			db.prepare(
				`INSERT INTO dev_lane_xdep (run_id, kind, step_id, depends_on_id, boundary_level)
				 VALUES (?, ?, ?, ?, ?)`,
			).run(RUN, KIND, "DO-3", "DO-2", 1);
		}
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Build the default two-lane execution-lane seed rows (lane-1: DO-1/DO-3, lane-2: DO-2).
 * @returns {LaneSeed[]} Lane rows ready for seeding the dev-order store.
 */
function defaultLanes(): LaneSeed[] {
	return [
		{
			laneId: "lane-1",
			stepId: "DO-1",
			position: 0,
			worktree: "primaryapp/lane-1-auth",
			branch: "primaryapp/lane-1-auth",
			status: "active",
		},
		{
			laneId: "lane-1",
			stepId: "DO-3",
			position: 1,
			worktree: "primaryapp/lane-1-auth",
			branch: "primaryapp/lane-1-auth",
			status: "active",
		},
		{
			laneId: "lane-1",
			stepId: "DO-4",
			position: 2,
			worktree: "primaryapp/lane-1-auth",
			branch: "primaryapp/lane-1-auth",
			status: "active",
		},
		{
			laneId: "lane-2",
			stepId: "DO-2",
			position: 0,
			worktree: "primaryapp/lane-2-db",
			branch: "primaryapp/lane-2-db",
			status: "active",
		},
	];
}

/**
 * Build a mock command context that records every notify call.
 * @returns {{ ui: {...}; notices: Array<{ msg: string; level: string }> }} Context whose ui.notify appends to `notices` and whose confirm always accepts.
 */
function makeCtx(): {
	ui: {
		notify: (msg: string, level: string) => void;
		setStatus: (k: string, t?: string) => void;
		confirm: (t: string, m: string) => Promise<boolean>;
	};
	notices: Array<{ msg: string; level: string }>;
} {
	const notices: Array<{ msg: string; level: string }> = [];
	return {
		notices,
		ui: {
			notify: (msg: string, level: string) => {
				notices.push({ msg, level });
			},
			setStatus: () => {},
			confirm: async () => true,
		},
	};
}

/**
 * Parse the handoff payload written by /velpari-handoff.
 * @returns {Record<string, unknown>} Parsed architect-inputs.json contents (asserts the file exists first).
 */
function readPayload(): Record<string, unknown> {
	const payloadPath = join(cwd, ".pi", "senai", "architect-inputs.json");
	assert.ok(existsSync(payloadPath), "architect-inputs.json should exist");
	return JSON.parse(readFileSync(payloadPath, "utf8")) as Record<string, unknown>;
}

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "vp-handoff-lanes-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("runHandoff — execution lanes block", () => {
	it("(a) published dev-order with lanes → payload.lanes (lanes + merge order + lock rules, name-match)", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedDevOrderStore({ withLanes: true });

		const ctx = makeCtx();
		await runHandoff(loadState(cwd), ctx as never, cwd);
		const payload = readPayload();

		const lanes = payload.lanes as Record<string, unknown> | undefined;
		assert.ok(lanes, "lanes block should exist");

		const laneRows = lanes.lanes as Array<Record<string, unknown>>;
		assert.equal(laneRows.length, 2);
		assert.deepEqual(
			laneRows.map((l) => l.laneId),
			["lane-1", "lane-2"],
		);
		assert.deepEqual(laneRows[0]?.steps, ["DO-1", "DO-3", "DO-4"]);
		assert.deepEqual(laneRows[1]?.steps, ["DO-2"]);
		for (const lane of laneRows) {
			assert.equal(lane.worktree, lane.branch, "name-match: worktree === branch");
			assert.equal(lane.status, "active");
		}

		const plan = lanes.integrationPlan as Array<Record<string, unknown>>;
		assert.equal(plan.length, 2);
		// Merge order: lane-2 feeds lane-1's level-1 boundary first; lane-1
		// has no outgoing edges, so it merges at ownMax + 1 (terminal lane).
		assert.deepEqual(
			plan.map((e) => [e.order, e.laneId, e.mergeLevel]),
			[
				[1, "lane-2", 1],
				[2, "lane-1", 3],
			],
		);
		for (const entry of plan) {
			assert.deepEqual(entry.gates, [...LANE_MERGE_GATES]);
			assert.equal(typeof entry.preMerge, "string");
			assert.ok((entry.preMerge as string).length > 0);
		}

		assert.deepEqual(lanes.lockRules, [...LANE_LOCK_RULES]);
		assert.deepEqual(lanes.shape, ["parallel", "series", "series"]);
	});

	it("(b) published dev-order without lanes → no lanes key (legacy payload shape)", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedDevOrderStore({ withLanes: false });

		const ctx = makeCtx();
		await runHandoff(loadState(cwd), ctx as never, cwd);
		const payload = readPayload();

		assert.equal(Object.hasOwn(payload, "lanes"), false);
		assert.deepEqual(Object.keys(payload).sort(), [
			"_comment",
			"architectureDecisions",
			"createdAt",
			"documents",
			"mission",
			"projectName",
			"standardsProfile",
			"version",
		]);
		assert.equal(JSON.stringify(payload).includes('"lanes"'), false);
		// No lane problem to warn about — legacy is silent.
		assert.equal(ctx.notices.filter((n) => n.msg.includes("Execution lanes omitted")).length, 0);
	});

	it("(c) malformed store rows → section omitted + warning notified", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		// name-match violation: lane-1 rows carry branch ≠ worktree.
		const lanes = defaultLanes().map((l) => (l.laneId === "lane-1" ? { ...l, branch: "primaryapp/lane-1-other" } : l));
		seedDevOrderStore({ withLanes: true, lanes });

		const ctx = makeCtx();
		await runHandoff(loadState(cwd), ctx as never, cwd);
		const payload = readPayload();

		assert.equal(Object.hasOwn(payload, "lanes"), false, "malformed lanes must be omitted");
		const warnings = ctx.notices.filter((n) => n.level === "warning" && n.msg.includes("Execution lanes omitted"));
		assert.equal(warnings.length, 1);
		assert.match(warnings[0]?.msg ?? "", /name-match/);
	});

	it("(d) validateSenaiSchema still returns true with the lanes key", async () => {
		seedState();
		seedConfig();
		seedAllRequiredDocs();
		seedDevOrderStore({ withLanes: true });

		const { section } = buildLanesSection(loadState(cwd), PROJECT, cwd);
		assert.ok(section, "builder should produce a section for the clean fixture");

		const candidate = {
			version: 1,
			projectName: PROJECT,
			createdAt: new Date().toISOString(),
			mission: "m",
			documents: [],
			architectureDecisions: [],
			standardsProfile: null,
			lanes: section,
		};
		assert.equal(validateSenaiSchema(candidate), true);
	});
});
