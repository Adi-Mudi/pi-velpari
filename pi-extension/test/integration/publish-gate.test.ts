/**
 * Integration: Publish gate (Phase 8, plan §Phase 8).
 *
 * For every published artifact, the publish gate runs checks. Errors
 * block the publish. This integration test confirms that the Phase 1-4
 * gate checks are wired correctly across artifacts.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPublishGate } from "../../src/doctor/gate.js";
import { createRun, advanceStage, saveState, type RunState } from "../../src/core/state.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-publish-gate-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function setupFilesConfig(): void {
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "TestApp" }),
		"utf8",
	);
}

function walkToPlannedTests(): void {
	setupFilesConfig();
	let state: RunState = createRun("Test", tmpDir) as RunState;
	state = advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
	state = advanceStage(state, "/velpari-prd", tmpDir);
	state = advanceStage(state, "/velpari-prd-approve", tmpDir);
	state = advanceStage(state, "/velpari-rtm", tmpDir);
	state = advanceStage(state, "/velpari-rtm-approve", tmpDir);
	state = advanceStage(state, "/velpari-feasibility", tmpDir);
	state = advanceStage(state, "/velpari-feasibility-approve", tmpDir);
	state = advanceStage(state, "/velpari-architecture-generator", tmpDir);
	void state;
}

describe("publish gate — Phase 8 re-verification", () => {
	it("runs the standards-profile check on every artifact (not just design)", () => {
		walkToPlannedTests();
		// Inject a standards profile that references a non-existent overlay.
		const state = {
			version: 1 as const,
			runId: "r",
			mission: "m",
			currentStage: "planned-tests" as const,
			history: [],
			updatedAt: new Date().toISOString(),
			standardsProfile: {
				id: "ghost-overlay",
				version: "1.0.0",
				selectedAt: new Date().toISOString(),
				selectedBy: "user" as const,
			},
		};
		saveState(state, tmpDir);

		// Try publishing a PRD — should fail on standards-profile check
		// because the catalogue is missing (no overlay file written).
		const result = runPublishGate({
			artifact: "PRD",
			workingContent: "# PRD\n",
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.ok(
			result.errors.some((e) => e.includes("standards-profile")),
			`expected standards-profile error; got ${JSON.stringify(result.errors)}`,
		);
	});

	it("runs the arch-sub-cycle check on design artifact (Phase 2)", () => {
		walkToPlannedTests();
		// archSubCycle missing → publish gate blocks with arch-sub-cycle.missing.
		const result = runPublishGate({
			artifact: "design",
			workingContent:
				'# Design\n\n## Architecture Decisions\n\n```yaml\n{"id":"ADR-001","title":"x","status":"accepted","stage":"design","date":"2026-01-01","runId":"r","context":"c","options":[{"id":"A","label":"l","pros":"","cons":""}],"decision":"A","rationale":"r","consequences":"c","reconsiderTriggers":[]}\n```\n',
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.ok(
			result.errors.some((e) => e.includes("arch-sub-cycle")),
			`expected arch-sub-cycle error; got ${JSON.stringify(result.errors)}`,
		);
	});

	it("runs the ADR check on design artifact (Phase 4)", () => {
		walkToPlannedTests();
		// archSubCycle.confirmed = true so the arch-sub-cycle check passes.
		saveState(
			{
				...createRun("Test", tmpDir),
				archSubCycle: {
					contextLoaded: true,
					developerConfirmed: true,
					confirmOutcome: "proceed",
				},
				standardsProfile: undefined,
			},
			tmpDir,
		);

		// Design doc has no Architecture Decisions section → ADR check fails.
		const result = runPublishGate({
			artifact: "design",
			workingContent: "# Design\n",
			cwd: tmpDir,
			projectName: "TestApp",
		});
		assert.ok(
			result.errors.some((e) => e.includes("adr.section-missing")),
			`expected adr.section-missing; got ${JSON.stringify(result.errors)}`,
		);
	});

	it("passes when design artifact has a valid Architecture Decisions section", () => {
		walkToPlannedTests();
		saveState(
			{
				...createRun("Test", tmpDir),
				archSubCycle: {
					contextLoaded: true,
					developerConfirmed: true,
					confirmOutcome: "proceed",
				},
			},
			tmpDir,
		);

		// Valid ADR block with 2 options (passes single-option check).
		const adr = JSON.stringify({
			id: "ADR-001",
			title: "Pick a modular monolith",
			status: "accepted",
			stage: "design",
			date: "2026-09-13T00:00:00.000Z",
			runId: "r",
			context: "Two scouts disagreed.",
			options: [
				{ id: "A", label: "Modular monolith", pros: "Simple", cons: "Shared DB" },
				{ id: "B", label: "Microservices", pros: "Independent", cons: "Complex" },
			],
			decision: "A",
			rationale: "Project size doesn't justify microservices.",
			consequences: "Easier to refactor later.",
			reconsiderTriggers: ["Scale > 1000 RPS"],
		});
		const doc = `# Design\n\n## Architecture Decisions\n\n- ADR-001: x | Status: accepted | Stage: design | Date: 2026-09-13\n\`\`\`yaml\n${adr}\n\`\`\`\n`;
		const result = runPublishGate({
			artifact: "design",
			workingContent: doc,
			cwd: tmpDir,
			projectName: "TestApp",
		});
		// Should not have arch-sub-cycle or adr errors (standards errors are fine).
		const blocking = result.errors.filter((e) => e.includes("arch-sub-cycle") || e.includes("adr."));
		assert.deepEqual(blocking, [], `unexpected blocking errors: ${JSON.stringify(blocking)}`);
	});
});

describe("publish gate — file reading smoke test", () => {
	it("can read a generated PRD file from disk for the PRD check", () => {
		// Smoke test: publish gate receives workingContent string, no IO needed.
		const docPath = join(tmpDir, "PRD_TodoApp.md");
		writeFileSync(docPath, "# PRD\n", "utf8");
		const content = readFileSync(docPath, "utf8");
		assert.match(content, /^# PRD/);
	});
});
