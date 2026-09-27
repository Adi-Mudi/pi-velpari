/**
 * Run lock tests (Senai io/lock.ts port).
 *
 * Asserts:
 *   - acquire/release round trip (meta visible while held, gone after)
 *   - double-acquire by a live holder is busy with holder info
 *   - stale locks (dead pid or old heartbeat) are auto-stolen
 *   - withRunLock returns fn's value, releases, and throws when busy
 *   - fail-open: unexpected I/O errors never wedge the mutation
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireRunLock, readLockInfo, readLockStatus, runLockDir, withRunLock, type RunLockMeta } from "../../src/io/run-lock.js";

let tmpDir: string;

/**
 * Absolute path of the lock's meta.json under the current fixture cwd.
 * @returns {string} Path to `meta.json` inside the lock directory.
 */
function lockFile(): string {
	return path.join(runLockDir(tmpDir), "meta.json");
}

/**
 * Write a stale/foreign meta.json (creating the lock dir first) so a test
 * can drive the steal-vs-wait paths. Defaults to an invalid pid and a
 * 120s-old heartbeat unless overridden.
 * @param {Partial<RunLockMeta>} overrides - Field overrides for the fixture metadata.
 * @returns {void}
 */
function writeStaleMeta(overrides: Partial<RunLockMeta>): void {
	fs.mkdirSync(runLockDir(tmpDir), { recursive: true });
	const old = new Date(Date.now() - 120_000).toISOString();
	const meta: RunLockMeta = {
		pid: 2_000_000_000, // invalid pid → ESRCH on process.kill probe
		host: "other-host",
		command: "crashed-command",
		startedAt: old,
		heartbeatAt: old,
		...overrides,
	};
	fs.writeFileSync(lockFile(), JSON.stringify(meta), "utf8");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velpari-run-lock-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("acquireRunLock / release", () => {
	it("acquires a free lock and releases it", () => {
		const res = acquireRunLock(tmpDir, "test", 0);
		assert.ok(res.ok);
		const info = readLockInfo(tmpDir);
		assert.ok(info);
		assert.equal(info.pid, process.pid);
		assert.equal(info.command, "test");

		res.handle.release();
		assert.equal(readLockInfo(tmpDir), null);
		assert.equal(fs.existsSync(runLockDir(tmpDir)), false);
	});

	it("reports busy when a live holder owns the lock", () => {
		const first = acquireRunLock(tmpDir, "first", 0);
		assert.ok(first.ok);
		const second = acquireRunLock(tmpDir, "second", 0);
		assert.equal(second.ok, false);
		if (!second.ok) {
			assert.match(second.reason, /Lock busy/);
			assert.equal(second.holder?.pid, process.pid);
		}
		first.handle.release();
	});

	it("the atomic claim is non-recursive, so the EEXIST contention branch is reachable (Phase I10.1)", () => {
		// Source-level pin (same technique as approve-command-names): the
		// claim inside tryAcquire must be a plain mkdirSync — with
		// `recursive: true` an existing dir is a success, EEXIST never
		// fires, and two processes could both think they hold the lock.
		const file = path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			"..",
			"..",
			"src",
			"io",
			"run-lock.js",
		);
		const source = fs.readFileSync(file, "utf8");
		const claim = source.match(/try \{\s*fs\.mkdirSync\(dir([^)]*)\);\s*\}\s*catch/s);
		assert.ok(claim, "tryAcquire's claim (mkdir inside try/catch) not found");
		assert.ok(!claim[1]!.includes("recursive"), "the atomic claim must not be recursive:true");
		// Behavioural half: a pre-existing lock dir + live-fresh holder
		// (pid 1 — init is always alive; EPERM counts as alive) must take
		// the EEXIST → steal-vs-wait path and come back busy.
		fs.mkdirSync(runLockDir(tmpDir), { recursive: true });
		fs.writeFileSync(
			path.join(runLockDir(tmpDir), "meta.json"),
			JSON.stringify({
				pid: 1,
				host: "other-host",
				command: "other-command",
				startedAt: new Date().toISOString(),
				heartbeatAt: new Date().toISOString(),
			} satisfies RunLockMeta),
			"utf8",
		);
		const res = acquireRunLock(tmpDir, "second", 0);
		assert.equal(res.ok, false);
		if (!res.ok) {
			assert.match(res.reason, /Lock busy/);
			assert.equal(res.holder?.pid, 1);
		}
	});

	it("steals a stale lock (dead pid + old heartbeat)", () => {
		writeStaleMeta({});
		const res = acquireRunLock(tmpDir, "stealer", 0);
		assert.ok(res.ok);
		assert.equal(readLockInfo(tmpDir)?.command, "stealer");
		res.handle.release();
	});

	it("steals a lock with a fresh heartbeat but a dead pid", () => {
		writeStaleMeta({ heartbeatAt: new Date().toISOString() });
		const res = acquireRunLock(tmpDir, "stealer", 0);
		assert.ok(res.ok);
		res.handle.release();
	});

	it("treats the pid=-1 release sentinel as stale", () => {
		writeStaleMeta({ pid: -1, heartbeatAt: new Date().toISOString() });
		const res = acquireRunLock(tmpDir, "stealer", 0);
		assert.ok(res.ok);
		res.handle.release();
	});
});

describe("withRunLock", () => {
	it("runs fn under the lock, returns its value, and releases", () => {
		let ranInside = false;
		const value = withRunLock(tmpDir, "mutation", () => {
			ranInside = readLockInfo(tmpDir)?.command === "mutation";
			return 42;
		});
		assert.equal(value, 42);
		assert.equal(ranInside, true);
		assert.equal(readLockInfo(tmpDir), null);
	});

	it("releases even when fn throws", () => {
		assert.throws(() =>
			withRunLock(tmpDir, "mutation", () => {
				throw new Error("boom");
			}),
		);
		assert.equal(readLockInfo(tmpDir), null);
	});

	it("throws with holder info when the lock is busy", () => {
		const first = acquireRunLock(tmpDir, "holder", 0);
		assert.ok(first.ok);
		let ran = false;
		assert.throws(
			() =>
				withRunLock(tmpDir, "contender", () => {
					ran = true;
				}),
			/Lock busy/,
		);
		assert.equal(ran, false);
		first.handle.release();
	});

	it("fails open on unexpected I/O errors (lock path blocked by a file)", () => {
		// A regular file where the lock DIRECTORY should be: mkdir/read/write
		// all fail with ENOTDIR/EEXIST — the mutation must still run.
		const plansDir = path.join(tmpDir, ".pi", "velpari");
		fs.mkdirSync(plansDir, { recursive: true });
		fs.writeFileSync(path.join(plansDir, ".lock"), "not a dir", "utf8");

		let ran = false;
		const value = withRunLock(tmpDir, "mutation", () => {
			ran = true;
			return "ok";
		});
		assert.equal(ran, true);
		assert.equal(value, "ok");
	});
});

describe("readLockStatus — corrupt-lock reporting (I11.3)", () => {
	it("garbage meta.json → corrupt true, holder null, stale false (never reported as free)", () => {
		fs.mkdirSync(runLockDir(tmpDir), { recursive: true });
		fs.writeFileSync(lockFile(), "{not json", "utf8");
		const status = readLockStatus(tmpDir);
		assert.equal(status.corrupt, true);
		assert.equal(status.holder, null);
		assert.equal(status.stale, false, "stale applies to holders; corrupt is the flag for unreadable meta");
	});

	it("lock dir without meta.json → corrupt true (half-written acquisition)", () => {
		fs.mkdirSync(runLockDir(tmpDir), { recursive: true });
		const status = readLockStatus(tmpDir);
		assert.equal(status.corrupt, true);
		assert.equal(status.holder, null);
	});

	it("no lock at all → corrupt false", () => {
		const status = readLockStatus(tmpDir);
		assert.equal(status.corrupt, false);
		assert.equal(status.holder, null);
	});

	it("healthy live holder → corrupt false, stale false", () => {
		const now = new Date().toISOString();
		fs.mkdirSync(runLockDir(tmpDir), { recursive: true });
		fs.writeFileSync(
			lockFile(),
			JSON.stringify({ pid: process.pid, host: "test-host", command: "velpari-prd", startedAt: now, heartbeatAt: now }),
			"utf8",
		);
		const status = readLockStatus(tmpDir);
		assert.equal(status.corrupt, false);
		assert.equal(status.stale, false);
		assert.equal(status.holder?.pid, process.pid);
	});
});
