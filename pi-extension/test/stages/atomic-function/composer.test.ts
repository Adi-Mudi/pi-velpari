/**
 * PHASE 8 — composer integration tests (Gap A: layer wired into runtime).
 *
 * Verifies `stages/atomic-function/index.ts:handleAtomicFunction`
 * actually CALLS the dedicated layer helpers (Phase 1, 2, 3) — proving
 * the layer is no longer library-only.
 *
 *   - composer-calls-layer — from `designed` state, the handler:
 *       - runs Phase 1 (runPreCondition) — validates + returns profile
 *       - runs Phase 2 (buildAtomicFunctionPrompt) — renders prompt
 *       - runs Phase 3 (dispatchScouts) — bootstraps + filters
 *       - sends the prompt to parent LLM via pi.sendUserMessage
 *
 *   - composer-tier-block — the Atomic Profile block is present with
 *     the right tier label, base-core fields, tier-specific fields.
 *
 *   - composer-gate-fail — wrong stage → no handoff + error notify.
 *
 *   - composer-update-mode — published atomic-functions baseline
 *     triggers Update Mode in the prompt.
 *
 *   - legacy-file-removed — stages/atomic-function.ts no longer exists.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { handleAtomicFunction } from "../../../src/stages/atomic-function/index.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { RunState } from "../../../src/core/state.js";
import { openStoreDb, closeStoreDb } from "../../../src/io/db.js";
import { writeArtifact, publishArtifact, type ArtifactEnvelopeInput } from "../../../src/io/store.js";
import { buildStoreDbPath } from "../../../src/core/paths.js";

let tmpDir: string;
let notices: Array<{ message: string; level: string }>;
let sentMessages: string[];

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

function makePi(): ExtensionAPI {
	sentMessages = [];
	return {
		sendUserMessage: (msg: string) => {
			sentMessages.push(msg);
		},
	} as unknown as ExtensionAPI;
}

function makeState(stage: RunState["currentStage"]): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	const state: RunState = {
		version: 1,
		runId: "2026-09-17-1200-test",
		mission: "test-mission",
		currentStage: stage,
		history: [],
		updatedAt: new Date().toISOString(),
	};
	fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2), "utf8");
}

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

function makeAllInputs(projectName: string): void {
	const docDir = path.join(tmpDir, "Doc");
	fs.mkdirSync(docDir, { recursive: true });
	const artifacts = ["PRD", "RTM", "feasibility-study", "design"];
	for (const a of artifacts) {
		fs.writeFileSync(path.join(docDir, `${a}_${projectName}.md`), `# ${a}\n`, "utf8");
	}
	seedStore(projectName);
}

/**
 * Phase 6: the atomic-function stage resolves its inputs from the project
 * store (strict DB read, §14.1) — publish the four upstream kinds so the
 * composer's slice gate passes.
 */
function seedStore(projectName: string): void {
	const db = openStoreDb(buildStoreDbPath(projectName, tmpDir));
	try {
		const env = (stage: string): ArtifactEnvelopeInput => ({
			version: 1,
			stage,
			generatedAt: "2026-09-23T00:00:00.000Z",
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
			rtmRow: [{ id: "FR-1", frRef: "FR-1", afRef: null, tcRef: null, phase: 1, targetSha256: "a".repeat(64) }],
		});
		publishArtifact(db, "r1", "rtm");
		writeArtifact(db, "feasibility", "r1", env("analyzing-feasibility"), {
			feasibilityDecision: {
				verdict: "go",
				language: "typescript",
				decidedBy: "user",
				at: "2026-09-23T00:00:00.000Z",
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

function makePublishedBaseline(projectName: string): void {
	// Published baseline triggers update mode.
	const docDir = path.join(tmpDir, "Doc", "atomic-functions");
	fs.mkdirSync(docDir, { recursive: true });
	fs.writeFileSync(
		path.join(docDir, `atomic-functions_${projectName}.md`),
		`---\nartifact: atomic-functions\nversion: 1.0.0\n---\n# existing\n`,
		"utf8",
	);
}

function preInstallAllScouts(): void {
	const agentsDir = path.join(tmpDir, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	const scouts = ["af-source-rtm", "af-source-design", "af-source-prd", "af-source-feas", "reviewer"];
	for (const s of scouts) {
		fs.writeFileSync(path.join(agentsDir, `${s}.md`), `---\nname: ${s}\ndescription: stub\n---\n# stub\n`, "utf8");
	}
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-composer-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleAtomicFunction — composer calls the layer", () => {
	it("runs Phase 1 + Phase 2 + Phase 3 (proven via prompt content)", async () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp", atomicTier: "advanced" });
		makeAllInputs("TestApp");
		preInstallAllScouts();

		const ctx = makeCtx();
		const pi = makePi();

		await handleAtomicFunction(ctx, pi, tmpDir);

		// Exactly one prompt sent (Phase 2's output).
		assert.equal(sentMessages.length, 1);

		const prompt = sentMessages[0]!;

		// Phase 1 evidence — Atomic Profile block renders with the configured tier.
		assert.match(
			prompt,
			/## Atomic Profile \(ISO\/IEC 29110 \+ IEC 61508\/IEC 62304\)/,
			"Phase 1 + Phase 2 evidence: Atomic Profile block from runPreCondition + buildAtomicFunctionPrompt",
		);
		assert.match(prompt, /Tier: Advanced/, "Phase 1 evidence: atomicProfile.tier = advanced is rendered");

		// Phase 3 evidence — all 5 scouts listed (reviewer kept at advanced tier).
		assert.match(prompt, /af-source-rtm-report\.json/);
		assert.match(prompt, /af-source-design-report\.json/);
		assert.match(prompt, /af-source-prd-report\.json/);
		assert.match(prompt, /af-source-feas-report\.json/);
		assert.match(
			prompt,
			/reviewer-report\.json/,
			"Phase 3 evidence: reviewer slot kept by filterReviewerSlot (tier=advanced)",
		);

		// Scout reports path appears (from dispatchScouts.paths.scoutsDir).
		assert.match(prompt, /scouts\/af-source-rtm-report\.json/);

		// Working copy path appears (from dispatchScouts.paths.workingCopyPath).
		assert.match(prompt, /atomic-functions_TestApp\.md/, "dispatchScouts.paths.workingCopyPath appears in the prompt");

		// Mission + run id from runPreCondition.state.
		assert.match(prompt, /Mission: test-mission/);
		assert.match(prompt, /Run ID: 2026-09-17-1200-test/);
	});

	it("filters the reviewer slot at entry (4 scouts, no reviewer)", async () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp", atomicTier: "entry" });
		makeAllInputs("TestApp");
		preInstallAllScouts();

		const ctx = makeCtx();
		const pi = makePi();

		await handleAtomicFunction(ctx, pi, tmpDir);

		const prompt = sentMessages[0]!;
		assert.match(prompt, /Tier: Entry/);
		assert.doesNotMatch(prompt, /reviewer-report\.json/, "entry tier filters out the reviewer slot");
		// 4 source scouts still listed.
		assert.match(prompt, /af-source-rtm-report\.json/);
		assert.match(prompt, /af-source-design-report\.json/);
		assert.match(prompt, /af-source-prd-report\.json/);
		assert.match(prompt, /af-source-feas-report\.json/);
	});

	it("renders Update Mode block when a published baseline exists", async () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp" });
		makeAllInputs("TestApp");
		makePublishedBaseline("TestApp");
		preInstallAllScouts();

		const ctx = makeCtx();
		const pi = makePi();

		await handleAtomicFunction(ctx, pi, tmpDir);

		const prompt = sentMessages[0]!;
		// 'Append-only IDs' is unique to the rendered Update Mode block (the
		// skill markdown itself has its own "## Update Mode" header).
		assert.match(prompt, /Append-only IDs/, "Update Mode block rendered when published baseline exists");
		// Info notify about update mode fired.
		assert.ok(
			notices.some((n) => n.level === "info" && /Update mode: published atomic-functions found/.test(n.message)),
		);
	});

	it("notifies and bails when pre-condition fails (wrong stage)", async () => {
		makeState("drafting-prd");
		makeFilesConfig({ projectName: "TestApp" });
		makeAllInputs("TestApp");

		const ctx = makeCtx();
		const pi = makePi();

		await handleAtomicFunction(ctx, pi, tmpDir);

		// No prompt sent.
		assert.equal(sentMessages.length, 0);

		// One error notify with the gate message (Phase 1's error branch).
		const errorNotices = notices.filter((n) => n.level === "error");
		assert.ok(errorNotices.length > 0, "expected at least one error notify");
		assert.match(errorNotices[0]!.message, /Cannot run \/velpari-atomic-function/);
	});
});

describe("legacy file removed", () => {
	it("stages/atomic-function.ts no longer exists", () => {
		const legacyPath = path.resolve(
			"/mnt/Just_Do_It/02_Devp_Soft/12_orchestra/wt-atomic-function/pi-extension/src/stages/atomic-function.ts",
		);
		assert.equal(fs.existsSync(legacyPath), false);
	});
});
