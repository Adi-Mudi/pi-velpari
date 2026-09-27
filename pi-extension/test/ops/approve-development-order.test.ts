/**
 * Development-order publish regression test (stageToArtifact gap fix).
 *
 * Checkpoint 2.2 of the freshness plan (B4 + A3) found a real latent bug:
 * `stageToArtifact` had no `ordering-development` case, so the development
 * order could never publish or advance in production ("No artifact mapping
 * for stage"). Every test walked state via advanceStage directly, so the
 * gap was invisible.
 *
 * This suite walks the REAL approve path (handleApprove — the same code
 * path the publish tool and /velpari-development-order-approve use) and
 * adds a table-driven guard: every publishable transition in
 * STAGE_TRANSITIONS must have a stageToArtifact mapping, so this bug
 * class cannot recur.
 */

import { describe, it, after, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove, stageToArtifact } from "../../src/ops/approve.js";
import { advanceStage, createRun, loadState } from "../../src/core/state.js";
import { STAGE_TRANSITIONS } from "../../src/core/constants.js";
import { parseFrontmatterBlock } from "../../src/core/frontmatter.js";
import { hashFileContent } from "../../src/core/fingerprints.js";
import { loadFreshnessManifest } from "../../src/core/freshness.js";
import { computeLanes, type LaneDepInput, type LaneStepInput } from "../../src/core/dev-lanes.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";
import {
	readArtifact,
	type DevLaneRow,
	type DevLaneXdepRow,
	type DevStepRow,
	type StepDepRow,
} from "../../src/io/store.js";

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

/**
 * Declared inputs of the development-order stage (registry.ts). The
 * freshness publish gate refuses a publish when any is missing, so the
 * fixture seeds all of them as grouped Doc artifacts.
 */
const DECLARED_INPUTS: Array<{ dir: string; file: string; id: string }> = [
	{ dir: "design", file: "design_TestApp.md", id: "design:TestApp" },
	{ dir: "requirements", file: "PRD_TestApp.md", id: "prd:TestApp" },
	{ dir: "requirements", file: "RTM_TestApp.md", id: "rtm:TestApp" },
	{ dir: "feasibility", file: "feasibility-study_TestApp.md", id: "feasibility-study:TestApp" },
	{ dir: "atomic-functions", file: "atomic-functions_TestApp.md", id: "atomic-functions:TestApp" },
	{ dir: "pseudocode", file: "pseudocode_TestApp.md", id: "pseudocode:TestApp" },
	{ dir: "tests", file: "test-plan_TestApp.md", id: "test-plan:TestApp" },
	{ dir: "tests", file: "test-cases_TestApp.md", id: "test-cases:TestApp" },
];

function seedDeclaredInputs(): void {
	for (const input of DECLARED_INPUTS) {
		const dir = path.join(tmpDir, "Doc", input.dir);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, input.file), `# ${input.file}\n`, "utf8");
	}
}

/** Drive a fresh run into ordering-development and write the working copy. */
function enterOrderingDevelopment(): void {
	let state = createRun("TestApp", tmpDir);
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
	]) {
		state = advanceStage(state, cmd, tmpDir);
	}
	assert.equal(loadState(tmpDir).currentStage, "ordering-development");
	const runId = loadState(tmpDir).runId;
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "development-order");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "development-order_TestApp.md"),
		"# Development Order\n\n## Order\n\n- 1. AF-01\n\n## Change Log\n\n- 1.0.0 — initial.\n",
		"utf8",
	);
	// B3/D6+D8: the publish requires the YAML sidecar — the source of
	// truth the published markdown is re-rendered from.
	fs.writeFileSync(
		path.join(dir, "development-order_TestApp.yaml"),
		[
			"project: TestApp",
			"version: 1.0.0",
			"steps:",
			"  - id: DO-1",
			"    module: M-1 (core)",
			"    afs: [AF-1]",
			"    dependsOn: []",
			"    rationale: foundation",
			"changeLog:",
			"  - 1.0.0 — initial.",
			"",
		].join("\n"),
		"utf8",
	);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-approve-dev-order-"));
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TestApp" }),
		"utf8",
	);
	// v1.2.1 opt-out for minimal-cwd test fixtures.
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("/velpari-development-order-approve — real publish path", () => {
	it("publishes the working copy with an inputs: stamp, records freshness.json, and advances", async () => {
		enterOrderingDevelopment();
		seedDeclaredInputs();

		await handleApprove(makeCtx(), undefined, tmpDir, { skipDbPublish: true });

		const pubPath = path.join(tmpDir, "Doc", "development-order", "development-order_TestApp.md");
		assert.ok(fs.existsSync(pubPath), `expected publish at ${pubPath}; messages: ${allMessages()}`);

		// Frontmatter carries the B4 inputs: stamp — one entry per declared
		// input, each matching the on-disk hash.
		const fm = parseFrontmatterBlock(fs.readFileSync(pubPath, "utf8"));
		assert.ok(fm?.fields.inputs, "published artifact has no inputs: stamp");
		const stamped = JSON.parse(fm.fields.inputs!) as Record<string, string>;
		for (const input of DECLARED_INPUTS) {
			const expected = hashFileContent(path.join(tmpDir, "Doc", input.dir, input.file));
			assert.equal(stamped[input.id], expected, `stamp mismatch for ${input.id}`);
		}

		// The machine manifest records the publish under development-order:TestApp.
		const manifest = loadFreshnessManifest(tmpDir);
		const entry = manifest.artifacts["development-order:TestApp"];
		assert.ok(entry, "expected a freshness manifest entry for development-order:TestApp");
		assert.equal(entry.path, path.join("Doc", "development-order", "development-order_TestApp.md"));
		assert.deepEqual(entry.inputs, stamped);

		const after = loadState(tmpDir);
		assert.equal(after.currentStage, "ordered-development", "approve did not advance");
	});

	it("table-driven guard: every publishable STAGE_TRANSITIONS row has a stageToArtifact mapping", () => {
		const publishable = STAGE_TRANSITIONS.filter((t) => t.command.endsWith("-approve"));
		assert.equal(publishable.length, 9, "expected the 9 per-stage approve transitions");
		for (const t of publishable) {
			assert.ok(stageToArtifact(t.from) !== null, `${t.command}: no stageToArtifact mapping for stage "${t.from}"`);
			// The rest state right after the approve must map too — a
			// re-publish from the rest state goes through the same switch.
			assert.ok(stageToArtifact(t.to) !== null, `${t.command}: no stageToArtifact mapping for rest state "${t.to}"`);
		}
	});
});

// ---------------------------------------------------------------------------
// Phase 7 / N16 — publish-time lane finalization (plan 7.4.2, seven cases).
//
// These drive the REAL DB publish path (`skipDbPublish` off): a git repo,
// the stage payload and the store under Doc/store/TestApp/index.db. The
// helper under test is ops/approve.ts:finalizeDevLanes — scouts propose,
// code verifies and finalizes, and the payload hard-block is the
// enforcement point (cases 3–6 write ZERO store rows).
// ---------------------------------------------------------------------------

/** The worked example graph: A,B independent → C → D,E → F (plan §7.1). */
const WORKED_STEPS: LaneStepInput[] = [
	{ stepId: "A", module: "core" },
	{ stepId: "B", module: "core" },
	{ stepId: "C", module: "shared" },
	{ stepId: "D", module: "api" },
	{ stepId: "E", module: "api" },
	{ stepId: "F", module: "edge" },
];
const WORKED_DEPS: LaneDepInput[] = [
	{ stepId: "C", dependsOnStepId: "A" },
	{ stepId: "C", dependsOnStepId: "B" },
	{ stepId: "D", dependsOnStepId: "C" },
	{ stepId: "E", dependsOnStepId: "C" },
	{ stepId: "F", dependsOnStepId: "D" },
	{ stepId: "F", dependsOnStepId: "E" },
];

function devStepRows(steps: readonly LaneStepInput[]): DevStepRow[] {
	return steps.map((s) => ({ id: s.stepId, module: s.module ?? "mod" }));
}

function stepDepRows(deps: readonly LaneDepInput[]): StepDepRow[] {
	return deps.map((d) => ({ stepId: d.stepId, dependsOnId: d.dependsOnStepId }));
}

/** The canonical map + computed boundaries the store must equal (cases 1, 7). */
function canonicalRows(
	steps: readonly LaneStepInput[],
	deps: readonly LaneDepInput[],
): { lanes: DevLaneRow[]; xdeps: DevLaneXdepRow[] } {
	const plan = computeLanes(steps, deps, { maxLanes: 4, projectSlug: "TestApp" });
	assert.ok(plan.ok, `fixture graph must lane cleanly: ${plan.ok ? "" : JSON.stringify(plan.problems)}`);
	const lanes: DevLaneRow[] = plan.plan.lanes.flatMap((lane) =>
		lane.steps.map((stepId, position) => ({
			laneId: lane.laneId,
			stepId,
			position,
			worktree: lane.worktree,
			branch: lane.branch,
			status: lane.status,
		})),
	);
	const xdeps: DevLaneXdepRow[] = plan.plan.xdeps.map((x) => ({
		stepId: x.stepId,
		dependsOnId: x.dependsOnStepId,
		boundaryLevel: x.boundaryLevel,
	}));
	return { lanes, xdeps };
}

function storeDbPath(): string {
	return path.join(tmpDir, "Doc", "store", "TestApp", "index.db");
}

/** Isolated git env pins — restored after the whole file (db-era pattern). */
const savedGitEnv: Record<string, string | undefined> = {};

/**
 * Real git repo + pinned identity + isolated ambient git config. The DB
 * publish chain refuses without a repo/identity (precheckGitForPublish).
 */
function initGitForPublish(): void {
	execFileSync("git", ["init", "-q"], { cwd: tmpDir });
	execFileSync("git", ["config", "user.name", "Velpari Phase7"], { cwd: tmpDir });
	execFileSync("git", ["config", "user.email", "phase7@velpari.local"], { cwd: tmpDir });
	const globalCfg = path.join(tmpDir, "gitconfig-global");
	fs.writeFileSync(globalCfg, "[user]\n\tname = Velpari Phase7\n\temail = phase7@velpari.local\n", "utf8");
	const pins: Record<string, string> = {
		GIT_CONFIG_GLOBAL: globalCfg,
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
	};
	for (const [key, value] of Object.entries(pins)) {
		if (!(key in savedGitEnv)) savedGitEnv[key] = process.env[key];
		process.env[key] = value;
	}
}

/**
 * Full v4 files.json (the DB-era path reads framework + path arrays).
 * @param extra - Merged last (lane cap overrides, etc.).
 */
function writeFullFilesJson(extra: Record<string, unknown> = {}): void {
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify(
			{
				version: 4,
				projectName: "TestApp",
				framework: { language: "typescript", runtime: "node" },
				inputDocuments: [],
				outputPaths: {},
				codePaths: [],
				testPaths: [],
				excludedPaths: [],
				...extra,
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
}

/** Write the stage payload at the payload convention path (Phase 4). */
function writeLanePayload(rows: Record<string, unknown>): void {
	const runId = loadState(tmpDir).runId;
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "development-order", "payload");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "development-order-payload.json"),
		JSON.stringify(
			{
				envelope: {
					version: 1,
					stage: "ordering-development",
					generatedAt: "2026-09-27T00:00:00.000Z",
					inputs: {},
					reviewerVerdict: null,
					changeLog: ["2026-09-27: Phase 7 lane fixture."],
				},
				rows,
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
}

/** Fixture: full config → ordering-development → declared inputs → git → payload. */
function prepareLaneFixture(rows: Record<string, unknown>): void {
	writeFullFilesJson();
	enterOrderingDevelopment();
	seedDeclaredInputs();
	initGitForPublish();
	writeLanePayload(rows);
}

/** The real publish (DB default: markdown off, store write on). */
async function approveDb(): Promise<void> {
	await handleApprove(makeCtx(), undefined, tmpDir, { skipAutoDoctor: true });
}

/** Read the published store rows for this run. */
function readLaneStore(): { status: string; lanes: DevLaneRow[]; xdeps: DevLaneXdepRow[] } {
	const db = openStoreDb(storeDbPath());
	try {
		const stored = readArtifact(db, loadState(tmpDir).runId, "development-order");
		assert.ok(stored, "expected published development-order rows in the store");
		const rows = stored.rows as { devLane?: DevLaneRow[]; devLaneXdep?: DevLaneXdepRow[] };
		return { status: stored.envelope.status, lanes: rows.devLane ?? [], xdeps: rows.devLaneXdep ?? [] };
	} finally {
		closeStoreDb(db);
	}
}

/** A blocked publish must leave the run exactly where it was. */
function assertBlocked(codePattern: RegExp): void {
	const text = allMessages();
	assert.match(text, codePattern, `expected a ${codePattern} hard-block; messages: ${text}`);
	assert.equal(loadState(tmpDir).currentStage, "ordering-development", "a blocked publish must not advance");
	assert.equal(fs.existsSync(storeDbPath()), false, "a blocked publish must write zero store rows");
	assert.equal(
		fs.existsSync(path.join(tmpDir, "Doc", "development-order", "development-order_TestApp.md")),
		false,
		"a blocked publish must not publish markdown",
	);
}

describe("publish-time lane finalization (Phase 7 / N16) — plan 7.4.2", () => {
	it("1. no devLane ⇒ the canonical map + computed boundaries land in the store", async () => {
		prepareLaneFixture({ devStep: devStepRows(WORKED_STEPS), stepDep: stepDepRows(WORKED_DEPS) });
		await approveDb();
		assert.equal(
			loadState(tmpDir).currentStage,
			"ordered-development",
			`publish must advance; messages: ${allMessages()}`,
		);
		const store = readLaneStore();
		assert.equal(store.status, "published", "the envelope must flip to published");
		const expected = canonicalRows(WORKED_STEPS, WORKED_DEPS);
		assert.ok(expected.lanes.length >= 2, "the worked example is a multi-lane graph");
		assert.deepEqual(store.lanes, expected.lanes, "store dev_lane rows must equal the canonical map");
		assert.deepEqual(store.xdeps, expected.xdeps, "store dev_lane_xdep rows must equal the computed boundaries");
	});

	it("2. a valid scout proposal is adopted verbatim (the non-canonical choice survives)", async () => {
		// Deliberately NON-canonical: one lane holds all six steps (the
		// algorithm would open at least two). Valid topologically, names
		// match, one lane ⇒ no cross-lane edges.
		const singleLane: DevLaneRow[] = ["A", "B", "C", "D", "E", "F"].map((stepId, position) => ({
			laneId: "lane-1",
			stepId,
			position,
			worktree: "testapp/lane-1-all",
			branch: "testapp/lane-1-all",
			status: "active" as const,
		}));
		prepareLaneFixture({
			devStep: devStepRows(WORKED_STEPS),
			stepDep: stepDepRows(WORKED_DEPS),
			devLane: singleLane,
		});
		await approveDb();
		assert.equal(
			loadState(tmpDir).currentStage,
			"ordered-development",
			`publish must advance; messages: ${allMessages()}`,
		);
		const store = readLaneStore();
		assert.deepEqual(store.lanes, singleLane, "the proposal must be adopted verbatim");
		assert.deepEqual(store.xdeps, [], "a single-lane proposal has no cross-lane edges");
		const canonical = canonicalRows(WORKED_STEPS, WORKED_DEPS);
		assert.ok(canonical.lanes.length > 1, "the canonical map differs — the choice really was non-canonical");
	});

	it("3. a dependency cycle blocks the publish and writes zero store rows", async () => {
		prepareLaneFixture({
			devStep: devStepRows([
				{ stepId: "A", module: "a" },
				{ stepId: "B", module: "b" },
			]),
			stepDep: [
				{ stepId: "A", dependsOnId: "B" },
				{ stepId: "B", dependsOnId: "A" },
			],
		});
		await approveDb();
		assertBlocked(/dependency cycle: [AB] -> [AB] -> [AB]/);
		assert.match(allMessages(), /cycle:/, "the cycle problem code must surface");
	});

	it("4. a step in two lanes blocks the publish with step-in-two-lanes", async () => {
		const lane1 = ["A", "B", "C", "D"].map((stepId, position) => ({
			laneId: "lane-1",
			stepId,
			position,
			worktree: "testapp/lane-1-core",
			branch: "testapp/lane-1-core",
			status: "active" as const,
		}));
		const lane2 = ["D", "E", "F"].map((stepId, position) => ({
			laneId: "lane-2",
			stepId,
			position,
			worktree: "testapp/lane-2-edge",
			branch: "testapp/lane-2-edge",
			status: "active" as const,
		}));
		prepareLaneFixture({
			devStep: devStepRows(WORKED_STEPS),
			stepDep: stepDepRows(WORKED_DEPS),
			devLane: [...lane1, ...lane2],
		});
		await approveDb();
		assertBlocked(/step-in-two-lanes/);
		assert.match(allMessages(), /step "D" appears in 2 lanes/, "the duplicate step must be named");
	});

	it("5. a proposal over maxLanes blocks the publish with lane-cap", async () => {
		// Five lanes against the default cap of 4.
		const assignments: Array<[string, string[]]> = [
			["lane-1", ["A"]],
			["lane-2", ["B"]],
			["lane-3", ["C"]],
			["lane-4", ["D", "E"]],
			["lane-5", ["F"]],
		];
		const proposal: DevLaneRow[] = assignments.flatMap(([laneId, stepIds]) =>
			stepIds.map((stepId, position) => ({
				laneId,
				stepId,
				position,
				worktree: `testapp/${laneId}-${stepId.toLowerCase()}`,
				branch: `testapp/${laneId}-${stepId.toLowerCase()}`,
				status: "active" as const,
			})),
		);
		prepareLaneFixture({
			devStep: devStepRows(WORKED_STEPS),
			stepDep: stepDepRows(WORKED_DEPS),
			devLane: proposal,
		});
		await approveDb();
		assertBlocked(/lane-cap/);
		assert.match(allMessages(), /proposal opens 5 lanes but maxLanes is 4/, "the cap verdict must name both numbers");
	});

	it("6. a wrong boundaryLevel in devLaneXdep blocks the publish with bad-boundary", async () => {
		// Canonical two-lane split (lane-1: A,C,D,F; lane-2: B,E) with one
		// recorded integration point carrying a fabricated level.
		const proposal: DevLaneRow[] = [
			...["A", "C", "D", "F"].map((stepId, position) => ({
				laneId: "lane-1",
				stepId,
				position,
				worktree: "testapp/lane-1-core",
				branch: "testapp/lane-1-core",
				status: "active" as const,
			})),
			...["B", "E"].map((stepId, position) => ({
				laneId: "lane-2",
				stepId,
				position,
				worktree: "testapp/lane-2-edge",
				branch: "testapp/lane-2-edge",
				status: "active" as const,
			})),
		];
		prepareLaneFixture({
			devStep: devStepRows(WORKED_STEPS),
			stepDep: stepDepRows(WORKED_DEPS),
			devLane: proposal,
			devLaneXdep: [{ stepId: "C", dependsOnId: "B", boundaryLevel: 99 }],
		});
		await approveDb();
		assertBlocked(/bad-boundary/);
		assert.match(
			allMessages(),
			/records boundary 99, computed level is 1/,
			"the recorded level must be compared against the computed one",
		);
	});

	it("7. a legacy payload (valid deps, no devLane) still publishes through the new code path", async () => {
		const steps: LaneStepInput[] = [
			{ stepId: "L1", module: "first" },
			{ stepId: "L2", module: "second" },
		];
		const deps: LaneDepInput[] = [{ stepId: "L2", dependsOnStepId: "L1" }];
		prepareLaneFixture({ devStep: devStepRows(steps), stepDep: stepDepRows(deps) });
		await approveDb();
		assert.equal(
			loadState(tmpDir).currentStage,
			"ordered-development",
			`a lane-less payload must publish; messages: ${allMessages()}`,
		);
		const store = readLaneStore();
		assert.equal(store.status, "published");
		const expected = canonicalRows(steps, deps);
		assert.deepEqual(store.lanes, expected.lanes, "legacy payloads get the canonical map injected");
		assert.deepEqual(store.xdeps, expected.xdeps);
	});
});

after(() => {
	for (const [key, value] of Object.entries(savedGitEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});
