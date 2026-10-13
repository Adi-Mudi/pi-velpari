/**
 * Gated repair-session tests — DGR P0 (subphase P0.4).
 *
 * Mock `RepairSessionUi` drives the 2-gate stage machine
 * (`Analyze → Report → GATE A → Plan → GATE B → Apply → Verify`):
 *   (a) decline at GATE A (Abort) ⇒ aborted, ZERO writes;
 *   (b) decline at GATE B ⇒ aborted, ZERO writes;
 *   (c) approve both gates ⇒ batch runs once + exactly one re-audit;
 *   (d) no actionable items ⇒ `{action:"no-actionables"}` without a prompt;
 *   (e) non-interactive (no select) ⇒ `{action:"aborted"}`;
 *   (f) Show details lists each item then re-asks GATE A.
 *
 * Side-effect paths are injected (`runAuto` / `dispatchOne` spies), so
 * "zero writes on decline" is proven without touching the real store.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { runRepairSession, type RepairSessionUi, type RepairSessionSource } from "../../src/doctor/repair-session.js";
import type { PreflightFinding } from "../../src/doctor/preflight.js";
import type { DiagnosticReport } from "../../src/doctor/_types.js";
import { SAFE_WHITELIST, suggestionFor } from "../../src/doctor/checks/fix-suggestions.js";

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
	confirmCalls: () => number;
	confirmMsgs: string[];
	confirmTitles: string[];
} {
	const notifies: { m: string; k?: string }[] = [];
	let selects = 0;
	let confirms = 0;
	const confirmMsgs: string[] = [];
	const confirmTitles: string[] = [];
	const ui: RepairSessionUi = {
		notify: (m, k) => notifies.push({ m, k }),
		select: async (_t, _l) => {
			const answer = selectAnswers[Math.min(selects, selectAnswers.length - 1)];
			selects++;
			return answer;
		},
		confirm: async (t: string, m?: string) => {
			confirms++;
			confirmTitles.push(t);
			if (m !== undefined) confirmMsgs.push(m);
			return confirmAnswer;
		},
	};
	return {
		ui,
		notifies,
		selectCalls: () => selects,
		confirmCalls: () => confirms,
		confirmMsgs,
		confirmTitles,
	};
}

describe("runRepairSession", () => {
	it("(a) decline at GATE A (Abort) ⇒ aborted, ZERO writes", async () => {
		const { ui, confirmCalls, selectCalls } = mockUi(["Abort"], true);
		let autoCalls = 0;
		let dispatchCalls = 0;
		let reRunCalls = 0;
		const source: RepairSessionSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true), finding("config-invalid", false)],
		};
		const outcome = await runRepairSession({
			ui,
			cwd: "/tmp/x",
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
		assert.equal(selectCalls(), 1, "GATE A asked once");
		assert.equal(confirmCalls(), 0, "GATE B never reached");
		assert.equal(autoCalls, 0, "GATE A decline = zero writes");
		assert.equal(dispatchCalls, 0, "GATE A decline = zero dispatches");
		assert.equal(reRunCalls, 0, "GATE A decline = no re-audit");
	});

	it("(b) decline at GATE B ⇒ aborted, ZERO writes", async () => {
		const { ui, confirmCalls, confirmTitles } = mockUi(["Build a fix plan"], false);
		let autoCalls = 0;
		let dispatchCalls = 0;
		let reRunCalls = 0;
		const source: RepairSessionSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true), finding("config-invalid", false)],
		};
		const outcome = await runRepairSession({
			ui,
			cwd: "/tmp/x",
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
		assert.equal(confirmCalls(), 1, "GATE B asked once");
		assert.match(confirmTitles[0] ?? "", /^Apply \d+ fix\(es\)\?$/, "GATE B title names the batch size");
		assert.equal(autoCalls, 0, "GATE B decline = zero writes");
		assert.equal(dispatchCalls, 0, "GATE B decline = zero dispatches");
		assert.equal(reRunCalls, 0, "GATE B decline = no re-audit");
	});

	it("(c) approve both gates ⇒ batch runs once + exactly one re-audit", async () => {
		const { ui, confirmMsgs } = mockUi(["Build a fix plan"], true);
		let autoCalls = 0;
		let dispatchCalls = 0;
		let reRunCalls = 0;
		const source: RepairSessionSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true), finding("config-invalid", false)],
		};
		const outcome = await runRepairSession({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source,
			reRun: async () => {
				reRunCalls++;
				return { ok: true, actionableCount: 0 };
			},
			runAuto: async () => {
				autoCalls++;
			},
			dispatchOne: async () => {
				dispatchCalls++;
			},
		});
		assert.deepEqual(outcome, { action: "fixed", remainingManual: 0 });
		assert.equal(autoCalls, 1, "auto batch runs exactly once");
		assert.equal(dispatchCalls, 1, "manual remainder dispatched once");
		assert.equal(reRunCalls, 1, "exactly one re-audit");
		// GATE B message lists the full safe whitelist + the manual item.
		const shown = confirmMsgs[0] ?? "";
		for (const name of SAFE_WHITELIST) {
			assert.ok(shown.includes(name), `batch list must include whitelist item "${name}"`);
		}
		assert.ok(shown.includes("manual: config-invalid: test item"), "manual item listed");
	});

	it("(d) no actionable items ⇒ no-actionables without any prompt", async () => {
		const { ui, selectCalls, confirmCalls } = mockUi(["Build a fix plan"], true);
		const outcome = await runRepairSession({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: { kind: "preflight", findings: [] },
			reRun: async () => ({ ok: true, actionableCount: 0 }),
		});
		assert.deepEqual(outcome, { action: "no-actionables" });
		assert.equal(selectCalls(), 0, "no GATE A prompt");
		assert.equal(confirmCalls(), 0, "no GATE B prompt");
	});

	it("(e) non-interactive (no select) ⇒ aborted with the non-interactive reason", async () => {
		const ui: RepairSessionUi = { notify: () => {} }; // no select, no confirm
		let autoCalls = 0;
		const outcome = await runRepairSession({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: { kind: "preflight", findings: [finding("bookkeeping-advance", true)] },
			reRun: async () => ({ ok: true, actionableCount: 0 }),
			runAuto: async () => {
				autoCalls++;
			},
		});
		assert.deepEqual(outcome, { action: "aborted", reason: "non-interactive" });
		assert.equal(autoCalls, 0, "non-interactive = zero writes");
	});

	it("(f) Show details lists each item then re-asks GATE A", async () => {
		const { ui, notifies, selectCalls } = mockUi(["Show details", "Abort"], true);
		let autoCalls = 0;
		const outcome = await runRepairSession({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: { kind: "preflight", findings: [finding("bookkeeping-advance", true)] },
			reRun: async () => ({ ok: true, actionableCount: 0 }),
			runAuto: async () => {
				autoCalls++;
			},
		});
		assert.equal(selectCalls(), 2, "details then re-ask");
		assert.ok(
			notifies.some((n) => n.m.includes("bookkeeping-advance: test item")),
			"detail block printed",
		);
		assert.deepEqual(outcome, { action: "aborted", reason: "user aborted" });
		assert.equal(autoCalls, 0);
	});

	it("doctor source: auto-safe suggestion reverse-maps into the batch; others stay manual", async () => {
		const { ui } = mockUi(["Build a fix plan"], true);
		let autoRan = false;
		let dispatched = 0;
		const report: DiagnosticReport = {
			ok: false,
			summary: { ok: 1, warning: 0, error: 1, info: 0 },
			sections: [
				{
					title: "Working ↔ published",
					items: [
						{
							status: "error",
							message: "working-published-drift: doc/design_x.md differs from the store",
							suggestion: suggestionFor("working-published-drift"),
						},
						{
							status: "error",
							message: "config-invalid: no projectName",
							suggestion: suggestionFor("config-invalid"),
						},
					],
				},
			],
		};
		const outcome = await runRepairSession({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: { kind: "doctor", report },
			reRun: async () => ({ ok: false, actionableCount: 1 }),
			runAuto: async () => {
				autoRan = true;
			},
			dispatchOne: async () => {
				dispatched++;
			},
		});
		assert.equal(autoRan, true, "auto-safe item went through the batch");
		assert.equal(dispatched, 1, "interactive item dispatched manually");
		assert.deepEqual(outcome, { action: "fixed", remainingManual: 1 });
	});
});
