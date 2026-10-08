/**
 * Dev-lane storage leg (Phase 7 / 7.9.1).
 *
 * Covers the store side of the lane map only — doctor + handoff have
 * their own round-trips (7.7.3 / 7.8.2):
 *   1. write→publish→readLatestPublishedRows round-trip: devLane +
 *      devLaneXdep come back identical (incl. status, ordered by
 *      lane_id, position regardless of write order);
 *   2. YAML export carries the devLane / devLaneXdep row-sets;
 *   3. deleting a dev_step cascades its dev_lane row (and the xdep
 *      edge follows its step_dep FK).
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import type { DatabaseSync } from "node:sqlite";
import {
	exportArtifactYaml,
	publishArtifact,
	readLatestPublishedRows,
	writeArtifact,
	type ArtifactEnvelopeInput,
} from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";

const PROJECT = "LaneApp";
const RUN = "r-lanes";

let dirs: string[] = [];
let cwd = "";
let db: DatabaseSync;

function env(overrides: Partial<ArtifactEnvelopeInput> = {}): ArtifactEnvelopeInput {
	return {
		version: 1,
		stage: "ordering-development",
		generatedAt: "2026-09-27T00:00:00Z",
		inputs: "{}",
		reviewerVerdict: null,
		changeLog: "[]",
		...overrides,
	};
}

/** 4 steps / 2 lanes / 1 integration point — dev_lane rows written out of
 *  order on purpose to prove the read's `lane_id, position` ordering. */
function devOrderPayload(): Record<string, unknown> {
	return {
		devStep: [
			{ id: "DO-1", module: "auth" },
			{ id: "DO-2", module: "db" },
			{ id: "DO-3", module: "api" },
			{ id: "DO-4", module: "web" },
		],
		stepDep: [
			{ stepId: "DO-3", dependsOnId: "DO-1" },
			{ stepId: "DO-3", dependsOnId: "DO-2" },
			{ stepId: "DO-4", dependsOnId: "DO-3" },
		],
		devLane: [
			{
				laneId: "lane-2",
				stepId: "DO-2",
				position: 0,
				worktree: "laneapp/lane-2-db",
				branch: "laneapp/lane-2-db",
				status: "active",
			},
			{
				laneId: "lane-1",
				stepId: "DO-4",
				position: 2,
				worktree: "laneapp/lane-1-auth",
				branch: "laneapp/lane-1-auth",
				status: "active",
			},
			{
				laneId: "lane-1",
				stepId: "DO-1",
				position: 0,
				worktree: "laneapp/lane-1-auth",
				branch: "laneapp/lane-1-auth",
				status: "active",
			},
			{
				laneId: "lane-1",
				stepId: "DO-3",
				position: 1,
				worktree: "laneapp/lane-1-auth",
				branch: "laneapp/lane-1-auth",
				status: "active",
			},
		],
		devLaneXdep: [{ stepId: "DO-3", dependsOnId: "DO-2", boundaryLevel: 1 }],
	};
}

const EXPECTED_LANES = [
	{
		laneId: "lane-1",
		stepId: "DO-1",
		position: 0,
		worktree: "laneapp/lane-1-auth",
		branch: "laneapp/lane-1-auth",
		status: "active",
	},
	{
		laneId: "lane-1",
		stepId: "DO-3",
		position: 1,
		worktree: "laneapp/lane-1-auth",
		branch: "laneapp/lane-1-auth",
		status: "active",
	},
	{
		laneId: "lane-1",
		stepId: "DO-4",
		position: 2,
		worktree: "laneapp/lane-1-auth",
		branch: "laneapp/lane-1-auth",
		status: "active",
	},
	{
		laneId: "lane-2",
		stepId: "DO-2",
		position: 0,
		worktree: "laneapp/lane-2-db",
		branch: "laneapp/lane-2-db",
		status: "active",
	},
];

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-dev-lanes-store-"));
	dirs.push(dir);
	cwd = dir;
	db = openStoreDb(buildStoreDbPath(PROJECT, cwd));
});

afterEach(() => {
	closeStoreDb(db);
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs = [];
});

describe("db-store — dev lanes storage leg", () => {
	test("1. write → publish → read round-trip: devLane + devLaneXdep identical (lane_id, position order)", () => {
		writeArtifact(db, "development-order", RUN, env(), devOrderPayload());
		publishArtifact(db, RUN, "development-order");

		const read = readLatestPublishedRows(cwd, PROJECT, "development-order");
		assert.ok(read, "published rows should be readable");
		assert.deepEqual(read.rows.devLane, EXPECTED_LANES);
		assert.deepEqual(read.rows.devLaneXdep, [{ stepId: "DO-3", dependsOnId: "DO-2", boundaryLevel: 1 }]);
		assert.deepEqual(
			(read.rows.devStep as Array<{ id: string }>).map((s) => s.id),
			["DO-1", "DO-2", "DO-3", "DO-4"],
		);
		assert.equal((read.rows.stepDep as unknown[]).length, 3);
	});

	test("2. YAML export carries the devLane / devLaneXdep row-sets", () => {
		writeArtifact(db, "development-order", RUN, env(), devOrderPayload());
		publishArtifact(db, RUN, "development-order");

		const yamlText = exportArtifactYaml(db, RUN, "development-order");
		assert.ok(yamlText, "export should produce YAML");
		assert.match(yamlText, /^ {2}devLane:/m, "YAML must contain the devLane row-set");
		assert.match(yamlText, /^ {2}devLaneXdep:/m, "YAML must contain the devLaneXdep row-set");

		const parsed = parse(yamlText) as { rows?: Record<string, unknown> };
		const lanes = parsed.rows?.devLane as Array<Record<string, unknown>>;
		const xdeps = parsed.rows?.devLaneXdep as Array<Record<string, unknown>>;
		assert.equal(lanes.length, 4);
		assert.deepEqual(
			lanes.map((l) => [l.laneId, l.stepId, l.status]),
			[
				["lane-1", "DO-1", "active"],
				["lane-1", "DO-3", "active"],
				["lane-1", "DO-4", "active"],
				["lane-2", "DO-2", "active"],
			],
		);
		assert.deepEqual(xdeps, [{ stepId: "DO-3", dependsOnId: "DO-2", boundaryLevel: 1 }]);
	});

	test("3. deleting a dev_step cascades its dev_lane row (and the xdep follows step_dep)", () => {
		writeArtifact(db, "development-order", RUN, env(), devOrderPayload());
		publishArtifact(db, RUN, "development-order");

		// DO-1: its lane row + the DO-3←DO-1 step_dep go with it.
		db.prepare("DELETE FROM dev_step WHERE run_id = ? AND id = ?").run(RUN, "DO-1");
		let lanes = readLatestPublishedRows(cwd, PROJECT, "development-order");
		assert.ok(lanes);
		const laneStepIds = ((lanes.rows.devLane as Array<{ stepId: string }> | undefined) ?? []).map((l) => l.stepId);
		assert.equal(laneStepIds.includes("DO-1"), false, "dev_lane row must cascade with dev_step");
		assert.equal(laneStepIds.length, 3);
		assert.equal(((lanes.rows.stepDep as unknown[] | undefined) ?? []).length, 2);

		// DO-2: the recorded integration point goes with its step_dep edge.
		// (readRows omits empty row-sets — a deleted set comes back undefined.)
		db.prepare("DELETE FROM dev_step WHERE run_id = ? AND id = ?").run(RUN, "DO-2");
		lanes = readLatestPublishedRows(cwd, PROJECT, "development-order");
		assert.ok(lanes);
		assert.equal(
			((lanes.rows.devLaneXdep as unknown[] | undefined) ?? []).length,
			0,
			"dev_lane_xdep must cascade via step_dep",
		);
		assert.equal(((lanes.rows.devLane as unknown[] | undefined) ?? []).length, 2);
	});
});
