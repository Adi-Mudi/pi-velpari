/**
 * Gated repair-session invariants — DGR P2 (D11 / master plan §14 / Issue 12).
 *
 * D11 is enforced as TESTS, not a doctor section: a stateless read cannot
 * observe gate ordering, so the "no repair write before GATE B / no
 * auto-progression" invariant is pinned here. Two layers:
 *
 *   1. Stage-machine unit tests — a decline/abort at any gate means the
 *      repair executors (`runAuto` / `dispatchOne`) are never called:
 *      GATE A decline ⇒ zero writes, GATE B decline ⇒ zero writes,
 *      GATE C Abort ⇒ no further repair writes.
 *   2. An import-scan test — `repair-session.ts` imports no approve/publish
 *      machinery and no `ui/` module (the `fix-flow.test.ts (g)` precedent).
 *
 * Side-effect paths are injected (`runAuto` / `dispatchOne` spies), so the
 * "zero writes" proof never touches the real store. The Plan-stage
 * fix-plan artifact writes to a per-test temp dir.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runRepairSession, type RepairSessionUi, type RepairSessionSource } from "../../src/doctor/repair-session.js";
import type { PreflightFinding } from "../../src/doctor/preflight.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-repair-invariant-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Build a preflight finding (blocking/auto as asked). */
function finding(fingerprint: string, autoFixable: boolean, blocking = true): PreflightFinding {
	return {
		blocking,
		fingerprint,
		autoFixable,
		item: {
			status: blocking ? "error" : "info",
			message: `${fingerprint}: test item`,
			suggestion: `fix ${fingerprint}`,
		},
	};
}

/** Scriptable mock UI: queued select answers, fixed confirm answer, notify log. */
function mockUi(
	selectAnswers: (string | null | undefined)[],
	confirmAnswer: boolean,
): {
	ui: RepairSessionUi;
	notifies: { m: string; k?: string }[];
	selectCalls: () => number;
	selectLabels: string[][];
	confirmCalls: () => number;
} {
	const notifies: { m: string; k?: string }[] = [];
	let selects = 0;
	let confirms = 0;
	const selectLabels: string[][] = [];
	const ui: RepairSessionUi = {
		notify: (m, k) => notifies.push({ m, k }),
		select: async (_t, l) => {
			selectLabels.push([...l]);
			const answer = selectAnswers[Math.min(selects, selectAnswers.length - 1)];
			selects++;
			return answer;
		},
		confirm: async () => {
			confirms++;
			return confirmAnswer;
		},
	};
	return { ui, notifies, selectCalls: () => selects, selectLabels, confirmCalls: () => confirms };
}

describe("runRepairSession invariants (D11)", () => {
	it("GATE A decline ⇒ runAuto / dispatchOne are never called", async () => {
		const { ui, confirmCalls } = mockUi(["Abort"], true);
		let autoCalls = 0;
		let dispatchCalls = 0;
		let reRunCalls = 0;
		const source: RepairSessionSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true), finding("config-invalid", false)],
		};
		const outcome = await runRepairSession({
			ui,
			cwd: tmpDir,
			projectName: "X",
			source,
			reRun: async () => {
				reRunCalls++;
				return { ok: false, actionableCount: 2 };
			},
			runAuto: async () => {
				autoCalls++;
			},
			dispatchOne: async () => {
				dispatchCalls++;
			},
		});
		assert.deepEqual(outcome, { action: "aborted", reason: "user aborted" });
		assert.equal(autoCalls, 0, "GATE A decline = zero repair writes");
		assert.equal(dispatchCalls, 0, "GATE A decline = zero dispatches");
		assert.equal(reRunCalls, 0, "GATE A decline = no re-audit");
		assert.equal(confirmCalls(), 0, "GATE B never reached");
	});

	it("GATE B decline ⇒ runAuto / dispatchOne are never called", async () => {
		const { ui, confirmCalls } = mockUi(["Build a fix plan"], false);
		let autoCalls = 0;
		let dispatchCalls = 0;
		let reRunCalls = 0;
		const source: RepairSessionSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true), finding("config-invalid", false)],
		};
		const outcome = await runRepairSession({
			ui,
			cwd: tmpDir,
			projectName: "X",
			source,
			reRun: async () => {
				reRunCalls++;
				return { ok: false, actionableCount: 2 };
			},
			runAuto: async () => {
				autoCalls++;
			},
			dispatchOne: async () => {
				dispatchCalls++;
			},
		});
		assert.deepEqual(outcome, { action: "aborted", reason: "user declined batch" });
		assert.equal(autoCalls, 0, "GATE B decline = zero repair writes");
		assert.equal(dispatchCalls, 0, "GATE B decline = zero dispatches");
		assert.equal(reRunCalls, 0, "GATE B decline = no re-audit");
		assert.equal(confirmCalls(), 1, "GATE B asked once");
	});

	it("GATE C Abort ⇒ no further runAuto / dispatchOne calls", async () => {
		const { ui, confirmCalls } = mockUi(
			["Build a fix plan", "Fix now (auto-safe)", "Manual step (`/velpari-*`)", "Abort"],
			true,
		);
		let autoCalls = 0;
		let dispatchCalls = 0;
		let reRunCalls = 0;
		const source: RepairSessionSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true), finding("config-invalid", false)],
		};
		const outcome = await runRepairSession({
			ui,
			cwd: tmpDir,
			projectName: "X",
			source,
			reRun: async () => {
				reRunCalls++;
				return { ok: false, actionableCount: 1 };
			},
			runAuto: async () => {
				autoCalls++;
			},
			dispatchOne: async () => {
				dispatchCalls++;
			},
		});
		assert.deepEqual(outcome, { action: "aborted", reason: "user aborted at verify" });
		assert.equal(autoCalls, 1, "the first apply ran once");
		assert.equal(dispatchCalls, 1, "the first manual dispatch ran once");
		assert.equal(reRunCalls, 1, "no second re-audit after Abort");
		assert.equal(confirmCalls(), 1, "GATE B not re-entered");
	});

	it("import scan: repair-session.ts imports no approve/publish machinery and no ui/ module", () => {
		// Test lives at dist/pi-extension/test/doctor/ → ../../src/doctor/repair-session.js
		const src = readFileSync(
			fileURLToPath(new URL("../../src/doctor/repair-session.js", import.meta.url)),
			"utf8",
		);
		const forbidden = [
			/from\s+"[^"]*\/approve[^"]*"/,
			/from\s+"[^"]*stage-publish-tool[^"]*"/,
			/from\s+"[^"]*doctor\/gate[^"]*"/,
			/from\s+"[^"]*stage-publish[^"]*"/,
			/from\s+"[^"]*\/ui\//,
		];
		for (const re of forbidden) {
			assert.ok(!re.test(src), `repair-session must not import matches of ${re}`);
		}
		// The re-audit reaches runDoctor only through the injected reRun closure.
		assert.ok(!/from\s+"\.\/index\.js"/.test(src), "no static doctor orchestrator import");
	});
});
