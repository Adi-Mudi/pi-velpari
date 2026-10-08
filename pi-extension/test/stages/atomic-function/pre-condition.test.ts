/**
 * PHASE 1 — pre-condition tests (Phase 2 of atomic-function-layer plan).
 *
 * Verifies `stages/atomic-function/pre-condition.ts:runPreCondition`
 * against the contract in the file's JSDoc:
 *
 *   - gate-pass            — state=designed, all fixtures present → kind="ok"
 *   - gate-fail            — wrong stage → kind="error" with correct next hint
 *   - profile-defaults     — no files.json:atomic → DEFAULT_ATOMIC_PROFILE
 *   - reviewer-entry       — tier=entry, no overlay → reviewerRequired=false
 *   - reviewer-advanced    — tier=advanced → reviewerRequired=true
 *   - overlay-requires     — overlay.requiresReviewer=true + tier=basic → reviewerRequired=true
 *   - reviewer-mode-always — reviewerMode=always overrides tier
 *   - reviewer-mode-never  — reviewerMode=never overrides tier
 *
 * Uses real temp directories + the existing state/config helpers to keep
 * the test honest about how the function reads its inputs.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runPreCondition } from "../../../src/stages/atomic-function/pre-condition.js";
import { DEFAULT_ATOMIC_PROFILE, type AtomicProfile } from "../../../src/core/atomic-tier.js";
import type { RunState } from "../../../src/core/state.js";
import { openStoreDb, closeStoreDb } from "../../../src/io/db.js";
import { writeArtifact, publishArtifact, type ArtifactEnvelopeInput } from "../../../src/io/store.js";
import { buildStoreDbPath } from "../../../src/core/paths.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-precondition-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write `.pi/velpari/state.json` directly with the given stage. */
function makeState(
	stage: RunState["currentStage"],
	opts: {
		runId?: string;
		mission?: string;
		standardsProfile?: { id: string; version: string };
	} = {},
): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	const state: RunState & { standardsProfile?: unknown } = {
		version: 1,
		runId: opts.runId ?? "2026-09-16-1200-test",
		mission: opts.mission ?? "test-mission",
		currentStage: stage,
		history: [],
		updatedAt: new Date().toISOString(),
	};
	if (opts.standardsProfile) {
		(state as unknown as Record<string, unknown>)["standardsProfile"] = opts.standardsProfile;
	}
	fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2), "utf8");
}

/** Write `.pi/velpari/files.json` with the project name + atomic profile. */
function makeFilesConfig(opts: { projectName: string; atomic?: Partial<AtomicProfile> }): void {
	const cfg = {
		version: 4,
		framework: { language: "typescript" },
		codePaths: ["src/**/*.ts"],
		testPaths: ["test/**/*.test.ts"],
		documentPaths: ["Doc/**/*.md"],
		excludedPaths: ["node_modules/**"],
		projectName: opts.projectName,
		atomic: opts.atomic ?? {},
	};
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(path.join(tmpDir, ".pi", "velpari", "files.json"), JSON.stringify(cfg, null, 2), "utf8");
}

/** Create `Doc/<artifact>_<project>.md` (grouped layout) for every input. */
function makeAllInputs(projectName: string): void {
	const docDir = path.join(tmpDir, "Doc");
	fs.mkdirSync(docDir, { recursive: true });
	const artifacts = ["PRD", "RTM", "feasibility-study", "design"];
	for (const a of artifacts) {
		fs.writeFileSync(path.join(docDir, `${a}_${projectName}.md`), `# ${a} fixture\n`, "utf8");
	}
	seedStore(projectName);
}

/**
 * Phase 6: the atomic-function stage resolves its inputs from the project
 * store (strict DB read, §14.1) — publish the four upstream kinds so the
 * fixture's pre-condition/slice gate passes.
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

describe("runPreCondition — gate-pass", () => {
	it("returns kind=ok when state=designed, project name set, all inputs present", () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp" });
		makeAllInputs("TestApp");

		const result = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(result.kind, "ok");
		if (result.kind !== "ok") return;
		assert.equal(result.projectName, "TestApp");
		assert.equal(result.state.currentStage, "designed");
		assert.equal(result.state.mission, "test-mission");
		assert.equal(result.reviewerRequired, false); // tier=basic default
		assert.equal(result.overlayRequiresReviewer, false);
	});
});

describe("runPreCondition — gate-fail", () => {
	it("returns kind=error when current stage is drafting-prd (wrong upstream)", () => {
		makeState("drafting-prd");
		makeFilesConfig({ projectName: "TestApp" });
		makeAllInputs("TestApp");

		const result = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(result.kind, "error");
		if (result.kind !== "error") return;
		assert.match(result.message, /Cannot run \/velpari-atomic-function/);
		assert.match(result.message, /Run .* first/);
	});
});

describe("runPreCondition — profile-defaults", () => {
	it("returns DEFAULT_ATOMIC_PROFILE when files.json:atomic is absent", () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp" });
		makeAllInputs("TestApp");

		const result = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(result.kind, "ok");
		if (result.kind !== "ok") return;
		assert.deepEqual(result.atomicProfile.tier, DEFAULT_ATOMIC_PROFILE.tier);
		assert.deepEqual(result.atomicProfile.safetyClass, DEFAULT_ATOMIC_PROFILE.safetyClass);
		assert.deepEqual(result.atomicProfile.sil, DEFAULT_ATOMIC_PROFILE.sil);
	});
});

describe("runPreCondition — reviewer gate (tier)", () => {
	it("tier=entry → reviewerRequired=false", () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp", atomic: { tier: "entry" } });
		makeAllInputs("TestApp");

		const result = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(result.kind, "ok");
		if (result.kind !== "ok") return;
		assert.equal(result.reviewerRequired, false);
	});

	it("tier=advanced → reviewerRequired=true", () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp", atomic: { tier: "advanced" } });
		makeAllInputs("TestApp");

		const result = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(result.kind, "ok");
		if (result.kind !== "ok") return;
		assert.equal(result.reviewerRequired, true);
	});
});

describe("runPreCondition — reviewer gate (overlay)", () => {
	it("overlay.requiresReviewer=true + tier=basic → reviewerRequired=true", () => {
		makeState("designed", { standardsProfile: { id: "medical-device-b", version: "1.0.0" } });
		makeFilesConfig({ projectName: "TestApp", atomic: { tier: "basic" } });
		makeAllInputs("TestApp");

		const result = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(result.kind, "ok");
		if (result.kind !== "ok") return;
		assert.equal(result.overlayRequiresReviewer, true);
		assert.equal(result.reviewerRequired, true);
	});
});

describe("runPreCondition — reviewer gate (reviewerMode override)", () => {
	it("reviewerMode=always → reviewerRequired=true regardless of tier", () => {
		makeState("designed");
		makeFilesConfig({
			projectName: "TestApp",
			atomic: { tier: "entry", reviewerMode: "always" },
		});
		makeAllInputs("TestApp");

		const result = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(result.kind, "ok");
		if (result.kind !== "ok") return;
		assert.equal(result.reviewerRequired, true);
	});

	it("reviewerMode=never → reviewerRequired=false regardless of tier", () => {
		makeState("designed");
		makeFilesConfig({
			projectName: "TestApp",
			atomic: { tier: "advanced", reviewerMode: "never" },
		});
		makeAllInputs("TestApp");

		const result = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(result.kind, "ok");
		if (result.kind !== "ok") return;
		assert.equal(result.reviewerRequired, false);
	});
});
