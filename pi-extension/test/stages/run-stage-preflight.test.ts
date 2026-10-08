/**
 * runStage preflight-injection tests (Phase C, plan Subphase 4.5 — G1 / N22).
 *
 * Proves the marked `PHASE C PREFLIGHT BLOCK` in
 * `stages/registry.ts:runStage` runs BEFORE `loadState`:
 *   1. corrupt state.json + notify-only (non-interactive) ctx →
 *      preflight blocks → notify + return, NO crash (loadState never
 *      runs — it would throw a SyntaxError otherwise);
 *   2. preflight clean → execution proceeds into the existing guards
 *      ("No active run…" — ordering proof);
 *   3. `--velpari-skip-doctor` → preflight bypassed (row-3 opt-out;
 *      loadState errors surface exactly as they did pre-Phase C).
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runStage } from "../../src/stages/registry.js";
import { ensureStandardScaffold } from "../../src/ops/self-heal.js";
import { resetSessionGateCache } from "../../src/core/plan-binding.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(path.join(os.tmpdir(), "velpari-stage-preflight-"));
	resetSessionGateCache();
});

afterEach(() => {
	resetSessionGateCache();
	rmSync(tmpDir, { recursive: true, force: true });
});

/** Notify-only mock context (non-interactive — no select/confirm). */
function notifyOnlyCtx(): { ctx: never; notifies: { m: string; k?: string }[] } {
	const notifies: { m: string; k?: string }[] = [];
	const ctx = { ui: { notify: (m: string, k?: string) => notifies.push({ m, k }) } };
	return { ctx: ctx as never, notifies };
}

/** Write a corrupt state.json (loadState would throw on it). */
function corruptState(): void {
	mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
	writeFileSync(path.join(tmpDir, ".pi", "velpari", "state.json"), "{not json", "utf8");
}

describe("runStage — PHASE C PREFLIGHT BLOCK ordering", () => {
	it("1. blocking preflight returns BEFORE loadState (no crash, blocking notify)", async () => {
		corruptState();
		const { ctx, notifies } = notifyOnlyCtx();
		// Would throw SyntaxError out of loadState if the preflight did not run first.
		await runStage("prd", ctx, {} as never, tmpDir);
		assert.ok(
			notifies.some((n) => n.m.includes("state-unreadable")),
			`expected the preflight notify, got ${JSON.stringify(notifies)}`,
		);
		assert.equal(
			notifies.some((n) => n.m.includes("No active run")),
			false,
			"must return before the loadState-dependent guards",
		);
	});

	it("2. clean preflight → proceeds into the existing guards (ordering proof)", async () => {
		// Clean fixture: scaffold + valid config + valid state without a run.
		ensureStandardScaffold(tmpDir);
		mkdirSync(path.join(tmpDir, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "files.json"),
			JSON.stringify({ version: 4, projectName: "PreApp" }),
			"utf8",
		);
		writeFileSync(
			path.join(tmpDir, ".pi", "velpari", "state.json"),
			JSON.stringify({ version: 1, runId: "", mission: "", currentStage: "none", history: [], updatedAt: new Date().toISOString() }),
			"utf8",
		);
		const { ctx, notifies } = notifyOnlyCtx();
		await runStage("prd", ctx, {} as never, tmpDir);
		assert.ok(
			notifies.some((n) => n.m.includes("No active run. Run /velpari-brainstorm first.")),
			`expected the NEXT guard after a clean preflight, got ${JSON.stringify(notifies)}`,
		);
		assert.equal(notifies.some((n) => n.m.includes("state-unreadable")), false);
	});

	it("3. --velpari-skip-doctor → preflight bypassed; loadState errors surface as before", async () => {
		corruptState();
		const { ctx, notifies } = notifyOnlyCtx();
		const pi = { getFlag: (name: string): unknown => name === "velpari-skip-doctor" } as never;
		// Row 3: the flag opts out of preflight entirely — the state file's own
		// error surfaces from loadState exactly as it did pre-Phase C.
		await assert.rejects(() => runStage("prd", ctx, pi, tmpDir), /JSON|Unexpected|token/i);
		assert.equal(notifies.some((n) => n.m.includes("state-unreadable")), false, "preflight was skipped");
	});
});
