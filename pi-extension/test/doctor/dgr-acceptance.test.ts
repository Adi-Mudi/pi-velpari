/**
 * DGR (P0–P3) — consolidated end-to-end acceptance (subphase P3.4).
 *
 * ONE deterministic test file that drives the real
 * `runRepairSession` (`doctor/repair-session.ts`) through a scriptable mock
 * `RepairSessionUi`, pinning the four contract outcomes of the gated repair
 * flow:
 *
 *   (a) GATE A Abort        → `{action:"aborted"}`, zero repair writes,
 *                             no fix-plan artifact written;
 *   (b) Show details → Build a fix plan → GATE B decline
 *                           → aborted, zero repair writes, GATE C never
 *                             reached (the fix-plan artifact is the one
 *                             deliberate pre-gate write);
 *   (c) full approve        → the batch runs exactly once, the fix-plan
 *                             `.md` + `.json` twins exist, GATE C `Done`
 *                             → `{action:"fixed"}`;
 *   (d) GATE C Re-plan      → GATE B is re-entered (fresh confirm), the
 *                             batch re-applies once, then GATE C `Done`.
 *
 * It also asserts the gate section titles and the artifact paths
 * (`FIX_PLAN_MD_PATH` / `FIX_PLAN_JSON_PATH`).
 *
 * Side-effect paths are injected (`runAuto` / `dispatchOne` spies), so
 * "zero repair writes on decline" is proven without touching the real store.
 * The fix-plan + audit writes land in a per-test temp dir.
 *
 * Modeled on `dsi-acceptance.test.ts` / `repair-session.test.ts`.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runRepairSession, type RepairSessionUi, type RepairSessionSource } from "../../src/doctor/repair-session.js";
import type { PreflightFinding } from "../../src/doctor/preflight.js";
import {
	FIX_PLAN_JSON_PATH,
	FIX_PLAN_MD_PATH,
	FIX_PLAN_SCHEMA_VERSION,
	type FixPlanJson,
} from "../../src/doctor/fix-plan.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-dgr-acceptance-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Build one auto-fixable (or manual) preflight finding. */
function finding(fingerprint: string, autoFixable: boolean): PreflightFinding {
	return {
		blocking: true,
		fingerprint,
		autoFixable,
		item: {
			status: "error",
			message: `${fingerprint}: test item`,
			suggestion: `fix ${fingerprint}`,
		},
	};
}

/** Scriptable mock UI + call spies for the gated session. */
interface MockUi {
	ui: RepairSessionUi;
	/** Every GATE / feedback select title, in call order. */
	selectTitles: string[];
	/** Every GATE B confirm title, in call order. */
	confirmTitles: string[];
	selectCalls: () => number;
	confirmCalls: () => number;
}

/**
 * Build a scriptable mock UI: queued `select` answers, one fixed `confirm`
 * answer, and call counters. The last queued select answer repeats, so a
 * scenario never runs out mid-flow.
 *
 * @param selectAnswers - Queued GATE / feedback answers.
 * @param confirmAnswer - The single GATE B confirm answer.
 * @returns The UI plus its call spies.
 */
function mockUi(selectAnswers: (string | null | undefined)[], confirmAnswer: boolean): MockUi {
	let selects = 0;
	let confirms = 0;
	const selectTitles: string[] = [];
	const confirmTitles: string[] = [];
	const ui: RepairSessionUi = {
		notify: () => {},
		select: async (title) => {
			selectTitles.push(title);
			const answer = selectAnswers[Math.min(selects, selectAnswers.length - 1)];
			selects++;
			return answer;
		},
		confirm: async (title) => {
			confirmTitles.push(title);
			confirms++;
			return confirmAnswer;
		},
	};
	return {
		ui,
		selectTitles,
		confirmTitles,
		selectCalls: () => selects,
		confirmCalls: () => confirms,
	};
}

/** The fix-plan artifact paths under the temp project root. */
function planPaths(): { md: string; json: string } {
	return { md: path.join(tmpDir, FIX_PLAN_MD_PATH), json: path.join(tmpDir, FIX_PLAN_JSON_PATH) };
}

describe("DGR (P0–P3) — consolidated acceptance", () => {
	it("(a) GATE A Abort ⇒ aborted, zero repair writes, no fix-plan artifact", async () => {
		const m = mockUi(["Abort"], true);
		let autoCalls = 0;
		let dispatchCalls = 0;
		const source: RepairSessionSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true), finding("config-invalid", false)],
		};
		const outcome = await runRepairSession({
			ui: m.ui,
			cwd: tmpDir,
			projectName: "X",
			source,
			reRun: async () => ({ ok: false, actionableCount: 2 }),
			runAuto: async () => {
				autoCalls++;
			},
			dispatchOne: async () => {
				dispatchCalls++;
			},
		});
		assert.deepEqual(outcome, { action: "aborted", reason: "user aborted" });
		assert.equal(m.selectCalls(), 1, "GATE A asked exactly once");
		assert.equal(m.confirmCalls(), 0, "GATE B never reached");
		assert.equal(autoCalls, 0, "GATE A decline = zero repair writes");
		assert.equal(dispatchCalls, 0, "GATE A decline = zero dispatches");
		const { md, json } = planPaths();
		assert.ok(!fs.existsSync(md), "no fix-plan markdown written on GATE A abort");
		assert.ok(!fs.existsSync(json), "no fix-plan JSON written on GATE A abort");
	});

	it("(b) Show details → Build a fix plan → GATE B decline ⇒ aborted, zero repair writes", async () => {
		const m = mockUi(["Show details", "Build a fix plan", "Accept all (recommended)"], false);
		let autoCalls = 0;
		let dispatchCalls = 0;
		const source: RepairSessionSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true)],
		};
		const outcome = await runRepairSession({
			ui: m.ui,
			cwd: tmpDir,
			projectName: "X",
			source,
			reRun: async () => ({ ok: false, actionableCount: 1 }),
			runAuto: async () => {
				autoCalls++;
			},
			dispatchOne: async () => {
				dispatchCalls++;
			},
		});
		assert.deepEqual(outcome, { action: "aborted", reason: "user declined batch" });
		assert.equal(m.selectCalls(), 3, "GATE A + Show details re-ask + feedback pass");
		assert.equal(m.confirmCalls(), 1, "GATE B asked once, then declined");
		assert.match(m.confirmTitles[0] ?? "", /^Apply \d+ fix\(es\)\?$/, "GATE B title names the batch size");
		assert.ok(
			!m.selectTitles.some((t) => t.startsWith("Repair done")),
			"GATE C is never reached after a GATE B decline",
		);
		assert.equal(autoCalls, 0, "GATE B decline = zero repair writes");
		assert.equal(dispatchCalls, 0, "GATE B decline = zero dispatches");
		// The reviewable fix plan is the ONE deliberate pre-gate write — it is
		// persisted (not applied) so the developer reviews exactly the batch.
		const { md, json } = planPaths();
		assert.ok(fs.existsSync(md), "the reviewable fix plan is persisted before GATE B");
		assert.ok(fs.existsSync(json), "the fix-plan JSON twin is persisted before GATE B");
	});

	it("(c) full approve ⇒ batch runs once, fix-plan twins exist, GATE C Done ⇒ fixed", async () => {
		const m = mockUi(["Build a fix plan", "Accept all (recommended)", "Done"], true);
		let autoCalls = 0;
		let reRunCalls = 0;
		const source: RepairSessionSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true)],
		};
		const outcome = await runRepairSession({
			ui: m.ui,
			cwd: tmpDir,
			projectName: "X",
			source,
			reRun: async () => {
				reRunCalls++;
				return { ok: true, actionableCount: 0 };
			},
			runAuto: async () => {
				autoCalls++;
			},
		});
		assert.deepEqual(outcome, { action: "fixed", remainingManual: 0 });
		assert.equal(autoCalls, 1, "the batch runs exactly once");
		assert.equal(reRunCalls, 1, "exactly one re-audit");
		assert.ok(m.selectTitles.includes("Doctor found 1 issue(s)"), "GATE A section title");
		assert.match(m.confirmTitles[0] ?? "", /^Apply \d+ fix\(es\)\?$/, "GATE B section title");
		assert.ok(
			m.selectTitles.includes("Repair done — 0 item(s) remain"),
			"GATE C section title (Done / Re-plan / Abort)",
		);

		const { md, json } = planPaths();
		assert.ok(fs.existsSync(md), "fix-plan markdown twin exists");
		assert.ok(fs.existsSync(json), "fix-plan JSON twin exists");
		const plan = JSON.parse(fs.readFileSync(json, "utf8")) as FixPlanJson;
		assert.equal(plan.schemaVersion, FIX_PLAN_SCHEMA_VERSION);
		assert.equal(plan.projectName, "X");
		assert.equal(plan.items.length, 1, "only the included item is in the plan");
		assert.match(fs.readFileSync(md, "utf8"), /# Velpari Doctor — Fix Plan/);
	});

	it("(d) GATE C Re-plan ⇒ GATE B is re-entered, the batch re-applies once, then Done", async () => {
		const m = mockUi(["Build a fix plan", "Accept all (recommended)", "Re-plan", "Done"], true);
		let autoCalls = 0;
		let reRunCalls = 0;
		const source: RepairSessionSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true)],
		};
		const outcome = await runRepairSession({
			ui: m.ui,
			cwd: tmpDir,
			projectName: "X",
			source,
			reRun: async () => {
				reRunCalls++;
				return { ok: true, actionableCount: 0 };
			},
			runAuto: async () => {
				autoCalls++;
			},
		});
		assert.deepEqual(outcome, { action: "fixed", remainingManual: 0 });
		assert.equal(m.confirmCalls(), 2, "GATE B re-entered exactly once (a fresh confirm)");
		assert.equal(autoCalls, 2, "the batch re-applies once");
		assert.equal(reRunCalls, 2, "a fresh re-audit per apply");
		// GATE A + feedback + GATE C(Re-plan) + GATE C(Done) = 4 selects.
		assert.equal(m.selectCalls(), 4, "no un-prompted retry — every re-apply is a fresh decision");
	});
});
