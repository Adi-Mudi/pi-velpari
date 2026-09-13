/**
 * Handoff MVP gate tests (MVP/phase traceability upgrade, Phase 4).
 *
 * /velpari-handoff is the "MVP is ready" signal:
 *   - Phase-1 requirement with no RTM row or coverage "missing" BLOCKS
 *     the handoff (nothing written, stage not advanced)
 *   - partial coverage / missing test links only warn
 *   - full MVP coverage hands off normally
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runHandoff } from "../../src/ops/handoff.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";
import { buildGroupedPath } from "../../src/core/paths.js";
import type { RtmRow } from "../../src/core/rtm-data.js";

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
			confirm: async () => true,
		},
	} as unknown as ExtensionCommandContext;
}

function allMessages(): string {
	return notices.map((n) => n.message).join("\n");
}

const PSRS = [
	"# PSRS",
	"",
	"## Functional Requirements",
	"",
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|---|",
	"| FR-01 | The system SHALL save expenses | must | 1 | expense saved | Integration test | approved |",
	"",
	"## Non-Functional Requirements",
	"",
	"| ID | Category | Requirement | Phase | Verification | Status |",
	"|---|---|---|---|---|---|",
	"| NFR-01 | performance | p95 SHALL stay < 200ms | 1 | Performance test | approved |",
	"",
].join("\n");

function row(id: string, overrides: Partial<RtmRow> = {}): RtmRow {
	return {
		id,
		title: id,
		phase: 1,
		design: "",
		implementation: "",
		tests: ["TC-1"],
		status: "approved",
		coverage: "covered",
		...overrides,
	};
}

/** Seed config, all 7 required artifacts, PSRS + RTM JSON. */
function seed(rows: RtmRow[]): void {
	fs.mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({
			version: 4,
			projectName: "TestApp",
			framework: "node",
			codePaths: [],
			inputDocuments: [],
			testPaths: [],
			outputPaths: {},
			excludedPaths: [],
		}),
	);
	for (const artifact of ["PRD", "RTM", "feasibility-study", "design", "pseudocode", "test-plan", "test-cases"]) {
		const p = path.join(tmpDir, buildGroupedPath(artifact, "TestApp"));
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, artifact === "PRD" ? PSRS : `# ${artifact}\n`);
	}
	const rtmJson = path.join(tmpDir, buildGroupedPath("RTM", "TestApp")).replace(/\.md$/, ".json");
	fs.writeFileSync(
		rtmJson,
		JSON.stringify({ project: "TestApp", version: "1.0.0", rows }),
	);
}

function enterPlannedTests(): void {
	const run = createRun("TestApp", tmpDir);
	saveState({ ...run, currentStage: "planned-tests" }, tmpDir);
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-handoff-mvp-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("/velpari-handoff — MVP coverage gate", () => {
	it("blocks when a Phase-1 requirement has no RTM row", async () => {
		enterPlannedTests();
		seed([row("FR-01")]); // NFR-01 missing
		await runHandoff(loadState(tmpDir), makeCtx(), tmpDir);

		assert.match(allMessages(), /Handoff blocked — MVP coverage 1\/2/);
		assert.match(allMessages(), /NFR-01: Phase-1 \(MVP\) requirement has no RTM row/);
		assert.equal(fs.existsSync(path.join(tmpDir, ".pi", "senai", "architect-inputs.json")), false);
		assert.equal(loadState(tmpDir).currentStage, "planned-tests", "stage must not advance");
	});

	it("blocks when a Phase-1 requirement coverage is missing", async () => {
		enterPlannedTests();
		seed([row("FR-01"), row("NFR-01", { coverage: "missing", tests: [] })]);
		await runHandoff(loadState(tmpDir), makeCtx(), tmpDir);

		assert.match(allMessages(), /Handoff blocked/);
		assert.match(allMessages(), /NFR-01: MVP requirement coverage is "missing"/);
		assert.equal(fs.existsSync(path.join(tmpDir, ".pi", "senai", "architect-inputs.json")), false);
	});

	it("warns but proceeds on partial coverage", async () => {
		enterPlannedTests();
		seed([row("FR-01"), row("NFR-01", { coverage: "partial" })]);
		await runHandoff(loadState(tmpDir), makeCtx(), tmpDir);

		assert.match(allMessages(), /warnings:[\s\S]*NFR-01: MVP requirement coverage is "partial"/);
		assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "senai", "architect-inputs.json")), "handoff written");
	});

	it("hands off cleanly at full MVP coverage", async () => {
		enterPlannedTests();
		seed([row("FR-01"), row("NFR-01")]);
		await runHandoff(loadState(tmpDir), makeCtx(), tmpDir);

		assert.ok(fs.existsSync(path.join(tmpDir, ".pi", "senai", "architect-inputs.json")));
		assert.equal(loadState(tmpDir).currentStage, "handoff-ready");
	});
});
