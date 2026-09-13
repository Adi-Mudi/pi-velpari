/**
 * /velpari-approve next-step hint tests (feasibility skip).
 *
 * After the RTM publish advances the run to built-rtm, the notification
 * depends on whether a published feasibility study already exists:
 *   - no doc  → suggests /velpari-feasibility only
 *   - doc     → suggests both /velpari-architecture-generator (skip) and
 *               /velpari-feasibility (revise)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { advanceStage, createRun, loadState } from "../../src/core/state.js";

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

/** Drive a fresh run into building-rtm and write the RTM working copy. */
function enterBuildingRtm(): void {
	let state = createRun("TestApp", tmpDir);
	for (const cmd of [
		"/velpari-approve-brainstorm",
		"/velpari-prd",
		"/velpari-approve",
		"/velpari-rtm",
	]) {
		state = advanceStage(state, cmd, tmpDir);
	}
	const runId = loadState(tmpDir).runId;
	const dir = path.join(tmpDir, ".IDE_Plans", "velpari", "runs", runId, "rtm");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "RTM_TestApp.md"), "# RTM\n", "utf8");
}

function seedPublishedFeasibility(): void {
	const dir = path.join(tmpDir, "Doc", "feasibility");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "feasibility-study_TestApp.md"), "# Feasibility\n", "utf8");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-approve-hint-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("/velpari-approve — built-rtm next-step hint", () => {
	it("suggests only /velpari-feasibility when no feasibility doc is published", async () => {
		enterBuildingRtm();
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.equal(loadState(tmpDir).currentStage, "built-rtm");
		assert.match(allMessages(), /Next: \/velpari-feasibility/);
		assert.ok(!allMessages().includes("skip ahead"));
	});

	it("suggests the design skip plus feasibility revise when a doc exists", async () => {
		enterBuildingRtm();
		seedPublishedFeasibility();
		await handleApprove(makeCtx(), undefined, tmpDir);

		assert.equal(loadState(tmpDir).currentStage, "built-rtm");
		assert.match(
			allMessages(),
			/Next: \/velpari-architecture-generator \(feasibility already published — skip ahead\) or \/velpari-feasibility \(revise feasibility\)\./,
		);
	});
});
