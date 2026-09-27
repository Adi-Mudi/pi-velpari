/**
 * Stale-lock detection tests (Phase 6 — N13/G-5).
 *
 * Covers: lock free → ok, live holder → info (never warning), dead
 * holder → warning naming pid/host/command + the /velpari-reset
 * recovery path, corrupt meta → WARNING naming /velpari-reset (never
 * "free", never an error — I11.3), and the D5
 * invariant: the stale lock yields exactly ONE warning across the N13
 * section and the gate-wiring section (gate-wiring is an info pointer).
 */

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRunLockSection } from "../../src/doctor/checks/stale-lock.js";
import { checkGateWiringSection } from "../../src/doctor/checks/stale-downstream.js";
import { summarize } from "../../src/doctor/_types.js";

let dirs: string[] = [];
let cwd = "";

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "velpari-stalelock-"));
	dirs.push(dir);
	cwd = dir;
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Write a meta.json fixture into the current cwd's lock directory (creating the dir).
 * @param {Record<string, unknown>} meta - Metadata object serialized as meta.json.
 * @returns {void}
 */
function writeLock(meta: Record<string, unknown>): void {
	const lockDir = join(cwd, ".pi", "velpari", ".lock");
	mkdirSync(lockDir, { recursive: true });
	writeFileSync(join(lockDir, "meta.json"), JSON.stringify(meta), "utf8");
}

describe("checkRunLockSection", () => {
	test("no lock → ok (free)", () => {
		const section = checkRunLockSection(cwd);
		assert.equal(section.title, "Run lock (N13)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]?.message ?? "", /Run lock: free/);
	});

	test("live holder (this pid, fresh heartbeat) → info, zero warnings", () => {
		const now = new Date().toISOString();
		writeLock({
			pid: process.pid,
			host: "test-host",
			command: "velpari-prd",
			startedAt: now,
			heartbeatAt: now,
		});
		const section = checkRunLockSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]?.message ?? "", /held by pid=/);
		assert.match(section.items[0]?.message ?? "", /in flight/);
		assert.equal(summarize([section]).summary.warning, 0);
	});

	test("dead holder → warning + /velpari-reset recovery, never an error", () => {
		const old = new Date(Date.now() - 120_000).toISOString();
		writeLock({
			pid: 2_000_000_000,
			host: "other-host",
			command: "crashed",
			startedAt: old,
			heartbeatAt: old,
		});
		const section = checkRunLockSection(cwd);
		assert.equal(section.items.length, 1);
		const item = section.items[0];
		assert.equal(item?.status, "warning");
		assert.match(item?.message ?? "", /STALE \(pid=2000000000, host=other-host, command=crashed/);
		assert.match(item?.suggestion ?? "", /\/velpari-reset/);
		assert.match(item?.suggestion ?? "", /never delete/);
		assert.equal(summarize([section]).summary.error, 0);
		assert.equal(summarize([section]).summary.warning, 1);
	});

	test('corrupt meta.json → warning naming /velpari-reset, never "free" (I11.3)', () => {
		const lockDir = join(cwd, ".pi", "velpari", ".lock");
		mkdirSync(lockDir, { recursive: true });
		writeFileSync(join(lockDir, "meta.json"), "{not json", "utf8");
		const section = checkRunLockSection(cwd);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "warning");
		assert.match(section.items[0]?.message ?? "", /meta\.json is unreadable/);
		assert.match(section.items[0]?.message ?? "", /\/velpari-reset/);
		assert.equal(summarize([section]).summary.error, 0, "corrupt lock is a warning, never an error (I11.3)");
	});

	test("lock dir without meta.json → same corrupt warning (I11.3)", () => {
		mkdirSync(join(cwd, ".pi", "velpari", ".lock"), { recursive: true });
		const section = checkRunLockSection(cwd);
		assert.equal(section.items[0]?.status, "warning");
		assert.match(section.items[0]?.message ?? "", /\/velpari-reset/);
	});

	test("D5: exactly one warning across N13 + gate-wiring (pointer is info)", () => {
		const old = new Date(Date.now() - 120_000).toISOString();
		writeLock({
			pid: 2_000_000_000,
			host: "other-host",
			command: "crashed",
			startedAt: old,
			heartbeatAt: old,
		});
		const n13 = checkRunLockSection(cwd);
		const wiring = checkGateWiringSection(cwd);
		const combined = [...n13.items, ...wiring.items];
		const warnings = combined.filter((i) => i.status === "warning");
		assert.equal(warnings.length, 1, "the stale lock must be reported exactly once");
		assert.equal(warnings[0]?.status, "warning");
		assert.match(warnings[0]?.message ?? "", /Run lock is STALE/);
		const pointer = wiring.items.find((i) => i.message.startsWith("Run lock: STALE"));
		assert.equal(pointer?.status, "info");
	});
});
