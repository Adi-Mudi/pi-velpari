/**
 * Stage gate tests (sequence hardening).
 *
 * Asserts the hard gate in runStage (STAGE_GATE):
 *   - a stage command runs only from its allowed source stage(s)
 *   - the block error names the correct command to run first
 *   - re-running a stage already in progress (redraft) stays allowed
 *   - nextCommandsFor lists the correct follow-up command(s)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runStage, STAGE_GATE } from "../../src/stages/registry.js";
import { advanceStage, createRun } from "../../src/core/state.js";
import { nextCommandsFor, STAGE_TRANSITIONS } from "../../src/core/constants.js";
import { hashFileContent } from "../../src/core/fingerprints.js";
import { recordPublish } from "../../src/core/freshness.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import {
	writeArtifact,
	publishArtifact,
	type ArtifactEnvelopeInput,
} from "../../src/io/store.js";
import { buildStoreDbPath } from "../../src/core/paths.js";

/**
 * Phase 6 read flip: runStage resolves stage inputs from the project store
 * DB slices. These helpers seed the store so the rtm / architecture-generator
 * fixtures get past the strict slice gate (a Doc/-only project refuses).
 */
function storeEnv(stage: string): ArtifactEnvelopeInput {
	return {
		version: 1,
		stage,
		generatedAt: "2026-09-20T17:00:00.000Z",
		inputs: "{}",
		reviewerVerdict: null,
		changeLog: "[]",
	};
}

function seedStorePrd(): void {
	const db = openStoreDb(buildStoreDbPath("TestApp", tmpDir));
	try {
		writeArtifact(db, "prd", "r1", storeEnv("drafting-prd"), {
			fr: [{ id: "FR-1", phase: 1, textHash: "h1", text: "The system shall parse" }],
			nfr: [{ id: "NFR-1", phase: 1, textHash: "h2", text: "Fast" }],
		});
		publishArtifact(db, "r1", "prd");
	} finally {
		closeStoreDb(db);
	}
}

function seedStoreFeasibility(): void {
	const db = openStoreDb(buildStoreDbPath("TestApp", tmpDir));
	try {
		writeArtifact(db, "feasibility", "r1", storeEnv("analyzing-feasibility"), {
			feasibilityDecision: {
				verdict: "go",
				language: "typescript",
				decidedBy: "user",
				at: "2026-09-20T17:00:00.000Z",
				webSearchConsent: 0,
			},
		});
		publishArtifact(db, "r1", "feasibility");
	} finally {
		closeStoreDb(db);
	}
}

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
		},
	} as unknown as ExtensionCommandContext;
}

const pi = {} as ExtensionAPI;

function lastNotice(): Notice {
	assert.ok(notices.length > 0, "expected at least one notify call");
	return notices[notices.length - 1]!;
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-stage-gate-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("nextCommandsFor", () => {
	it("names the follow-up command for each stage", () => {
		assert.deepEqual(nextCommandsFor("brainstorming"), ["/velpari-approve-brainstorm"]);
		assert.deepEqual(nextCommandsFor("brainstormed"), ["/velpari-prd"]);
		// Industry-standard order: planned-tests → development-order (Stage 9).
		assert.deepEqual(nextCommandsFor("planned-tests"), [
			"/velpari-development-order",
		]);
		// New stages 6, 7, 9, 10.
		assert.deepEqual(nextCommandsFor("designed"), ["/velpari-atomic-function"]);
		assert.deepEqual(nextCommandsFor("analyzed-atomic-functions"), ["/velpari-pseudocode"]);
		assert.deepEqual(nextCommandsFor("ordered-development"), ["/velpari-final-design"]);
		assert.deepEqual(nextCommandsFor("finalized-design"), ["/velpari-handoff"]);
	});

	it("falls back to /velpari-status at a terminal stage", () => {
		assert.deepEqual(nextCommandsFor("handoff-ready"), ["/velpari-status"]);
	});

	it("includes the conditional built-rtm → designing transition", () => {
		assert.ok(
			STAGE_TRANSITIONS.some(
				(t) =>
					t.from === "built-rtm" && t.to === "designing" && t.command === "/velpari-architecture-generator",
			),
		);
	});

	it("hides the feasibility-skip command by default and shows it with the flag", () => {
		assert.deepEqual(nextCommandsFor("built-rtm"), ["/velpari-feasibility"]);
		assert.deepEqual(nextCommandsFor("built-rtm", { feasibilitySkip: true }), [
			"/velpari-feasibility",
			"/velpari-architecture-generator",
		]);
	});
});

describe("runStage hard gate", () => {
	it("blocks /velpari-prd while brainstorming with the two-door guide (A1)", async () => {
		createRun("Test mission", tmpDir);
		await runStage("prd", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Cannot run \/velpari-prd: brainstorm session open/);
		assert.match(n.message, /\/velpari-approve-brainstorm/);
		assert.match(n.message, /restart at \/velpari-prd/);
	});

	it("blocks /velpari-rtm at brainstormed and names /velpari-prd", async () => {
		const state = createRun("Test mission", tmpDir);
		advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		await runStage("rtm", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Cannot run \/velpari-rtm at stage "brainstormed"/);
		assert.match(n.message, /\/velpari-prd/);
	});

	it("blocks the optional stages before design is approved", async () => {
		const state = createRun("Test mission", tmpDir);
		const brainstormed = advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		advanceStage(brainstormed, "/velpari-prd", tmpDir); // drafting-prd
		await runStage("development-order", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Cannot run \/velpari-development-order at stage "drafting-prd"/);
	});

	it("allows the stage from its exact source stage (gate passes, next check runs)", async () => {
		const state = createRun("Test mission", tmpDir);
		advanceStage(state, "/velpari-approve-brainstorm", tmpDir); // brainstormed
		await runStage("prd", makeCtx(), pi, tmpDir);
		// Gate passed — the next failing precondition is the missing config.
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Project name not set/);
	});

	it("allows re-running a stage already in progress (redraft)", async () => {
		const state = createRun("Test mission", tmpDir);
		const brainstormed = advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		advanceStage(brainstormed, "/velpari-prd", tmpDir); // drafting-prd
		assert.ok((STAGE_GATE.prd as readonly string[]).includes("drafting-prd"));
		await runStage("prd", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.match(n.message, /Project name not set/);
	});

	it("blocks with no active run", async () => {
		await runStage("prd", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /No active run/);
	});
});

describe("Stages 6–10 gate values (industry-standard order)", () => {
	// These tests assert the gate allows only the expected upstream state or
	// the stage's own in-progress state. They prevent accidental loosening
	// of the gate (e.g. reverting to the pre-Option-B permissive state).

	it("atomic-function (Stage 6) accepts only `designed` or its own in-progress", () => {
		assert.deepEqual(STAGE_GATE["atomic-function"], ["designed", "analyzing-atomic-functions"]);
	});

	it("pseudocode (Stage 7) accepts only `analyzed-atomic-functions` or its own in-progress", () => {
		assert.deepEqual(STAGE_GATE["pseudocode"], ["analyzed-atomic-functions", "writing-pseudocode"]);
	});

	it("testplan (Stage 8) accepts only `wrote-pseudocode` or its own in-progress", () => {
		assert.deepEqual(STAGE_GATE["testplan"], ["wrote-pseudocode", "planning-tests"]);
	});

	it("development-order (Stage 9) accepts only `planned-tests` or its own in-progress", () => {
		assert.deepEqual(STAGE_GATE["development-order"], ["planned-tests", "ordering-development"]);
	});

	it("final-design (Stage 10) accepts only `ordered-development` or its own in-progress", () => {
		assert.deepEqual(STAGE_GATE["final-design"], ["ordered-development", "finalizing-design"]);
	});

	it("atomic-function gate rejects all upstream-of-design stages", () => {
		const upstreamStages = [
			"brainstormed",
			"drafted-prd",
			"built-rtm",
			"analyzed-feasibility",
			"designed", // allowed — sanity
		];
		const downstreamStages = [
			"analyzed-atomic-functions", // allowed — own in-progress
			"writing-pseudocode",
			"planned-tests",
			"finalized-design",
			"handoff-ready",
		];
		const all = [...upstreamStages, ...downstreamStages];
		const allowed = STAGE_GATE["atomic-function"];
		for (const s of all) {
			if (s === "designed" || s === "analyzing-atomic-functions") continue;
			assert.ok(
				!allowed.includes(s as never),
				`Stage 6 (atomic-function) must NOT accept ${s} but gate allows it`,
			);
		}
	});

	it("pseudocode gate rejects atomic-function (its predecessor) before approval", () => {
		// Stage 7 must run only from Stage 6's *approved* state (analyzed-atomic-functions),
		// not from the in-progress state (analyzing-atomic-functions).
		const allowed = STAGE_GATE["pseudocode"];
		assert.ok(
			!allowed.includes("analyzing-atomic-functions"),
			"pseudocode must NOT run while atomic-function draft is open",
		);
		assert.ok(
			allowed.includes("analyzed-atomic-functions"),
			"pseudocode must run after atomic-function is approved",
		);
	});

	it("final-design gate rejects testplan (Stage 8) — must go through Stages 9 first", () => {
		const allowed = STAGE_GATE["final-design"];
		assert.ok(
			!allowed.includes("planned-tests"),
			"final-design must NOT run from planned-tests; Stages 9 + 10 are required",
		);
		assert.ok(
			!allowed.includes("wrote-pseudocode"),
			"final-design must NOT run from wrote-pseudocode either",
		);
		assert.ok(
			allowed.includes("ordered-development"),
			"final-design must run only after development-order is approved",
		);
	});
});

describe("runStage stage-start freshness check (A3)", () => {
	function advanceToDraftedPrd(): void {
		const s0 = createRun("Test mission", tmpDir);
		const s1 = advanceStage(s0, "/velpari-approve-brainstorm", tmpDir);
		const s2 = advanceStage(s1, "/velpari-prd", tmpDir);
		advanceStage(s2, "/velpari-prd-approve", tmpDir); // drafted-prd
	}

	function seedConfigAndPrd(): string {
		const configDir = path.join(tmpDir, ".pi", "velpari");
		fs.mkdirSync(configDir, { recursive: true });
		fs.writeFileSync(
			path.join(configDir, "files.json"),
			JSON.stringify({ version: 4, projectName: "TestApp" }),
		);
		const prdDir = path.join(tmpDir, "Doc", "requirements");
		fs.mkdirSync(prdDir, { recursive: true });
		const prdPath = path.join(prdDir, "PRD_TestApp.md");
		fs.writeFileSync(prdPath, "# PSRS\n", "utf8");
		return prdPath;
	}

	function stampPrdWithBrainstormInput(brainstormHash: string): void {
		recordPublish(tmpDir, {
			artifact: "prd",
			projectName: "TestApp",
			path: path.join("Doc", "requirements", "PRD_TestApp.md"),
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: { "brainstorm:test-mission": brainstormHash },
		});
	}

	function piMock(sent: string[]): ExtensionAPI {
		return {
			sendUserMessage: (message: string) => {
				sent.push(message);
			},
		} as unknown as ExtensionAPI;
	}

	it("blocks stage start when a declared input artifact is itself stale (input-changed)", async () => {
		advanceToDraftedPrd();
		seedConfigAndPrd();
		// Brainstorm file stamped at v1, then edited → prd:TestApp goes stale.
		const brainstormDir = path.join(tmpDir, "Doc", "brainstorm");
		fs.mkdirSync(brainstormDir, { recursive: true });
		const brainstormPath = path.join(brainstormDir, "brainstorm-test-mission.md");
		fs.writeFileSync(brainstormPath, "# brainstorm v1\n", "utf8");
		stampPrdWithBrainstormInput(hashFileContent(brainstormPath)!);
		fs.writeFileSync(brainstormPath, "# brainstorm v2\n", "utf8");

		const sent: string[] = [];
		await runStage("rtm", makeCtx(), piMock(sent), tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Cannot run \/velpari-rtm: declared inputs are stale/);
		assert.match(n.message, /prd:TestApp is stale \(input-changed: brainstorm:test-mission\)/);
		assert.match(n.message, /\/velpari-prd, then \/velpari-prd-approve/);
		assert.match(n.message, /\.pi\/velpari\/freshness\.json/);
		assert.equal(sent.length, 0, "stage must not start");
	});

	it("blocks stage start when a declared input's own input vanished (input-missing)", async () => {
		advanceToDraftedPrd();
		seedConfigAndPrd();
		stampPrdWithBrainstormInput("0".repeat(64)); // no brainstorm file on disk

		const sent: string[] = [];
		await runStage("rtm", makeCtx(), piMock(sent), tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /declared inputs are stale/);
		assert.match(n.message, /input-missing/);
		assert.equal(sent.length, 0);
	});

	it("re-brainstorm republish stales the PRD; the block names the remedy (D8)", async () => {
		advanceToDraftedPrd();
		seedConfigAndPrd();
		// Brainstorm v1 published (base-slug manifest entry), PRD stamped on it.
		const brainstormDir = path.join(tmpDir, "Doc", "brainstorm");
		fs.mkdirSync(brainstormDir, { recursive: true });
		const v1rel = path.join("Doc", "brainstorm", "brainstorm-test-mission.md");
		const v1abs = path.join(tmpDir, v1rel);
		fs.writeFileSync(v1abs, "# brainstorm v1\n", "utf8");
		recordPublish(tmpDir, {
			artifact: "brainstorm",
			slug: "test-mission",
			path: v1rel,
			publishedAt: "2026-09-20T17:00:00.000Z",
			inputs: {},
		});
		stampPrdWithBrainstormInput(hashFileContent(v1abs)!);

		// Re-brainstorm the same topic: suffixed file, base-key upsert (D8).
		const v2rel = path.join(
			"Doc", "brainstorm", "brainstorm-test-mission-20260920-180000.md",
		);
		fs.writeFileSync(path.join(tmpDir, v2rel), "# brainstorm v2\n", "utf8");
		recordPublish(tmpDir, {
			artifact: "brainstorm",
			slug: "test-mission",
			path: v2rel,
			publishedAt: "2026-09-20T18:00:00.000Z",
			inputs: {},
		});

		const sent: string[] = [];
		await runStage("rtm", makeCtx(), piMock(sent), tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Cannot run \/velpari-rtm: declared inputs are stale/);
		assert.match(n.message, /prd:TestApp is stale \(input-changed: brainstorm:test-mission\)/);
		assert.match(n.message, /\/velpari-prd, then \/velpari-prd-approve/);
		assert.equal(sent.length, 0, "stage must not start on stale inputs");
	});

	it("legacy no-stamp input warns but does not block (D7)", async () => {
		advanceToDraftedPrd();
		seedConfigAndPrd();
		seedStorePrd(); // Phase 6: the rtm slice reads the store, not Doc/
		// Legacy entry: no inputs map.
		recordPublish(tmpDir, {
			artifact: "prd",
			projectName: "TestApp",
			path: path.join("Doc", "requirements", "PRD_TestApp.md"),
			publishedAt: "2026-09-20T17:00:00.000Z",
		});

		const sent: string[] = [];
		await runStage("rtm", makeCtx(), piMock(sent), tmpDir);
		assert.ok(
			notices.some((n) => n.level === "warning" && /no freshness stamp/.test(n.message)),
			"expected a no-stamp warning",
		);
		assert.ok(notices.every((n) => n.level !== "error"), "no-stamp must not block");
		assert.equal(sent.length, 1, "stage started");
	});

	it("no manifest at all → stage starts without freshness notices", async () => {
		advanceToDraftedPrd();
		seedConfigAndPrd();
		seedStorePrd(); // Phase 6: the rtm slice reads the store, not Doc/

		const sent: string[] = [];
		await runStage("rtm", makeCtx(), piMock(sent), tmpDir);
		assert.ok(notices.every((n) => !/freshness/i.test(n.message)));
		assert.equal(sent.length, 1);
	});
});

describe("feasibility-skip gate", () => {
	function advanceToBuiltRtm(): void {
		const s0 = createRun("Test mission", tmpDir);
		const s1 = advanceStage(s0, "/velpari-approve-brainstorm", tmpDir);
		const s2 = advanceStage(s1, "/velpari-prd", tmpDir);
		const s3 = advanceStage(s2, "/velpari-prd-approve", tmpDir);
		const s4 = advanceStage(s3, "/velpari-rtm", tmpDir);
		advanceStage(s4, "/velpari-rtm-approve", tmpDir); // built-rtm
	}

	function seedProjectConfig(): void {
		const configDir = path.join(tmpDir, ".pi", "velpari");
		fs.mkdirSync(configDir, { recursive: true });
		fs.writeFileSync(
			path.join(configDir, "files.json"),
			JSON.stringify({ version: 4, projectName: "TestApp" }),
		);
	}

	it("blocks /velpari-architecture-generator from built-rtm without a published feasibility doc", async () => {
		advanceToBuiltRtm();
		await runStage("architecture-generator", makeCtx(), pi, tmpDir);
		const n = lastNotice();
		assert.equal(n.level, "error");
		assert.match(n.message, /Cannot run \/velpari-architecture-generator at stage "built-rtm"/);
		assert.match(n.message, /Run \/velpari-feasibility first\./);
		assert.ok(!n.message.includes("or /velpari-architecture-generator"));
	});

	it("allows /velpari-architecture-generator from built-rtm when a published feasibility doc exists", async () => {
		advanceToBuiltRtm();
		seedProjectConfig();
		seedStoreFeasibility(); // Phase 6: the design slice reads the store
		const feasDir = path.join(tmpDir, "Doc", "feasibility");
		fs.mkdirSync(feasDir, { recursive: true });
		fs.writeFileSync(path.join(feasDir, "feasibility-study_TestApp.md"), "# Feasibility\n");
		const sent: string[] = [];
		const piMock = {
			sendUserMessage: (message: string) => {
				sent.push(message);
			},
		} as unknown as ExtensionAPI;
		await runStage("architecture-generator", makeCtx(), piMock, tmpDir);
		assert.equal(sent.length, 1);
		assert.ok(notices.every((n) => n.level !== "error"));
	});
});
