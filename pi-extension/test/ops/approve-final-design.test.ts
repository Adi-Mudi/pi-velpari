/**
 * /velpari-prd-approve publish-path tests for the final-design stage.
 *
 * Asserts:
 *   - fresh publish: working copy under <runDir>/final-design/ is
 *     published to Doc/design/final-design_<project>.md
 *   - state advances from finalizing-design to finalized-design
 *   - revision without a new Change Log entry is blocked (living documents)
 *   - blocked publish writes nothing and does not advance
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { advanceStage, clearRun, createRun, loadState } from "../../src/core/state.js";

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

function frontmatter(version: string): string {
	return `---
artifact: final-design
project: FinalApp
version: ${version}
status: draft
stage: finalizing-design
run: TBD
created: 2026-09-13T00:00:00.000Z
updated: 2026-09-13T00:00:00.000Z
---

`;
}

function requiredSections(extraChangeLogLine?: string): string {
	const parts = [
		"# Final Design — FinalApp",
		"",
		"## Overview",
		"",
		"One-paragraph summary referencing the approved design.",
		"",
		"## Module Inventory",
		"",
		"| ID | Name | Pseudocode | Tests | Notes |",
		"|---|---|---|---|---|",
		"| M-1 | auth | yes | yes | |",
		"",
		"## Contract Map",
		"",
		"| Contract | Signature | Pseudocode call sites | Test exercises | Status |",
		"|---|---|---|---|---|",
		"| API-AUTH-LOGIN | POST /auth/login | 1 | TC-1 | ok |",
		"",
		"## Consistency Notes",
		"",
		"- No id mismatches.",
		"- No name drift.",
		"- No orphan ids.",
		"",
		"## Mismatches Found + Resolution",
		"",
		"| Source | Item | Resolution |",
		"|---|---|---|",
		"| coverage | none | — |",
		"",
		"## Final Contracts",
		"",
		"- API-AUTH-LOGIN: POST /auth/login → { token }.",
		"",
		"## Change Log",
		"",
		"- 1.0.0 — initial consolidated final design.",
	];
	if (extraChangeLogLine) parts.push(extraChangeLogLine);
	return parts.join("\n") + "\n";
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-final-design-approve-"));
	mkdirSync(join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(
		join(tmpDir, ".pi", "velpari", "files.json"),
		JSON.stringify({ version: 4, projectName: "FinalApp" }),
		"utf8",
	);
	// v1.2.1 opt-out for minimal-cwd test fixtures.
	process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});
describe("/velpari-rtm-approve final-design publish path", () => {
	it("fresh publish: writes Doc/design/final-design_FinalApp.md and advances to finalized-design", async () => {
		const cwd = tmpDir;
		clearRun(cwd);
		let state = createRun("Final design approve", cwd);
		state = advanceStage(state, "/velpari-approve-brainstorm", cwd);
		state = advanceStage(state, "/velpari-prd", cwd);
		state = advanceStage(state, "/velpari-prd-approve", cwd);
		state = advanceStage(state, "/velpari-rtm", cwd);
		state = advanceStage(state, "/velpari-rtm-approve", cwd);
		state = advanceStage(state, "/velpari-feasibility", cwd);
		state = advanceStage(state, "/velpari-feasibility-approve", cwd);
		state = advanceStage(state, "/velpari-architecture-generator", cwd);
		state = advanceStage(state, "/velpari-architecture-generator-approve", cwd);
		state = advanceStage(state, "/velpari-atomic-function", cwd);
		state = advanceStage(state, "/velpari-atomic-function-approve", cwd);
		state = advanceStage(state, "/velpari-pseudocode", cwd);
		state = advanceStage(state, "/velpari-pseudocode-approve", cwd);
		state = advanceStage(state, "/velpari-testplan", cwd);
		state = advanceStage(state, "/velpari-testplan-approve", cwd);
		state = advanceStage(state, "/velpari-development-order", cwd);
		state = advanceStage(state, "/velpari-development-order-approve", cwd);
		state = advanceStage(state, "/velpari-final-design", cwd);
		assert.strictEqual(state.currentStage, "finalizing-design");

		const runId = loadState(cwd).runId!;
		const workingDir = join(cwd, ".IDE_Plans", "velpari", "runs", runId, "final-design");
		mkdirSync(workingDir, { recursive: true });
		writeFileSync(
			join(workingDir, "final-design_FinalApp.md"),
			frontmatter("1.0.0") + requiredSections(),
			"utf8",
		);

		// B4: the publish gate refuses a final-design publish when any of its
		// declared inputs is missing; seed them as legacy flat Doc artifacts.
		mkdirSync(join(cwd, "Doc"), { recursive: true });
		for (const name of [
			"design",
			"atomic-functions",
			"pseudocode",
			"test-plan",
			"test-cases",
			"development-order",
		]) {
			writeFileSync(join(cwd, "Doc", `${name}_FinalApp.md`), `# ${name}\n`, "utf8");
		}

		const ctx = makeCtx();
		await handleApprove(ctx, undefined, cwd);

		const pubPath = join(cwd, "Doc", "design", "final-design_FinalApp.md");
		assert.ok(existsSync(pubPath), `expected publish at ${pubPath}; messages: ${allMessages()}`);
		const after = loadState(cwd);
		assert.strictEqual(after.currentStage, "finalized-design", "approve did not advance");
	});

	it("revision without a new Change Log entry is blocked and writes nothing", async () => {
		const cwd = tmpDir;
		clearRun(cwd);
		let state = createRun("Final design revise", cwd);
		state = advanceStage(state, "/velpari-approve-brainstorm", cwd);
		state = advanceStage(state, "/velpari-prd", cwd);
		state = advanceStage(state, "/velpari-prd-approve", cwd);
		state = advanceStage(state, "/velpari-rtm", cwd);
		state = advanceStage(state, "/velpari-rtm-approve", cwd);
		state = advanceStage(state, "/velpari-feasibility", cwd);
		state = advanceStage(state, "/velpari-feasibility-approve", cwd);
		state = advanceStage(state, "/velpari-architecture-generator", cwd);
		state = advanceStage(state, "/velpari-architecture-generator-approve", cwd);
		state = advanceStage(state, "/velpari-atomic-function", cwd);
		state = advanceStage(state, "/velpari-atomic-function-approve", cwd);
		state = advanceStage(state, "/velpari-pseudocode", cwd);
		state = advanceStage(state, "/velpari-pseudocode-approve", cwd);
		state = advanceStage(state, "/velpari-testplan", cwd);
		state = advanceStage(state, "/velpari-testplan-approve", cwd);
		state = advanceStage(state, "/velpari-development-order", cwd);
		state = advanceStage(state, "/velpari-development-order-approve", cwd);
		state = advanceStage(state, "/velpari-final-design", cwd);

		const pubDir = join(cwd, "Doc", "design");
		mkdirSync(pubDir, { recursive: true });
		const pubPath = join(pubDir, "final-design_FinalApp.md");
		writeFileSync(
			pubPath,
			frontmatter("1.0.0") + requiredSections(),
			"utf8",
		);
		const before = readFileSync(pubPath, "utf8");

		const runId = loadState(cwd).runId!;
		const workingDir = join(cwd, ".IDE_Plans", "velpari", "runs", runId, "final-design");
		mkdirSync(workingDir, { recursive: true });
		writeFileSync(
			join(workingDir, "final-design_FinalApp.md"),
			frontmatter("1.0.0") + requiredSections(),
			"utf8",
		);

		const ctx = makeCtx();
		await handleApprove(ctx, undefined, cwd);

		const after = loadState(cwd);
		assert.strictEqual(after.currentStage, "finalizing-design", "blocked publish must not advance");
		assert.match(allMessages(), /revision-changelog-missing|Revision gate blocked/);
		const pubNow = readFileSync(pubPath, "utf8");
		assert.strictEqual(pubNow, before, "blocked revision must not modify the published file");
	});
});
