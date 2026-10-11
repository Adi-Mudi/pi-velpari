/**
 * repair-loop tests (Doctor v2, Phase 2 / T3 + U4 — lane b1).
 *
 * Proves the bounded verify → repair → re-verify loop in `runFixFlow`:
 * (a) the pure `shouldContinue` condition (dirty + actionable + under cap);
 * (b) still-dirty → retries exactly `maxAttempts` times, then stops (no
 *     infinite loop) — the default cap is 3;
 * (c) clean on the first re-audit → stops immediately (one pass);
 * (d) the batch is confirmed EXACTLY ONCE no matter how many passes run;
 * (e) the `aborted` path is unchanged (decline → zero writes, zero re-audits);
 * (f) one notify is emitted per pass.
 *
 * All side-effect paths are injected (`runAuto` / `reRun` spies), so the loop
 * is exercised without touching the real store or running a real doctor.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { runFixFlow, type FixFlowSource, type PreflightUi } from "../../src/doctor/fix-flow.js";
import type { PreflightFinding } from "../../src/doctor/preflight.js";
import { DEFAULT_MAX_ATTEMPTS, shouldContinue, type VerifyOutcome } from "../../src/doctor/verify-repair.js";

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

/** One auto-safe + one manual item → `view.manual.length === 1` when dirty. */
function mixedSource(): FixFlowSource {
	return {
		kind: "preflight",
		findings: [finding("bookkeeping-advance", true), finding("config-invalid", false)],
	};
}

/** Scriptable mock UI: fixed confirm answer + notify log + call counters. */
function mockUi(confirmAnswer: boolean): {
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
		select: async () => {
			selects++;
			return "Fix all (Recommended)";
		},
		confirm: async () => {
			confirms++;
			return confirmAnswer;
		},
	};
	return { ui, notifies, selectCalls: () => selects, confirmCalls: () => confirms };
}

describe("shouldContinue (pure)", () => {
	it("defaults to a cap of 3", () => {
		assert.equal(DEFAULT_MAX_ATTEMPTS, 3);
	});

	it("true while dirty + actionable + under the cap", () => {
		assert.equal(shouldContinue(0, 3, { ok: false, actionableCount: 1 }), true);
		assert.equal(shouldContinue(1, 3, { ok: false, actionableCount: 2 }), true);
		assert.equal(shouldContinue(2, 3, { ok: false, actionableCount: 1 }), true);
	});

	it("false when the cap is reached (never exceed max)", () => {
		assert.equal(shouldContinue(3, 3, { ok: false, actionableCount: 1 }), false);
		assert.equal(shouldContinue(4, 3, { ok: false, actionableCount: 1 }), false);
	});

	it("false when the audit is clean", () => {
		assert.equal(shouldContinue(1, 3, { ok: true, actionableCount: 0 }), false);
	});

	it("false when nothing is actionable even if not ok", () => {
		assert.equal(shouldContinue(1, 3, { ok: false, actionableCount: 0 }), false);
	});

	it("does not mutate its input (purity)", () => {
		const last: VerifyOutcome = { ok: false, actionableCount: 1 };
		shouldContinue(1, 3, last);
		assert.deepEqual(last, { ok: false, actionableCount: 1 });
	});
});

describe("runFixFlow bounded repair loop", () => {
	it("retries exactly maxAttempts when still dirty, then stops", async () => {
		const { ui, confirmCalls } = mockUi(true);
		let autoCalls = 0;
		let reRunCalls = 0;
		const outcome = await runFixFlow({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: mixedSource(),
			maxAttempts: 4,
			reRun: async () => {
				reRunCalls++;
				return { ok: false, actionableCount: 1 };
			},
			runAuto: async () => {
				autoCalls++;
			},
			dispatchOne: async () => {},
		});
		assert.deepEqual(outcome, { action: "fixed", remainingManual: 1 });
		assert.equal(autoCalls, 4, "batch runs once per attempt");
		assert.equal(reRunCalls, 4, "one re-audit per attempt — capped at maxAttempts");
		assert.equal(confirmCalls(), 1, "the batch is confirmed exactly once");
	});

	it("uses the default cap (3) when maxAttempts is omitted", async () => {
		const { ui } = mockUi(true);
		let autoCalls = 0;
		let reRunCalls = 0;
		await runFixFlow({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: mixedSource(),
			reRun: async () => {
				reRunCalls++;
				return { ok: false, actionableCount: 1 };
			},
			runAuto: async () => {
				autoCalls++;
			},
			dispatchOne: async () => {},
		});
		assert.equal(autoCalls, DEFAULT_MAX_ATTEMPTS);
		assert.equal(reRunCalls, DEFAULT_MAX_ATTEMPTS);
	});

	it("stops immediately when the first re-audit is clean", async () => {
		const { ui, confirmCalls } = mockUi(true);
		let autoCalls = 0;
		let reRunCalls = 0;
		const outcome = await runFixFlow({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: mixedSource(),
			maxAttempts: 3,
			reRun: async () => {
				reRunCalls++;
				return { ok: true, actionableCount: 0 };
			},
			runAuto: async () => {
				autoCalls++;
			},
			dispatchOne: async () => {},
		});
		assert.deepEqual(outcome, { action: "fixed", remainingManual: 0 });
		assert.equal(autoCalls, 1, "one batch pass");
		assert.equal(reRunCalls, 1, "no retry after a clean audit");
		assert.equal(confirmCalls(), 1);
	});

	it("emits exactly one notify per attempt", async () => {
		const { ui, notifies } = mockUi(true);
		await runFixFlow({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: mixedSource(),
			maxAttempts: 2,
			reRun: async () => ({ ok: false, actionableCount: 1 }),
			runAuto: async () => {},
			dispatchOne: async () => {},
		});
		const attemptNotifies = notifies.filter((n) => n.m.startsWith("Attempt "));
		assert.equal(attemptNotifies.length, 2, "one notify per pass");
		assert.match(attemptNotifies[0]?.m ?? "", /^Attempt 1\/2:/);
		assert.match(attemptNotifies[1]?.m ?? "", /^Attempt 2\/2:/);
	});

	it("aborted path is unchanged: decline → zero writes, zero re-audits", async () => {
		const { ui, confirmCalls, notifies } = mockUi(false);
		let autoCalls = 0;
		let dispatchCalls = 0;
		let reRunCalls = 0;
		const outcome = await runFixFlow({
			ui,
			cwd: "/tmp/x",
			projectName: "X",
			source: mixedSource(),
			maxAttempts: 3,
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
		assert.equal(outcome.action, "aborted");
		assert.equal((outcome as { reason: string }).reason, "user declined batch");
		assert.equal(confirmCalls(), 1);
		assert.equal(autoCalls, 0, "decline = zero writes");
		assert.equal(dispatchCalls, 0, "decline = zero dispatches");
		assert.equal(reRunCalls, 0, "decline = no re-audit");
		assert.equal(
			notifies.filter((n) => n.m.startsWith("Attempt ")).length,
			0,
			"no attempt notices when declined",
		);
	});
});
