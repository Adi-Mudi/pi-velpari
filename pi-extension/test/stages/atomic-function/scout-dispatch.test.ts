/**
 * PHASE 3 — scout dispatch tests (Phase 4 of atomic-function-layer plan).
 *
 * Verifies `stages/atomic-function/scout-dispatch.ts:dispatchScouts`
 * against the contract in the file's JSDoc:
 *
 *   - bootstrap-missing     — agents not in `.pi/agents/` → installed
 *   - bootstrap-present     — agents already there → no copy
 *   - reviewer-kept         — tier=advanced → 5 scouts (incl. reviewer)
 *   - reviewer-filtered     — tier=entry → 4 scouts (reviewer removed)
 *   - overlay-requires      — overlay.requiresReviewer=true + tier=entry → 5 scouts
 *   - paths-built           — workingCopyPath ends with atomic-functions_<project>.md
 *
 * Uses real temp directories + the bundled scout files as fixtures so
 * ensureStageAgents does the actual copy.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { dispatchScouts } from "../../../src/stages/atomic-function/scout-dispatch.js";
import { runPreCondition } from "../../../src/stages/atomic-function/pre-condition.js";
import { DEFAULT_ATOMIC_PROFILE, type AtomicProfile } from "../../../src/core/atomic-tier.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { RunState } from "../../../src/core/state.js";

let tmpDir: string;
let notices: Array<{ message: string; level: string }>;

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

function makeState(stage: RunState["currentStage"], opts: {
	standardsProfile?: { id: string; version: string };
} = {}): void {
	const dir = path.join(tmpDir, ".pi", "velpari");
	fs.mkdirSync(dir, { recursive: true });
	const state: RunState & { standardsProfile?: unknown } = {
		version: 1,
		runId: "2026-09-17-1200-test",
		mission: "test-mission",
		currentStage: stage,
		history: [],
		updatedAt: new Date().toISOString(),
	};
	if (opts.standardsProfile) {
		(state as unknown as Record<string, unknown>)["standardsProfile"] = opts.standardsProfile;
	}
	fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2), "utf8");
}

function makeFilesConfig(opts: {
	projectName: string;
	atomic?: Partial<AtomicProfile>;
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
				atomic: opts.atomic ?? {},
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
}

/** Pre-populate `.pi/agents/` so ensureStageAgents has nothing to do. */
function preInstallAllScouts(): void {
	const agentsDir = path.join(tmpDir, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	const scouts = [
		"af-source-rtm",
		"af-source-design",
		"af-source-prd",
		"af-source-feas",
		"reviewer",
	];
	for (const s of scouts) {
		fs.writeFileSync(
			path.join(agentsDir, `${s}.md`),
			`---\nname: ${s}\ndescription: stub\n---\n# stub\n`,
			"utf8",
		);
	}
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-scout-dispatch-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("dispatchScouts — bootstrap", () => {
	it("installs the 5 scout agents when .pi/agents/ is empty", () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp", atomic: { tier: "advanced" } });
		makeAllInputs("TestApp");

		const pre = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(pre.kind, "ok");
		if (pre.kind !== "ok") return;

		const ctx = makeCtx();
		const result = dispatchScouts({ ctx, cwd: tmpDir, pre });

		// 5 agents should be installed
		assert.equal(result.bootstrap.installed.length, 5);
		assert.equal(result.bootstrap.alreadyPresent.length, 0);
		assert.equal(result.bootstrap.missing.length, 0);

		// And the files should now exist on disk
		const agentsDir = path.join(tmpDir, ".pi", "agents");
		for (const name of ["af-source-rtm", "af-source-design", "af-source-prd", "af-source-feas", "reviewer"]) {
			assert.ok(
				fs.existsSync(path.join(agentsDir, `${name}.md`)),
				`expected ${name}.md to be installed`,
			);
		}
	});

	it("marks all 5 scouts alreadyPresent when pre-installed", () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp", atomic: { tier: "advanced" } });
		makeAllInputs("TestApp");
		preInstallAllScouts();

		const pre = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(pre.kind, "ok");
		if (pre.kind !== "ok") return;

		const ctx = makeCtx();
		const result = dispatchScouts({ ctx, cwd: tmpDir, pre });

		assert.equal(result.bootstrap.installed.length, 0);
		assert.equal(result.bootstrap.alreadyPresent.length, 5);
	});
});

describe("dispatchScouts — reviewer gate", () => {
	it("tier=advanced → 5 scouts (reviewer kept)", () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp", atomic: { tier: "advanced" } });
		makeAllInputs("TestApp");
		preInstallAllScouts();

		const pre = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(pre.kind, "ok");
		if (pre.kind !== "ok") return;

		const ctx = makeCtx();
		const result = dispatchScouts({ ctx, cwd: tmpDir, pre });

		assert.equal(result.scouts.length, 5);
		assert.ok(result.scouts.some((s) => s.name === "reviewer"));
	});

	it("tier=entry → 4 scouts (reviewer filtered out)", () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp", atomic: { tier: "entry" } });
		makeAllInputs("TestApp");
		preInstallAllScouts();

		const pre = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(pre.kind, "ok");
		if (pre.kind !== "ok") return;

		const ctx = makeCtx();
		const result = dispatchScouts({ ctx, cwd: tmpDir, pre });

		assert.equal(result.scouts.length, 4);
		assert.ok(!result.scouts.some((s) => s.name === "reviewer"));
	});

	it("overlay.requiresReviewer=true + tier=basic → 5 scouts (reviewer kept)", () => {
		makeState("designed", { standardsProfile: { id: "medical-device-b", version: "1.0.0" } });
		makeFilesConfig({ projectName: "TestApp", atomic: { tier: "basic" } });
		makeAllInputs("TestApp");
		preInstallAllScouts();

		const pre = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(pre.kind, "ok");
		if (pre.kind !== "ok") return;

		const ctx = makeCtx();
		const result = dispatchScouts({ ctx, cwd: tmpDir, pre });

		assert.equal(result.scouts.length, 5);
		assert.ok(result.scouts.some((s) => s.name === "reviewer"));
	});
});

describe("dispatchScouts — paths", () => {
	it("builds workingCopyPath ending with atomic-functions_TestApp.md", () => {
		makeState("designed");
		makeFilesConfig({ projectName: "TestApp" });
		makeAllInputs("TestApp");
		preInstallAllScouts();

		const pre = runPreCondition({ cwd: tmpDir, stageKey: "atomic-function" });
		assert.equal(pre.kind, "ok");
		if (pre.kind !== "ok") return;

		const ctx = makeCtx();
		const result = dispatchScouts({ ctx, cwd: tmpDir, pre });

		assert.match(result.paths.workingCopyPath, /atomic-functions_TestApp\.md$/);
		assert.match(result.paths.scoutsDir, /scouts$/);
		assert.match(result.paths.runDir, /\/runs\/2026-09-17-1200-test$/);
	});
});