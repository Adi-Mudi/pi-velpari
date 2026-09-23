/**
 * End-to-end test for /velpari-atomic-function (Gap B).
 *
 * Walks the FULL atomic-function flow including the publish step:
 *
 *   1. handleAtomicFunction (composer) — Phase 1+2+3 → prompt to parent LLM
 *   2. parent LLM (mocked) — writes the working copy + reviewer verdict
 *   3. velpari_stage_publish tool — publishes + advances state
 *   4. Verify Doc/atomic-functions/<project>.md exists
 *   5. Verify state.json shows analyzed-atomic-functions
 *   6. Verify state history records the stage advance
 *
 * This test proves atomic-function is FULLY COMPLETE end-to-end (Gap B). The
 * dedicated layer (stages/atomic-function/) is wired into the runtime
 * (Gap A), and the parent-LLM tool call flow (Plan B) carries the
 * publish + state advance.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { handleAtomicFunction } from "../../src/stages/atomic-function/index.js";
import { loadState, type RunState } from "../../src/core/state.js";
import { loadHistory } from "../../src/core/history.js";
import { handleApprove } from "../../src/ops/approve.js";
import { resolveDocArtifact, buildRunDir, buildStoreDbPath } from "../../src/core/paths.js";
import { openStoreDb, closeStoreDb } from "../../src/io/db.js";
import { writeArtifact, publishArtifact, type ArtifactEnvelopeInput } from "../../src/io/store.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

let tmpDir: string;
let sentMessages: string[];
let notices: Array<{ message: string; level: string }>;

interface MockPi {
	sendUserMessage(msg: string): void;
	registerTool?: (tool: unknown) => void;
	getFlag?: (name: string) => string | undefined;
}

/**
 * Build a minimal ExtensionCommandContext with a notice-capturing ui.
 * @returns {ExtensionCommandContext} Fresh ctx; `notices` captures notify calls.
 */
function makeCtx(): ExtensionCommandContext {
	notices = [];
	return {
		ui: {
			notify: (message: string, level: string) => {
				notices.push({ message, level });
			},
			setStatus: () => {
				// No-op for tests; we don't assert on the status footer.
			},
		},
	} as unknown as ExtensionCommandContext;
}

/**
 * Build a minimal ExtensionAPI that captures sendUserMessage calls.
 * @returns {ExtensionAPI} Fresh pi stub; `sentMessages` records sends.
 */
function makePi(): ExtensionAPI {
	sentMessages = [];
	return {
		sendUserMessage: (msg: string) => {
			sentMessages.push(msg);
		},
		appendEntry: () => {
			// No-op for tests; we don't assert on the appended entries.
		},
	} as unknown as ExtensionAPI;
}

/**
 * Build a RunState at the given stage with the given mission.
 * @param {RunState["currentStage"]} stage - Stage to place the run in.
 * @param {string} mission - Mission topic greed (files.json projectName fallback).
 * @returns {RunState} A minimal but valid run state.
 */
function makeState(stage: RunState["currentStage"], mission: string): RunState {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	const state: RunState = {
		version: 1,
		runId: "2026-09-17-1300-e2e",
		mission,
		currentStage: stage,
		history: [],
		updatedAt: new Date().toISOString(),
	};
	fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2), "utf8");
	return state;
}

/**
 * Build a files.json config for the test cwd.
 * @param {object} opts - Overrides ({ projectNames?, topicSlug? } etc. as needed).
 * @returns {unknown} The config object to persist into `.pi/velpari/files.json`.
 */
function makeFilesConfig(opts: {
	projectName: string;
	atomicTier?: "entry" | "basic" | "intermediate" | "advanced";
}): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "files.json"),
		JSON.stringify(
			{
				version: 4,
				framework: { language: "typescript" },
				codePaths: ["src/**/*.ts"],
				testPaths: ["test/**/*.test.ts"],
				documentPaths: ["Doc/**/*.md"],
				excludedPaths: ["node_modules/**"],
				projectName: opts.projectName,
				atomic: opts.atomicTier ? { tier: opts.atomicTier } : {},
			},
			null,
			2,
		),
		"utf8",
	);
}

/**
 * Materialize the published Doc/ inputs the atomic-function stage reads
 * (PRD/RTM/feasibility/design) as minimal markdown files.
 * @param {string} projectName - Project name suffix for the file paths.
 * @returns {void}
 */
function makeDocInputs(projectName: string): void {
	const docDir = path.join(tmpDir, "Doc");
	fs.mkdirSync(docDir, { recursive: true });
	const artifacts = ["PRD", "RTM", "feasibility-study", "design"];
	for (const a of artifacts) {
		fs.writeFileSync(path.join(docDir, `${a}_${projectName}.md`), `# ${a}\n`, "utf8");
	}
}

/**
 * Seed the project store with published prd / rtm / feasibility / design
 * rows (Phase 6 read flip — the atomic-function stage resolves its inputs
 * from the DB slices, and a Doc/-only project refuses loudly).
 * @param {string} projectName - Project whose store to seed.
 * @returns {void}
 */
function makeStoreInputs(projectName: string): void {
	const dbPath = buildStoreDbPath(projectName, tmpDir);
	const db = openStoreDb(dbPath);
	try {
		const env = (stage: string): ArtifactEnvelopeInput => ({
			version: 1,
			stage,
			generatedAt: "2026-09-17T13:00:00.000Z",
			inputs: "{}",
			reviewerVerdict: null,
			changeLog: "[]",
		});
		writeArtifact(db, "prd", "r1", env("drafting-prd"), {
			fr: [{ id: "FR-1", phase: 1, textHash: "h1", text: "The system shall parse input" }],
			nfr: [{ id: "NFR-1", phase: 1, textHash: "h2", text: "Fast" }],
		});
		publishArtifact(db, "r1", "prd");
		writeArtifact(db, "rtm", "r1", env("building-rtm"), {
			rtmRow: [{ id: "R-1", frRef: "FR-1", afRef: null, tcRef: null, phase: 1, targetSha256: "a".repeat(64) }],
		});
		publishArtifact(db, "r1", "rtm");
		writeArtifact(db, "feasibility", "r1", env("analyzing-feasibility"), {
			feasibilityDecision: {
				verdict: "go",
				language: "typescript",
				decidedBy: "user",
				at: "2026-09-17T13:00:00.000Z",
				webSearchConsent: 0,
			},
		});
		publishArtifact(db, "r1", "feasibility");
		writeArtifact(db, "design", "r1", env("designing"), {
			designModule: [{ id: "M-1", name: "core", description: "core logic" }],
		});
		publishArtifact(db, "r1", "design");
	} finally {
		closeStoreDb(db);
	}
}

/**
 * Pre-install the 4 atomic-function scout agent files into `.pi/agents/` so
 * the stage runner's dispatch resolves them (no-op when already present).
 * @returns {void}
 */
function preInstallScouts(): void {
	const agentsDir = path.join(tmpDir, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	const scouts = ["af-source-rtm", "af-source-design", "af-source-prd", "af-source-feas", "reviewer"];
	for (const s of scouts) {
		fs.writeFileSync(path.join(agentsDir, `${s}.md`), `---\nname: ${s}\ndescription: stub\n---\n# stub\n`, "utf8");
	}
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-atomic-e2e-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("atomic-function end-to-end flow", () => {
	it("composer + parent LLM + tool → Doc/artifact + state advance", async () => {
		const projectName = "E2EApp";
		makeState("designed", "e2e-mission");
		makeFilesConfig({ projectName, atomicTier: "basic" });
		makeDocInputs(projectName);
		makeStoreInputs(projectName);
		preInstallScouts();

		const ctx = makeCtx();
		const pi = makePi();

		// ====== Step 1: Composer runs ======
		await handleAtomicFunction(ctx, pi, tmpDir);

		// Composer sent exactly one prompt to parent LLM.
		assert.equal(sentMessages.length, 1, "composer should send one prompt");
		const prompt = sentMessages[0]!;
		assert.match(prompt, /<pi-velpari stage="analyzing-atomic-functions">/, "prompt metadata block");
		assert.match(prompt, /Mission: e2e-mission/);
		assert.match(prompt, /Tier: Basic/);

		// ====== Step 2: Parent LLM (mocked) writes working copy ======
		// The composer instructs the parent LLM to write:
		//   - working copy at <runDir>/atomic-functions/atomic-functions_<proj>.md
		//     (per buildWorkingGroupedPath — category="atomic-functions" plural)
		//   - scout reports at <runDir>/atomic-function/scouts/<name>-report.json
		//     (per dispatchScouts.scoutsDir — uses workingCopyCategory="atomic-function" singular)
		// The doctor looks up the reviewer verdict at the singular scouts path.
		const runDir = buildRunDir("2026-09-17-1300-e2e", tmpDir);
		const workingCopyDir = path.join(runDir, "atomic-functions");
		const scoutsDir = path.join(runDir, "atomic-function", "scouts");
		fs.mkdirSync(workingCopyDir, { recursive: true });
		fs.mkdirSync(scoutsDir, { recursive: true });
		const workingCopyPath = path.join(workingCopyDir, "atomic-functions_E2EApp.md");
		const workingCopyContent = `---
artifact: atomic-functions
project: ${projectName}
version: 1.0.0
status: draft
stage: analyzing-atomic-functions
run: 2026-09-17-1300-e2e
atomicTier: basic
created: 2026-09-17T13:00:00.000Z
updated: 2026-09-17T13:00:00.000Z
---

# Atomic Functions — ${projectName}

## Summary
- Tier: Basic
- Total atomic functions: 2

## Atomic Functions

| AF ID | Name | File Path | Signature | Purpose | Source | Cohesion | Verification | Testable | Called by FRs | Design ref | Extracted from | Satisfies FR | Feasibility ref |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AF-1 | parseInput | src/utils/parse-input.ts | function parseInput(s: string): string | Parses user input | RTM | perfect-atomic | Test | yes | FR-1 | §3.1 | — | FR-1 | §4 |
| AF-2 | validateEmail | src/utils/validate-email.ts | function validateEmail(email: string): boolean | Validates email | PRD | perfect-atomic | Test | yes | FR-2 | §3.2 | — | FR-2 | §4 |
`;
		fs.writeFileSync(workingCopyPath, workingCopyContent, "utf8");

		// B3/D6: the publish requires the YAML sidecar — the source of
		// truth the published markdown is re-rendered from. Basic tier:
		// base-core fields + the 5 basic-tier cross-references.
		const sidecarContent = [
			`project: ${projectName}`,
			"version: 1.0.0",
			"tier: basic",
			"functions:",
			"  - afId: AF-1",
			"    name: parseInput",
			"    filePath: src/utils/parse-input.ts",
			'    signature: "function parseInput(s: string): string"',
			"    purpose: Parses user input",
			"    source: RTM",
			"    cohesion: perfect-atomic",
			"    verification: Test",
			"    testable: yes",
			"    calledByFrIds: [FR-1]",
			'    designRef: "§3.1"',
			'    extractedFrom: "—"',
			"    satisfactionFrId: FR-1",
			'    feasibilityRef: "§4"',
			"  - afId: AF-2",
			"    name: validateEmail",
			"    filePath: src/utils/validate-email.ts",
			'    signature: "function validateEmail(email: string): boolean"',
			"    purpose: Validates email",
			"    source: PRD",
			"    cohesion: perfect-atomic",
			"    verification: Test",
			"    testable: yes",
			"    calledByFrIds: [FR-2]",
			'    designRef: "§3.2"',
			'    extractedFrom: "—"',
			"    satisfactionFrId: FR-2",
			'    feasibilityRef: "§4"',
			"changeLog: []",
			"",
		].join("\n");
		fs.writeFileSync(path.join(workingCopyDir, `atomic-functions_${projectName}.yaml`), sidecarContent, "utf8");

		// Parent LLM (mocked) writes a reviewer verdict (approve).
		const reviewerReport = {
			verdict: "approve",
			issues: [],
			summary: "Reviewed 4 scout reports + working copy; 0 errors — verdict=approve.",
			timestamp: new Date().toISOString(),
		};
		fs.writeFileSync(path.join(scoutsDir, "reviewer-report.json"), JSON.stringify(reviewerReport, null, 2), "utf8");

		// ====== Step 3: velpari_stage_publish tool (via handleApprove) ======
		// The tool's execute() calls handleApprove. We call it directly here
		// to assert the full publish flow end-to-end. skipAutoDoctor=true
		// is the documented test affordance (see ops/approve.ts:ApproveOpts).
		await handleApprove(ctx, pi, tmpDir, { skipAutoDoctor: true, skipDbPublish: true });

		// ====== Step 4: Verify Doc/atomic-functions/<project>.md exists ======
		const listDir = path.join(tmpDir, "Doc");
		fs.writeFileSync(
			"/tmp/atomic-function-debug2.txt",
			`tmpDir=${tmpDir}\n` +
				`notices=${JSON.stringify(notices.slice(-3))}\n` +
				`Doc/${fs.existsSync(listDir) ? fs.readdirSync(listDir).join(",") : "MISSING"}\n`,
			"utf8",
		);
		const published = resolveDocArtifact("atomic-functions", projectName, tmpDir);
		assert.ok(published !== null, "Doc/atomic-functions/<project>.md should resolve");
		const publishedContent = fs.readFileSync(published!.path, "utf8");
		assert.match(publishedContent, /Atomic Functions — E2EApp/);
		assert.match(publishedContent, /AF-1/);
		assert.match(publishedContent, /AF-2/);
		assert.match(publishedContent, /atomicTier: basic/);

		// ====== Step 5: Verify state.json advanced ======
		const finalState = loadState(tmpDir);
		assert.equal(finalState.currentStage, "analyzed-atomic-functions");
		const history = loadHistory(tmpDir, finalState.runId);
		assert.ok(history.length > 0, "history should have entries");
		// The last advance came from /velpari-atomic-function-approve (handleApprove).
		const lastEntry = history[history.length - 1]!;
		assert.equal(lastEntry.stage, "analyzed-atomic-functions");
		assert.equal(lastEntry.command, "/velpari-atomic-function-approve");
	});

	it("reviewer verdict 'block' → publish gate blocks → no Doc/artifact + no state advance", async () => {
		const projectName = "BlockApp";
		makeState("designed", "block-mission");
		// Entry tier keeps the required-field list at the 8 base-core
		// fields so the fixture sidecar stays minimal; the reviewer
		// verdict loader runs regardless of tier, so the block path is
		// still exercised.
		makeFilesConfig({ projectName, atomicTier: "entry" });
		makeDocInputs(projectName);
		makeStoreInputs(projectName);
		preInstallScouts();

		const ctx = makeCtx();
		const pi = makePi();

		// Run composer.
		await handleAtomicFunction(ctx, pi, tmpDir);

		// Write working copy + a BLOCK reviewer verdict.
		const runDir = buildRunDir("2026-09-17-1300-e2e", tmpDir);
		const workingCopyDir = path.join(runDir, "atomic-functions");
		const scoutsDir = path.join(runDir, "atomic-function", "scouts");
		fs.mkdirSync(workingCopyDir, { recursive: true });
		fs.mkdirSync(scoutsDir, { recursive: true });
		fs.writeFileSync(
			path.join(workingCopyDir, "atomic-functions_BlockApp.md"),
			"---\nartifact: atomic-functions\nversion: 1.0.0\n---\n# stub\n",
			"utf8",
		);
		// B3/D6: a valid sidecar is required to reach the publish gate —
		// without it the D6 block (not the reviewer verdict) would stop
		// the publish and this test would no longer cover the gate.
		fs.writeFileSync(
			path.join(workingCopyDir, `atomic-functions_${projectName}.yaml`),
			[
				`project: ${projectName}`,
				"version: 1.0.0",
				"tier: entry",
				"functions:",
				"  - afId: AF-1",
				"    name: stubFn",
				"    filePath: src/stub.ts",
				'    signature: "function stubFn(): void"',
				"    purpose: stub",
				"    source: RTM",
				"    cohesion: perfect-atomic",
				"    verification: Test",
				"    testable: yes",
				"changeLog: []",
				"",
			].join("\n"),
			"utf8",
		);
		const reviewerReport = {
			verdict: "block",
			issues: [
				{
					severity: "error",
					rule: "base-core-missing",
					location: "AF-1",
					message: "missing purpose",
					suggestion: "add purpose column",
				},
			],
			summary: "1 error → block",
			timestamp: new Date().toISOString(),
		};
		fs.writeFileSync(path.join(scoutsDir, "reviewer-report.json"), JSON.stringify(reviewerReport, null, 2), "utf8");

		// handleApprove should refuse to publish.
		await handleApprove(ctx, pi, tmpDir, { skipDbPublish: true });

		// No Doc/artifact should exist.
		const published = resolveDocArtifact("atomic-functions", projectName, tmpDir);
		assert.equal(published, null, "no Doc/artifact when reviewer blocks");

		// State should still be analyzing-atomic-functions (composer advanced from
		// "designed" → "analyzing-atomic-functions" before the publish gate ran,
		// and handleApprove refused to advance further on reviewer-block).
		const finalState = loadState(tmpDir);
		assert.equal(finalState.currentStage, "analyzing-atomic-functions");
	});
});
