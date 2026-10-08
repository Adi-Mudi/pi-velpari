/**
 * Handoff staleness + ID-coverage gate tests (A6 + A4).
 *
 * /velpari-handoff now refuses while anything in the chain is stale or
 * uncovered (gate order D6: stage → config → artifacts → MVP coverage →
 * staleness → ID coverage → payload → schema → confirm → write):
 *   - input-changed / input-missing stale items BLOCK, naming the keys
 *   - no-stamp (legacy unstamped) items warn only (D8)
 *   - ID-coverage `missing` BLOCKS with the rule + missing ids (D7)
 *   - not-checkable legacy docs + dev-order duplicates warn only (D1/D2)
 *   - a clean, fully-stamped chain hands off end-to-end
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
import { hashFileContent } from "../../src/core/fingerprints.js";
import { recordPublish } from "../../src/core/freshness.js";
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

const AF_DOC = [
	"# Atomic Functions",
	"",
	"## Atomic Functions",
	"",
	"| AF ID | Name | File Path |",
	"|---|---|---|",
	"| AF-1 | saveExpense | src/core/save-expense.ts |",
	"",
].join("\n");

const DESIGN_FULL = [
	"# Design",
	"",
	"## 1. Module Breakdown",
	"",
	"| Module | Purpose | Source FRs | Maturity | Depends on |",
	"|---|---|---|---|---|",
	"| core | expenses | FR-01 | proposed | — |",
	"",
	"## 5. Quality Attribute Scenarios",
	"",
	"| NFR ID | Source | Stimulus | Environment | Artifact | Response | Response measure | Approach | Source PRD row |",
	"|---|---|---|---|---|---|---|---|---|",
	"| NFR-01 | user | save | peak | core | fast | p95 < 200ms | tactic | NFR-01 |",
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

function artifactPath(artifact: string): string {
	return path.join(tmpDir, buildGroupedPath(artifact, "TestApp"));
}

function writeArtifact(artifact: string, content: string): void {
	const p = artifactPath(artifact);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content, "utf8");
}

/**
 * Seed config + all required artifacts. `designContent` overrides the
 * design stub (ID-coverage scenarios need a real §1/§5 table); the AF doc,
 * pseudocode, test-cases, and dev-order stubs can be replaced the same way.
 */
function seed(overrides: Record<string, string> = {}): void {
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
	for (const artifact of [
		"PRD",
		"RTM",
		"feasibility-study",
		"design",
		"atomic-functions",
		"pseudocode",
		"test-plan",
		"test-cases",
		"development-order",
		"final-design",
	]) {
		const content = overrides[artifact] ?? (artifact === "PRD" ? PSRS : `# ${artifact}\n`);
		writeArtifact(artifact, content);
	}
	writeArtifact("RTM", "# RTM\n");
	fs.writeFileSync(
		artifactPath("RTM").replace(/\.md$/, ".json"),
		JSON.stringify({ project: "TestApp", version: "1.0.0", rows: [row("FR-01"), row("NFR-01")] }),
	);
}

function enterFinalizedDesign(): void {
	const run = createRun("TestApp", tmpDir);
	saveState({ ...run, currentStage: "finalized-design" }, tmpDir);
}

function payloadExists(): boolean {
	return fs.existsSync(path.join(tmpDir, ".pi", "senai", "architect-inputs.json"));
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-handoff-stale-"));
	enterFinalizedDesign();
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("/velpari-handoff — staleness gate (A6)", () => {
	it("blocks on input-changed, naming the stale keys and the reconfirm remedy (A5)", async () => {
		seed();
		// Stamp the design with a WRONG prd hash → input-changed.
		recordPublish(tmpDir, {
			artifact: "design",
			projectName: "TestApp",
			path: buildGroupedPath("design", "TestApp"),
			publishedAt: new Date().toISOString(),
			inputs: { "prd:TestApp": "0".repeat(64) },
		});
		await runHandoff(loadState(tmpDir), makeCtx(), tmpDir);

		assert.match(allMessages(), /Handoff blocked — 1 stale artifact\(s\)/);
		assert.match(allMessages(), /design:TestApp \(input-changed: prd:TestApp\)/);
		assert.match(allMessages(), /\/velpari-reconfirm if the change has no impact/);
		assert.equal(payloadExists(), false);
		assert.equal(loadState(tmpDir).currentStage, "finalized-design", "stage must not advance");
	});

	it("blocks on input-missing with the republish-only remedy (D4 — no reconfirm)", async () => {
		seed();
		recordPublish(tmpDir, {
			artifact: "design",
			projectName: "TestApp",
			path: buildGroupedPath("design", "TestApp"),
			publishedAt: new Date().toISOString(),
			inputs: { "brainstorm:no-such-topic": "0".repeat(64) },
		});
		await runHandoff(loadState(tmpDir), makeCtx(), tmpDir);

		assert.match(allMessages(), /Handoff blocked — 1 stale artifact\(s\)/);
		assert.match(allMessages(), /design:TestApp \(input-missing/);
		assert.match(allMessages(), /republish required/);
		assert.doesNotMatch(allMessages(), /reconfirm if the change has no impact/);
		assert.equal(payloadExists(), false);
	});

	it("no-stamp warns only and the handoff proceeds (D8)", async () => {
		seed();
		// Legacy manifest entry with no inputs map → no-stamp.
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "freshness.json"),
			JSON.stringify({
				version: 1,
				artifacts: {
					"design:TestApp": {
						artifact: "design",
						projectName: "TestApp",
						path: buildGroupedPath("design", "TestApp"),
						publishedAt: "2026-09-20T00:00:00.000Z",
					},
				},
			}),
		);
		await runHandoff(loadState(tmpDir), makeCtx(), tmpDir);

		assert.match(allMessages(), /Freshness warnings \(handoff allowed\)/);
		assert.match(allMessages(), /design:TestApp: no freshness stamp/);
		assert.ok(payloadExists(), "handoff written despite the no-stamp warning");
		assert.equal(loadState(tmpDir).currentStage, "handoff-ready");
	});
});

describe("/velpari-handoff — ID-coverage gate (A4)", () => {
	it("blocks when a machine-checkable downstream doc misses upstream ids (D7)", async () => {
		seed({
			// §1 references FR-01 but nothing covers NFR-01 → missing.
			design: [
				"# Design",
				"",
				"## 1. Module Breakdown",
				"",
				"| Module | Purpose | Source FRs | Maturity | Depends on |",
				"|---|---|---|---|---|",
				"| core | expenses | FR-01 | proposed | — |",
				"",
			].join("\n"),
		});
		await runHandoff(loadState(tmpDir), makeCtx(), tmpDir);

		assert.match(allMessages(), /Handoff blocked — ID coverage gaps/);
		assert.match(allMessages(), /prd-to-design[\s\S]*NFR-01/);
		assert.equal(payloadExists(), false);
		assert.equal(loadState(tmpDir).currentStage, "finalized-design", "stage must not advance");
	});

	it("not-checkable legacy docs warn only (D1)", async () => {
		seed(); // every downstream stub carries zero parseable refs
		await runHandoff(loadState(tmpDir), makeCtx(), tmpDir);

		assert.match(allMessages(), /ID coverage warnings \(handoff allowed\)/);
		assert.match(allMessages(), /not machine-checkable/);
		assert.ok(payloadExists(), "handoff written despite not-checkable warnings");
	});

	it("clean, fully-stamped chain hands off end-to-end", async () => {
		seed({
			design: DESIGN_FULL,
			"atomic-functions": AF_DOC,
			pseudocode: "# Pseudocode\n\n## saveExpense\n\nAF: AF-1\n",
			"test-cases": "# Test Cases\n\n| TC ID | Name | Traces |\n|---|---|---|\n| TC-1 | saves | FR-01, AF-1 |\n",
			"development-order": "# Development Order\n\n## Step 1\n\nAFs: AF-1\n",
		});
		// Stamp the chain with CORRECT input hashes → stale set stays empty.
		const now = new Date().toISOString();
		recordPublish(tmpDir, {
			artifact: "design",
			projectName: "TestApp",
			path: buildGroupedPath("design", "TestApp"),
			publishedAt: now,
			inputs: { "prd:TestApp": hashFileContent(artifactPath("PRD"))! },
		});
		recordPublish(tmpDir, {
			artifact: "pseudocode",
			projectName: "TestApp",
			path: buildGroupedPath("pseudocode", "TestApp"),
			publishedAt: now,
			inputs: { "atomic-functions:TestApp": hashFileContent(artifactPath("atomic-functions"))! },
		});
		await runHandoff(loadState(tmpDir), makeCtx(), tmpDir);

		assert.doesNotMatch(allMessages(), /Handoff blocked/);
		assert.ok(payloadExists(), "handoff written");
		assert.equal(loadState(tmpDir).currentStage, "handoff-ready");
	});
});
