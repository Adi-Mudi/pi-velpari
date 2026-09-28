/**
 * fix-flow tests (Phase C, plan Subphase 4.5 — G7 / N22 / N23).
 *
 * Mock `PreflightUi` drives the AskUserQuestion-parity 3-option flow:
 * (a) Fix all + confirm → auto batch runs ONCE → clean re-run → fixed;
 * (b) Fix all + decline → aborted, ZERO remediate/dispatch calls;
 * (c) Show details → detail blocks printed → re-asked (select twice);
 * (d) Abort → aborted, zero writes; (e) non-interactive → terminal hint;
 * (f) dirty after fix → fixed with remainingManual > 0 (+ manual dispatch);
 * (g) N23: compiled source contains no approve/publish import and
 * `reRun` is the only re-entry (exactly ONE attempt).
 *
 * Side-effect paths are injected (`runAuto` / `dispatchOne` spies), so
 * "zero writes on decline" is proven without touching the real store.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runFixFlow, type FixFlowSource, type PreflightUi } from "../../src/doctor/fix-flow.js";
import type { PreflightFinding } from "../../src/doctor/preflight.js";
import type { DiagnosticReport } from "../../src/doctor/_types.js";
import { suggestionFor } from "../../src/doctor/checks/fix-suggestions.js";

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
function mockUi(selectAnswers: (string | null | undefined)[], confirmAnswer: boolean): {
	ui: PreflightUi;
	notifies: { m: string; k?: string }[];
	selectCalls: () => number;
	confirmCalls: () => number;
} {
	const notifies: { m: string; k?: string }[] = [];
	let selects = 0;
	let confirms = 0;
	const ui: PreflightUi = {
		notify: (m, k) => notifies.push({ m, k }),
		select: async (_t, _l) => {
			const answer = selectAnswers[Math.min(selects, selectAnswers.length - 1)];
			selects++;
			return answer;
		},
		confirm: async () => {
			confirms++;
			return confirmAnswer;
		},
	};
	return { ui, notifies, selectCalls: () => selects, confirmCalls: () => confirms };
}

describe("runFixFlow", () => {
	it("(a) Fix all + confirm → auto batch ONCE, re-run clean → fixed (remainingManual 0)", async () => {
		const { ui } = mockUi(["Fix all (Recommended)"], true);
		let autoCalls = 0;
		let reRunCalls = 0;
		const source: FixFlowSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true)],
		};
		const outcome = await runFixFlow({
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
		});
		assert.deepEqual(outcome, { action: "fixed", remainingManual: 0 });
		assert.equal(autoCalls, 1, "auto batch runs exactly once");
		assert.equal(reRunCalls, 1, "exactly one re-audit (max 1 attempt)");
	});

	it("(b) Fix all + decline → aborted, ZERO remediate/dispatch/reRun calls", async () => {
		const { ui, confirmCalls } = mockUi(["Fix all (Recommended)"], false);
		let autoCalls = 0;
		let dispatchCalls = 0;
		let reRunCalls = 0;
		const source: FixFlowSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true), finding("config-invalid", false)],
		};
		const outcome = await runFixFlow({
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
		assert.equal(outcome.action, "aborted");
		assert.equal((outcome as { reason: string }).reason, "user declined batch");
		assert.equal(confirmCalls(), 1);
		assert.equal(autoCalls, 0, "decline = zero writes");
		assert.equal(dispatchCalls, 0, "decline = zero dispatches");
		assert.equal(reRunCalls, 0, "decline = no re-audit");
	});

	it("(c) Show details → detail blocks printed → re-asked (select called twice)", async () => {
		const { ui, notifies, selectCalls } = mockUi(["Show details", "Abort"], true);
		let autoCalls = 0;
		const outcome = await runFixFlow({
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
		assert.ok(notifies.some((n) => n.m.includes("bookkeeping-advance: test item")), "detail block printed");
		assert.equal(outcome.action, "aborted");
		assert.equal((outcome as { reason: string }).reason, "user aborted");
		assert.equal(autoCalls, 0);
	});

	it("(d) Abort → aborted immediately, zero writes", async () => {
		const { ui, confirmCalls } = mockUi(["Abort"], true);
		let autoCalls = 0;
		const outcome = await runFixFlow({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: { kind: "preflight", findings: [finding("bookkeeping-advance", true)] },
			reRun: async () => ({ ok: true, actionableCount: 0 }),
			runAuto: async () => {
				autoCalls++;
			},
		});
		assert.equal(outcome.action, "aborted");
		assert.equal((outcome as { reason: string }).reason, "user aborted");
		assert.equal(autoCalls, 0);
		assert.equal(confirmCalls(), 0, "Abort never reaches the confirm");
	});

	it("(e) non-interactive (no select) → aborted with the terminal hint", async () => {
		const ui: PreflightUi = { notify: () => {} }; // no select, no confirm
		const outcome = await runFixFlow({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: { kind: "preflight", findings: [finding("bookkeeping-advance", true)] },
			reRun: async () => ({ ok: true, actionableCount: 0 }),
		});
		assert.equal(outcome.action, "aborted");
		assert.match((outcome as { reason: string }).reason, /non-interactive — run \/velpari-doctor --velpari-fix/);
	});

	it("(f) dirty after fix → fixed with remainingManual > 0 + manual item dispatched", async () => {
		const { ui } = mockUi(["Fix all (Recommended)"], true);
		let autoCalls = 0;
		let dispatchCalls = 0;
		let reRunCalls = 0;
		const source: FixFlowSource = {
			kind: "preflight",
			findings: [finding("bookkeeping-advance", true), finding("config-invalid", false)],
		};
		const outcome = await runFixFlow({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source,
			reRun: async () => {
				reRunCalls++;
				return { ok: false, actionableCount: 1 }; // manual config-invalid still open
			},
			runAuto: async () => {
				autoCalls++;
			},
			dispatchOne: async () => {
				dispatchCalls++;
			},
		});
		assert.equal(outcome.action, "fixed");
		assert.equal((outcome as { remainingManual: number }).remainingManual, 1);
		assert.equal(autoCalls, 1);
		assert.equal(dispatchCalls, 1, "manual remainder dispatched once");
		assert.equal(reRunCalls, 1, "max 1 attempt — no loop");
	});

	it("no actionable items → no-actionables without any prompt", async () => {
		const { ui, selectCalls } = mockUi(["Fix all (Recommended)"], true);
		const outcome = await runFixFlow({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: { kind: "preflight", findings: [] },
			reRun: async () => ({ ok: true, actionableCount: 0 }),
		});
		assert.equal(outcome.action, "no-actionables");
		assert.equal(selectCalls(), 0);
	});

	it("doctor source: auto-safe suggestion reverse-maps into the batch; others stay manual", async () => {
		const { ui } = mockUi(["Fix all (Recommended)"], true);
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
		const outcome = await runFixFlow({
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
		assert.equal(outcome.action, "fixed");
		assert.equal((outcome as { remainingManual: number }).remainingManual, 1);
	});

	it("(g) N23: compiled source imports no approve/publish machinery", () => {
		// Test lives at dist/pi-extension/test/doctor/ → ../../src/doctor/fix-flow.js
		const src = readFileSync(fileURLToPath(new URL("../../src/doctor/fix-flow.js", import.meta.url)), "utf8");
		const forbidden = [
			/from\s+"[^"]*\/approve[^"]*"/,
			/from\s+"[^"]*stage-publish-tool[^"]*"/,
			/from\s+"[^"]*doctor\/gate[^"]*"/,
			/from\s+"[^"]*stage-publish[^"]*"/,
		];
		for (const re of forbidden) {
			assert.ok(!re.test(src), `fix-flow must not import matches of ${re}`);
		}
		// The re-audit reaches runDoctor only through the injected reRun closure.
		assert.ok(!/from\s+"\.\/index\.js"/.test(src), "no static doctor orchestrator import");
	});
});
