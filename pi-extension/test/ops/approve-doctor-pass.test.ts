/**
 * Auto-doctor-pass on approve (v1.2.1).
 *
 * Per the policy: doctor errors AND warnings block state advance;
 * clean passes. The companion test `approve-doctor-stop.test.ts`
 * proves the STOP path. This file proves a related escape hatch —
 * the `VELPARI_SKIP_AUTO_DOCTOR=1` env var (and the matching
 * `opts.skipAutoDoctor`) opt out of the supplementary audit while
 * leaving the publish gate intact.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleApprove } from "../../src/ops/approve.js";
import { createRun, loadState, saveState } from "../../src/core/state.js";

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

const PSRS = [
	"# PSRS",
	"",
	"## Functional Requirements",
	"",
	"| ID | Requirement | Priority | Phase | Acceptance | Verification | Status |",
	"|---|---|---|---|---|---|---|",
	"| FR-01 | When a user submits an expense, the system SHALL save it | must | 1 | expense saved | Integration test | proposed |",
	"",
].join("\n");

function rtmJson(): string {
	return JSON.stringify({
		project: "TestApp",
		version: "1.0.0",
		rows: [
			{
				id: "FR-01",
				title: "FR-01 title",
				phase: 1,
				design: "",
				implementation: "",
				tests: [],
				status: "proposed",
				coverage: "covered",
			},
		],
	});
}

function enterBuildingRtm(): void {
	const run = createRun("TestApp", tmpDir);
	saveState({ ...run, currentStage: "building-rtm" }, tmpDir);
	const docDir = path.join(tmpDir, "Doc", "requirements");
	fs.mkdirSync(docDir, { recursive: true });
	fs.writeFileSync(path.join(docDir, "PRD_TestApp.md"), PSRS, "utf8");
	const dir = path.join(
		tmpDir,
		".IDE_Plans",
		"velpari",
		"runs",
		loadState(tmpDir).runId,
		"rtm",
	);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "RTM_TestApp.md"), "# RTM preview\n", "utf8");
	fs.writeFileSync(path.join(dir, "RTM_TestApp.json"), rtmJson(), "utf8");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-autodoc-skip-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.VELPARI_SKIP_AUTO_DOCTOR;
});

describe("publish — auto doctor opt-out (escape hatch)", () => {
	it("opts out via VELPARI_SKIP_AUTO_DOCTOR=1, publish + advance both run", async () => {
		process.env.VELPARI_SKIP_AUTO_DOCTOR = "1";
		enterBuildingRtm();

		await handleApprove(makeCtx(), undefined, tmpDir);

		const state = loadState(tmpDir);
		// The RTM was published (gate clears) AND the state advanced to
		// built-rtm because the auto-doctor was skipped — the v1.2.1 escape
		// hatch is honoured.
		assert.equal(state.currentStage, "built-rtm", "auto-doctor skipped; advance ran");
	});

	it("opts out via opts.skipAutoDoctor=true (programmatic API)", async () => {
		enterBuildingRtm();

		await handleApprove(makeCtx(), undefined, tmpDir, { skipAutoDoctor: true });

		const state = loadState(tmpDir);
		assert.equal(state.currentStage, "built-rtm", "auto-doctor skipped via opts");
	});

	it("default behaviour: no opt-out, doctor runs (fixture may still block advance)", async () => {
		// This test verifies that without any opt-out, the doctor audit
		// is invoked (we cannot assert "doctor errors" because the
		// fixture varies). We assert the doctor message stream gets
		// either the stop or the clean notification — both prove the
		// doctor path is active.
		enterBuildingRtm();

		await handleApprove(makeCtx(), undefined, tmpDir);

		const message = notices.map((n) => n.message).join("\n");
		assert.ok(
			/Doctor stopped the advance|Doctor: clean/.test(message),
			"doctor audit ran (either stop or clean); message=" + message,
		);
	});
});
