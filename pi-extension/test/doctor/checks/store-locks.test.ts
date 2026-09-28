/**
 * store-locks doctor check tests (Phase C, plan Subphase 1.6 — B contract consumer).
 *
 * Covers: degraded contract → no project → rows surfaced → empty list →
 * throwing contract (renders a warning, never crashes).
 *
 * The B soft-lock contract is injected via `setContractForTests`
 * (fixture rule — B's real checks/soft-lock.ts is never edited by C).
 */

import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { checkStoreLocksSection } from "../../../src/doctor/checks/store-locks.js";
import { resetContractForTests, setContractForTests, type SoftLockApi } from "../../../src/doctor/contract.js";

const PROJECT = "LockApp";

afterEach(() => {
	resetContractForTests();
});

describe("checkStoreLocksSection", () => {
	it("contract absent → info soft-lock-contract-unavailable (degraded, never blocks)", () => {
		setContractForTests({ softLock: null });
		const section = checkStoreLocksSection("/nowhere", PROJECT);
		assert.equal(section.title, "Soft locks (N19)");
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /soft-lock-contract-unavailable/);
	});

	it("no project configured → info, skipped", () => {
		setContractForTests({ softLock: { listSoftLocks: () => [] } });
		const section = checkStoreLocksSection("/nowhere", "");
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /No project configured/);
	});

	it("no locks → ok", () => {
		const api: SoftLockApi = { listSoftLocks: () => [] };
		setContractForTests({ softLock: api });
		const section = checkStoreLocksSection("/nowhere", PROJECT);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]!.message, /No soft locks/);
	});

	it("rows surfaced as info with lock metadata", () => {
		const api: SoftLockApi = {
			listSoftLocks: () => [
				{
					kind: "prd",
					revisionId: 7,
					revisionNumber: 3,
					lockedBy: "design",
					lockedAt: "2026-09-28T00:00:00Z",
				},
				{
					kind: "rtm",
					revisionId: 8,
					revisionNumber: 2,
					lockedBy: "pseudocode",
					lockedAt: "2026-09-28T01:00:00Z",
				},
			],
		};
		setContractForTests({ softLock: api });
		const section = checkStoreLocksSection("/nowhere", PROJECT);
		assert.equal(section.items.length, 2);
		assert.ok(section.items.every((i) => i.status === "info"));
		assert.match(section.items[0]!.message, /prd r7 v3: locked \(consumed by design/);
		assert.match(section.items[1]!.message, /rtm r8 v2: locked \(consumed by pseudocode/);
		assert.match(section.items[0]!.message, /content immutable; republish creates a NEW version/);
	});

	it("throwing contract → renders a warning, never crashes (doctor always renders)", () => {
		const api: SoftLockApi = {
			listSoftLocks: () => {
				throw new Error("lock table missing");
			},
		};
		setContractForTests({ softLock: api });
		const section = checkStoreLocksSection("/nowhere", PROJECT);
		assert.equal(section.items[0]?.status, "warning");
		assert.match(section.items[0]!.message, /soft-lock surfacing skipped \(lock table missing\)/);
	});

	it("degraded info never blocks the report verdict (info ≠ error)", () => {
		setContractForTests({ softLock: null });
		const section = checkStoreLocksSection("/nowhere", PROJECT);
		assert.ok(section.items.every((i) => i.status !== "error"));
	});
});
