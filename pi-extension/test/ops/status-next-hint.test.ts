/**
 * /velpari-status phase-boundary hint tests (generator v2, D5).
 *
 * The status surface only knows the current stage, so the hint fires at
 * phase-ENTRY stages (brainstormed / analyzed-feasibility /
 * wrote-pseudocode / designing-via-skip) while the entered phase lacks
 * fresh generated agents. Informational only — never a legality change.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleStatus } from "../../src/ops/status.js";
import { advanceStage, createRun, loadState } from "../../src/core/state.js";
import { GENERATION_PHASES } from "../../src/core/agents-config.js";
import { getProjectSlug } from "../../src/core/agents-generator.js";

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

function writeGeneratedAgents(phase: 1 | 2 | 3 | 4): void {
	const slug = getProjectSlug(tmpDir);
	const agentsDir = path.join(tmpDir, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	for (const role of GENERATION_PHASES[phase].roles) {
		fs.writeFileSync(path.join(agentsDir, `${slug}-${role}.md`), `# ${role}\n`, "utf8");
	}
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-status-hint-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("/velpari-status — phase-boundary generation hint (D5)", () => {
	it("shows the Phase 2 boundary hint at brainstormed when agents are missing", async () => {
		const state = createRun("TestApp", tmpDir);
		advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		assert.equal(loadState(tmpDir).currentStage, "brainstormed");

		await handleStatus(makeCtx(), undefined, tmpDir);
		assert.match(
			allMessages(),
			/Phase 2 boundary: generate Phase 2 agents \(\/velpari-generate-sub-agents\) before the next stage\./,
		);
	});

	it("no boundary hint at a mid-phase stage", async () => {
		let state = createRun("TestApp", tmpDir);
		for (const cmd of ["/velpari-approve-brainstorm", "/velpari-prd"]) {
			state = advanceStage(state, cmd, tmpDir);
		}
		assert.equal(loadState(tmpDir).currentStage, "drafting-prd");

		await handleStatus(makeCtx(), undefined, tmpDir);
		assert.ok(!allMessages().includes("boundary"), "mid-phase stages show no boundary hint");
	});

	it("fresh Phase 2 agents suppress the hint", async () => {
		const state = createRun("TestApp", tmpDir);
		advanceStage(state, "/velpari-approve-brainstorm", tmpDir);
		writeGeneratedAgents(2);

		await handleStatus(makeCtx(), undefined, tmpDir);
		assert.ok(!allMessages().includes("Phase 2 boundary"), "hint suppressed when Phase 2 agents are fresh");
	});
});
