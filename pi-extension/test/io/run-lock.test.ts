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
import {
	acquireRunLock,
	readLockInfo,
	runLockDir,
	withRunLock,
	type RunLockMeta,
} from "../../src/io/run-lock.js";

let tmpDir: string;

function lockFile(): string {
	return path.join(runLockDir(tmpDir), "meta.json");
}

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
		const plansDir = path.join(tmpDir, ".IDE_Plans", "velpari");
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
