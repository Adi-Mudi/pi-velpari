/**
 * Project-wide run lock (port of Senai `io/lock.ts`, synchronous API).
 *
 * Every state.json mutation wraps its read-modify-write in `withRunLock` so
 * two Pi sessions (or a double-fired command in one session) can never
 * interleave writes and corrupt the run state. A live holder surfaces as
 * "Lock busy: holder pid=… command=… started=…". Stale locks (dead pid or
 * heartbeat older than STALE_MS) are auto-stolen on the next acquire
 * attempt, so a crashed previous session never wedges the run.
 *
 * Layout on disk:
 *   .pi/velpari/.lock/
 *     meta.json      # { pid, host, command, startedAt, heartbeatAt }
 *
 * Algorithm:
 *   1. mkdir(dir) — atomic on POSIX. Success (or a missing meta file) means
 *      we hold the lock; write meta.json with our metadata.
 *   2. If meta.json exists and the holder is alive with a fresh heartbeat,
 *      busy-wait up to ACQUIRE_TIMEOUT_MS, then fail with the holder info.
 *   3. Otherwise (stale heartbeat, dead pid, or the pid=-1 release
 *      sentinel), steal the lock by atomically rewriting meta.json.
 *   4. While held, refresh heartbeatAt every HEARTBEAT_MS.
 *   5. Release = rewrite meta.json with pid=-1 (survives a crash between
 *      the rewrite and the removal) and rm the lock dir.
 *
 * The lock is NOT recursive: a function holding the lock must never call
 * another function that acquires it. In core/state.ts only the public
 * mutation entry points lock; `saveState` stays a lock-free leaf.
 *
 * Fail-open rule: `withRunLock` runs `fn` WITHOUT the lock when acquiring
 * fails for an unexpected I/O reason. A lock bug must never wedge the
 * session — the state file's atomic temp+rename writes stay safe on their
 * own for the single-session case.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { PATHS } from "../core/constants.js";
import { atomicWriteJson } from "./atomic-write.js";

export interface RunLockMeta {
	pid: number;
	host: string;
	command: string;
	startedAt: string;
	heartbeatAt: string;
}

interface RunLockHandle {
	meta: RunLockMeta;
	release: () => void;
}

type AcquireRunLockResult =
	| { ok: true; handle: RunLockHandle }
	| { ok: false; reason: string; holder: RunLockMeta | null };

const STALE_MS = 60_000;
const ACQUIRE_TIMEOUT_MS = 2_000;
const HEARTBEAT_MS = 5_000;
const POLL_MS = 50;
/** Sentinel pid recorded just before the lock dir is removed. Lets a future
 *  acquirer treat a crashed-mid-release lock as stale. */
const RELEASING_SENTINEL_PID = -1;

export function runLockDir(cwd: string): string {
	return join(cwd, PATHS.RUN_STATE_DIR, ".lock");
}

function runLockFile(cwd: string): string {
	return join(runLockDir(cwd), "meta.json");
}

function readMeta(filePath: string): RunLockMeta | null {
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as RunLockMeta;
		if (
			typeof parsed.pid === "number" &&
			typeof parsed.host === "string" &&
			typeof parsed.command === "string" &&
			typeof parsed.startedAt === "string" &&
			typeof parsed.heartbeatAt === "string"
		) {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

/** Read-only access to the current lock holder. Returns null when free. */
export function readLockInfo(cwd: string): RunLockMeta | null {
	const file = runLockFile(cwd);
	if (!fs.existsSync(file)) return null;
	return readMeta(file);
}

function isPidAlive(pid: number): boolean {
	if (pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException | null)?.code;
		if (code === "ESRCH" || code === "EPERM") {
			// ESRCH = no such process; EPERM = exists but owned by another user
			// (still counts as alive — we cannot verify it is ours).
			return code === "EPERM";
		}
		return false;
	}
}

function isFresh(meta: RunLockMeta): boolean {
	const age = Date.now() - Date.parse(meta.heartbeatAt);
	return Number.isFinite(age) && age >= 0 && age <= STALE_MS;
}

function formatHolder(meta: RunLockMeta | null): string {
	if (!meta) return "(no holder info)";
	const ageSec = Math.max(0, Math.floor((Date.now() - Date.parse(meta.heartbeatAt)) / 1000));
	return [
		`pid=${meta.pid}`,
		`host=${meta.host}`,
		`command=${meta.command}`,
		`startedAt=${meta.startedAt}`,
		`heartbeatAt=${meta.heartbeatAt} (${ageSec}s ago)`,
	].join(", ");
}

function makeMeta(command: string): RunLockMeta {
	const now = new Date().toISOString();
	return {
		pid: process.pid,
		host: os.hostname(),
		command,
		startedAt: now,
		heartbeatAt: now,
	};
}

function startHeartbeat(file: string): NodeJS.Timeout {
	const interval = setInterval(() => {
		try {
			const existing = readMeta(file);
			if (!existing || existing.pid !== process.pid) return;
			atomicWriteJson(file, { ...existing, heartbeatAt: new Date().toISOString() });
		} catch {
			// Best-effort heartbeat; ignore errors.
		}
	}, HEARTBEAT_MS);
	// Never keep the process alive just for the heartbeat.
	interval.unref();
	return interval;
}

function releaseLockDir(file: string, dir: string): void {
	// Step 1: sentinel (pid=-1) so a future acquirer can detect a crash
	// between this rewrite and the directory removal.
	try {
		const existing = readMeta(file);
		if (existing && existing.pid === process.pid) {
			atomicWriteJson(file, { ...existing, pid: RELEASING_SENTINEL_PID });
		}
	} catch {
		// Best effort.
	}
	// Step 2: remove the lock directory.
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		// Best effort.
	}
}

function tryAcquire(dir: string, file: string, meta: RunLockMeta): { acquired: boolean; holder: RunLockMeta | null } {
	// Atomic mkdir: success means we are the holder. EEXIST means someone
	// else holds it (or held it a moment ago — the race window is µs).
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch (err) {
		if ((err as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw err;
	}
	const existing = readMeta(file);
	if (!existing) {
		atomicWriteJson(file, meta);
		return { acquired: true, holder: null };
	}
	// Existing meta: decide steal vs wait.
	if (!isPidAlive(existing.pid) || !isFresh(existing)) {
		atomicWriteJson(file, meta);
		return { acquired: true, holder: existing };
	}
	return { acquired: false, holder: existing };
}

/**
 * Acquire the run lock. On success returns a handle whose `release()` must
 * be called exactly once. On a live holder, returns `{ ok: false }` with a
 * human-readable reason after waiting up to `timeoutMs` (default 2 s).
 * Unexpected I/O errors propagate as throws — callers that must fail open
 * (like `withRunLock`) catch them there.
 */
export function acquireRunLock(
	cwd: string,
	command: string,
	timeoutMs: number = ACQUIRE_TIMEOUT_MS,
): AcquireRunLockResult {
	const dir = runLockDir(cwd);
	const file = runLockFile(cwd);
	const meta = makeMeta(command);

	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const { acquired, holder } = tryAcquire(dir, file, meta);
		if (acquired) {
			const interval = startHeartbeat(file);
			return {
				ok: true,
				handle: {
					meta,
					release: () => {
						clearInterval(interval);
						releaseLockDir(file, dir);
					},
				},
			};
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			return {
				ok: false,
				reason: `Lock busy. Holder: ${formatHolder(holder)}`,
				holder,
			};
		}
		// True sleep without burning CPU. State mutations are short and rare,
		// so blocking the event loop for ≤ ACQUIRE_TIMEOUT_MS here is
		// acceptable and keeps the state API synchronous.
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(POLL_MS, remaining));
	}
}

/**
 * Acquire the run lock, run `fn`, release in `finally`.
 *
 * - Busy (live holder, timeout expired) → throws with the holder info.
 * - Unexpected I/O error during acquire → FAILS OPEN: runs `fn` without
 *   the lock. A lock bug must never wedge the session.
 */
export function withRunLock<T>(cwd: string, command: string, fn: () => T): T {
	let handle: RunLockHandle | null = null;
	try {
		const result = acquireRunLock(cwd, command);
		if (!result.ok) {
			throw new Error(result.reason);
		}
		handle = result.handle;
	} catch (err) {
		if (err instanceof Error && err.message.startsWith("Lock busy")) throw err;
		// Unexpected I/O error — fail open.
		return fn();
	}
	try {
		return fn();
	} finally {
		handle.release();
	}
}
