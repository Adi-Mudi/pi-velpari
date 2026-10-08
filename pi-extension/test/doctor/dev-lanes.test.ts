/**
 * Execution-lane integrity tests (Phase 7 / 7.7.3 — planted violations).
 *
 * Covers the plan's 10 cases against the store: clean fixture, step in
 * two lanes, step in no lane, cross-lane dep without an integration
 * point, wrong boundary level, dependency cycle, legacy no-lane
 * artifact, no published artifact, worktree ≠ branch (name-match), and
 * the summarize() hard-block proof (ok flips false exactly on error).
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import { buildStoreDbPath } from "../../src/core/paths.js";
import { checkDevLanesSection } from "../../src/doctor/checks/dev-lanes.js";
import { summarize } from "../../src/doctor/_types.js";

const PROJECT = "TodoApp";
const RUN = "run-lanes-1";
const KIND = "development-order";

let dirs: string[] = [];
let cwd = "";

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-dev-lanes-"));
	dirs.push(dir);
	cwd = dir;
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function seedConfig(): void {
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: PROJECT }),
		"utf8",
	);
}

interface StepSeed {
	id: string;
	module: string;
}
interface DepSeed {
	stepId: string;
	dependsOnId: string;
}
interface LaneSeed {
	laneId: string;
	stepId: string;
	position: number;
	worktree: string;
	branch: string;
	status?: string;
}
interface XdepSeed {
	stepId: string;
	dependsOnId: string;
	boundaryLevel: number;
}
interface Fixture {
	steps: StepSeed[];
	deps: DepSeed[];
	lanes?: LaneSeed[];
	xdeps?: XdepSeed[];
	withEnvelope?: boolean;
}

/** The plan's worked example, 4 steps / 2 lanes / 1 integration point. */
function cleanFixture(): Fixture {
	return {
		steps: [
			{ id: "DO-1", module: "auth" },
			{ id: "DO-2", module: "db" },
			{ id: "DO-3", module: "api" },
			{ id: "DO-4", module: "web" },
		],
		deps: [
			{ stepId: "DO-3", dependsOnId: "DO-1" },
			{ stepId: "DO-3", dependsOnId: "DO-2" },
			{ stepId: "DO-4", dependsOnId: "DO-3" },
		],
		lanes: [
			{
				laneId: "lane-1",
				stepId: "DO-1",
				position: 0,
				worktree: "todoapp/lane-1-auth",
				branch: "todoapp/lane-1-auth",
				status: "active",
			},
			{
				laneId: "lane-1",
				stepId: "DO-3",
				position: 1,
				worktree: "todoapp/lane-1-auth",
				branch: "todoapp/lane-1-auth",
				status: "active",
			},
			{
				laneId: "lane-1",
				stepId: "DO-4",
				position: 2,
				worktree: "todoapp/lane-1-auth",
				branch: "todoapp/lane-1-auth",
				status: "active",
			},
			{
				laneId: "lane-2",
				stepId: "DO-2",
				position: 0,
				worktree: "todoapp/lane-2-db",
				branch: "todoapp/lane-2-db",
				status: "active",
			},
		],
		xdeps: [{ stepId: "DO-3", dependsOnId: "DO-2", boundaryLevel: 1 }],
	};
}

function seedStore(fixture: Fixture): void {
	const db = openStoreDb(buildStoreDbPath(PROJECT, cwd));
	try {
		db.prepare(
			`INSERT INTO artifacts
			 (run_id, kind, version, stage, generated_at, sha256_fingerprint, inputs, change_log, status)
			 VALUES (?, ?, 1, 'ordering-development', '2026-09-27T00:00:00Z', 'f', '{}', '[]', 'published')`,
		).run(RUN, KIND);
		const stepStmt = db.prepare("INSERT INTO dev_step (run_id, kind, id, module) VALUES (?, ?, ?, ?)");
		for (const s of fixture.steps) stepStmt.run(RUN, KIND, s.id, s.module);
		const depStmt = db.prepare("INSERT INTO step_dep (run_id, kind, step_id, depends_on_id) VALUES (?, ?, ?, ?)");
		for (const d of fixture.deps) depStmt.run(RUN, KIND, d.stepId, d.dependsOnId);
		const laneStmt = db.prepare(
			`INSERT INTO dev_lane (run_id, kind, lane_id, step_id, position, worktree, branch, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		for (const l of fixture.lanes ?? []) {
			laneStmt.run(RUN, KIND, l.laneId, l.stepId, l.position, l.worktree, l.branch, l.status ?? "active");
		}
		const xStmt = db.prepare(
			`INSERT INTO dev_lane_xdep (run_id, kind, step_id, depends_on_id, boundary_level)
			 VALUES (?, ?, ?, ?, ?)`,
		);
		for (const x of fixture.xdeps ?? []) xStmt.run(RUN, KIND, x.stepId, x.dependsOnId, x.boundaryLevel);
	} finally {
		closeStoreDb(db);
	}
}

function errorsOf(section: ReturnType<typeof checkDevLanesSection>): Array<{ message: string }> {
	return section.items.filter((i) => i.status === "error").map((i) => ({ message: i.message }));
}

describe("checkDevLanesSection", () => {
	test("1. clean fixture → one ok item, zero errors (N lane(s), M step(s), shape)", () => {
		seedConfig();
		seedStore(cleanFixture());
		const section = checkDevLanesSection(cwd, PROJECT);
		assert.equal(section.title, "Execution lanes");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.equal(section.items[0]?.message, "2 lane(s), 4 step(s), shape parallel→series→series");
		assert.equal(summarize([section]).summary.error, 0);
		assert.equal(summarize([section]).ok, true);
	});

	test("2. step in two lanes → error naming the step and both lanes", () => {
		seedConfig();
		const fixture = cleanFixture();
		fixture.lanes?.push({
			laneId: "lane-2",
			stepId: "DO-1",
			position: 1,
			worktree: "todoapp/lane-2-db",
			branch: "todoapp/lane-2-db",
			status: "active",
		});
		seedStore(fixture);
		const errors = errorsOf(checkDevLanesSection(cwd, PROJECT));
		assert.equal(errors.length, 1);
		const msg = errors[0]?.message ?? "";
		assert.match(msg, /^step-in-two-lanes:/);
		assert.match(msg, /"DO-1"/);
		assert.match(msg, /lane-1/);
		assert.match(msg, /lane-2/);
	});

	test("3. step in no lane → error naming the step", () => {
		seedConfig();
		const fixture = cleanFixture();
		fixture.lanes = fixture.lanes?.filter((l) => l.stepId !== "DO-1");
		seedStore(fixture);
		const errors = errorsOf(checkDevLanesSection(cwd, PROJECT));
		assert.equal(errors.length, 1);
		assert.match(errors[0]?.message ?? "", /^step-missing-from-lane: step "DO-1" is in no lane$/);
	});

	test("4. cross-lane dep without dev_lane_xdep row → error naming the edge", () => {
		seedConfig();
		const fixture = cleanFixture();
		fixture.xdeps = [];
		seedStore(fixture);
		const errors = errorsOf(checkDevLanesSection(cwd, PROJECT));
		assert.equal(errors.length, 1);
		assert.equal(errors[0]?.message, "cross-lane dependency DO-3 → DO-2 has no recorded integration point");
	});

	test("5. wrong boundary_level → error (bad-boundary semantics)", () => {
		seedConfig();
		const fixture = cleanFixture();
		fixture.xdeps = [{ stepId: "DO-3", dependsOnId: "DO-2", boundaryLevel: 99 }];
		seedStore(fixture);
		const errors = errorsOf(checkDevLanesSection(cwd, PROJECT));
		assert.equal(errors.length, 1);
		assert.match(errors[0]?.message ?? "", /^bad-boundary:/);
		assert.match(errors[0]?.message ?? "", /records boundary 99, computed level is 1/);
	});

	test("6. cycle planted in step_dep → error with the cycle path", () => {
		seedConfig();
		seedStore({
			steps: [
				{ id: "DO-1", module: "auth" },
				{ id: "DO-2", module: "db" },
			],
			deps: [
				{ stepId: "DO-1", dependsOnId: "DO-2" },
				{ stepId: "DO-2", dependsOnId: "DO-1" },
			],
			lanes: [
				{
					laneId: "lane-1",
					stepId: "DO-1",
					position: 0,
					worktree: "todoapp/lane-1-auth",
					branch: "todoapp/lane-1-auth",
					status: "active",
				},
				{
					laneId: "lane-1",
					stepId: "DO-2",
					position: 1,
					worktree: "todoapp/lane-1-auth",
					branch: "todoapp/lane-1-auth",
					status: "active",
				},
			],
		});
		const errors = errorsOf(checkDevLanesSection(cwd, PROJECT));
		assert.equal(errors.length, 1);
		assert.match(errors[0]?.message ?? "", /^cycle: dependency cycle:/);
		assert.match(errors[0]?.message ?? "", /DO-1/);
		assert.match(errors[0]?.message ?? "", /DO-2/);
	});

	test("7. legacy (published, zero dev_lane rows) → not-checkable info, no error", () => {
		seedConfig();
		seedStore({
			steps: [{ id: "DO-1", module: "auth" }],
			deps: [],
		});
		const section = checkDevLanesSection(cwd, PROJECT);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.equal(
			section.items[0]?.message,
			"lanes: not-checkable — legacy artifact carries no lane data (pre-Phase-7 format)",
		);
		const summary = summarize([section]);
		assert.equal(summary.summary.error, 0);
		assert.equal(summary.ok, true);
	});

	test("8. no published dev-order → info, no error", () => {
		seedConfig();
		const section = checkDevLanesSection(cwd, PROJECT);
		assert.equal(section.items[0]?.status, "info");
		assert.equal(section.items[0]?.message, "lanes: not-checkable — no published development-order");
		assert.equal(summarize([section]).summary.error, 0);
		const emptyName = checkDevLanesSection(cwd, "");
		assert.equal(emptyName.items[0]?.status, "info");
		assert.equal(summarize([emptyName]).summary.error, 0);
	});

	test("9. worktree ≠ branch → error (name-match rule)", () => {
		seedConfig();
		const fixture = cleanFixture();
		fixture.lanes = fixture.lanes?.map((l) => (l.laneId === "lane-1" ? { ...l, branch: "todoapp/lane-1-other" } : l));
		seedStore(fixture);
		const errors = errorsOf(checkDevLanesSection(cwd, PROJECT));
		assert.equal(errors.length, 1);
		assert.match(errors[0]?.message ?? "", /^name-mismatch:/);
		assert.match(errors[0]?.message ?? "", /lane-1/);
	});

	test("10. summarize() flips ok:false exactly when an error item exists", () => {
		seedConfig();
		seedStore(cleanFixture());
		const clean = summarize([checkDevLanesSection(cwd, PROJECT)]);
		assert.equal(clean.ok, true);

		// Fresh store for the second fixture (one published envelope per run).
		const dbPath = buildStoreDbPath(PROJECT, cwd);
		for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });

		const broken = cleanFixture();
		broken.xdeps = [];
		seedStore(broken);
		const section = checkDevLanesSection(cwd, PROJECT);
		assert.ok(section.items.some((i) => i.status === "error"));
		assert.equal(summarize([section]).ok, false);
	});
});
