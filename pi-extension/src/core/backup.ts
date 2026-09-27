// ============================================================================
// core/backup.ts — Backup subsystem (Layer 0; Foundation contract + Phase 3)
// ============================================================================
// Decisions N9/N10/N11: offline snapshot backups of the store DB, written by
// CODE (zero-token, no LLM) at the risky moments — before every publish
// commit, before /velpari-db-reset, before migrate-store --execute. Location:
// Backup/velpari/<project>/ (local-only, gitignore-healed via
// ops/git-attributes.ts BACKUP_IGNORE_LINES), FIFO keep-last-N
// (core/config.ts retentionConfig, default 10), N11 self-test
// (PRAGMA quick_check at creation, result recorded in the manifest).
//
// Phase 3 replaces Foundation's no-op with the real implementation:
//   * snapshot = VACUUM INTO from a READ-ONLY handle (G-3 — never a raw copy
//     of a live WAL database; the source bytes stay untouched),
//   * one manifest.jsonl line per event (project, paths, SHA-256 digest,
//     git commit, timestamp, trigger, quick_check),
//   * FIFO prune (N10) + restore path (G-2) live in this file.
//
// Contract stability (Phases 1/2 already call this): the signature and
// BackupRecord are unchanged from Foundation, and createBackupSnapshot NEVER
// throws — it returns null when no backup happened (missing DB, unreadable
// DB, disk/git failure). Callers treat null as "subsystem not installed" and
// continue; a backup must never block a publish or a reset.
// ============================================================================

import { spawnSync } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative } from "node:path";

import { atomicWriteFile } from "../io/atomic-write.js";
import { closeStoreDb, maxKnownVersion, openStoreDb, openStoreDbReadOnly } from "../io/db.js";
import { readLockInfo, runLockDir } from "../io/run-lock.js";
import { appendAuditEntry } from "../io/store.js";
import { retentionConfig } from "./config.js";
import { BACKUP_ROOT_DIR, buildBackupDir, buildStoreDbPath } from "./paths.js";

/** The events that trigger an automatic snapshot backup (N9). */
export const BACKUP_TRIGGERS = ["publish", "db-reset", "migrate"] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

/** One backup manifest record (written next to the snapshot, N9). */
export interface BackupRecord {
	projectName: string;
	/** Backup/velpari/<project>/index-<UTC>-<sha>.db (repo-relative). */
	backupPath: string;
	/** SHA-256 of the snapshot bytes. */
	dbDigest: string;
	/** Git commit at backup time (null when not in a repo / unknown). */
	gitCommit: string | null;
	/** UTC ISO timestamp. */
	createdAt: string;
	/** N11 self-test result (PRAGMA quick_check); null = not run. */
	quickCheckOk: boolean | null;
}

/**
 * One parsed `manifest.jsonl` line (N9). Written atomically, read
 * line-by-line; unknown keys and unparseable lines are tolerated by the
 * readers (a damaged manifest must never break reporting or restore).
 */
export interface BackupManifestLine {
	type: "backup" | "trim" | "restore" | "pre-restore";
	project: string;
	dbPath?: string;
	backupPath?: string;
	sha256?: string;
	bytes?: number;
	gitCommit?: string | null;
	createdAt?: string;
	trigger?: string;
	quickCheck?: boolean;
	deleted?: string;
	at?: string;
	kept?: number;
	restoredFrom?: string;
	safetyCopy?: string | null;
}

/** Manifest filename inside `Backup/velpari/<project>/` (N9). */
export const MANIFEST_NAME = "manifest.jsonl";

// ---------------------------------------------------------------------------
// private helpers
// ---------------------------------------------------------------------------

/** Manifest path for one project's backup folder. */
function manifestPathFor(dir: string): string {
	return join(dir, MANIFEST_NAME);
}

/** SHA-256 of a file's bytes (the digest recorded in the manifest). */
function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Current git commit at cwd, or null when not in a repo / git unavailable. */
function gitCommitAt(cwd: string): string | null {
	try {
		const res = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" });
		if (res.error || res.status !== 0) return null;
		const sha = (res.stdout ?? "").trim();
		return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
	} catch {
		return null;
	}
}

/**
 * Filesystem-safe UTC stamp: `2026-09-27T03:30:00.123Z` → `20260927T033000Z`.
 * Sorts lexicographically in chronological order (the FIFO relies on that).
 */
function utcStamp(at: Date = new Date()): string {
	return at
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
}

/**
 * Append one line to the project manifest. Read → append → atomic write
 * (never `fs.writeFileSync` outside io/, rule 6); manifests are tens of
 * lines, so a full rewrite is cheap.
 */
function appendManifestLine(dir: string, line: BackupManifestLine): void {
	const file = manifestPathFor(dir);
	let text = "";
	try {
		if (existsSync(file)) text = readFileSync(file, "utf8");
	} catch {
		text = "";
	}
	const prefix = text === "" || text.endsWith("\n") ? text : `${text}\n`;
	atomicWriteFile(file, `${prefix}${JSON.stringify(line)}\n`, "utf8");
}

/**
 * G-3: one consistent snapshot of `srcDbPath` at `outPath` via `VACUUM INTO`
 * from a READ-ONLY handle. Never a raw file copy, never touches `-wal`/`-shm`,
 * never creates or migrates the source. Committed-but-uncheckpointed (WAL)
 * rows are included — verified by probe 2026-09-27 and by the WAL test case.
 *
 * @throws when the source cannot be opened read-only or VACUUM INTO fails.
 */
function writeSnapshot(srcDbPath: string, outPath: string): void {
	const db = openStoreDbReadOnly(srcDbPath);
	try {
		db.exec(`VACUUM INTO '${outPath.replace(/'/g, "''")}'`);
	} finally {
		db.close();
	}
}

/**
 * N11 self-test: `PRAGMA quick_check` on the snapshot, READ-ONLY so the
 * file keeps its pristine `VACUUM INTO` bytes (digest stays stable).
 * @returns true when the check says `ok`, false when it does not or the
 *          snapshot cannot be opened (never throws).
 */
function quickCheckFile(path: string): boolean {
	let db: DatabaseSync | undefined;
	try {
		db = openStoreDbReadOnly(path);
		const row = db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
		return row?.quick_check === "ok";
	} catch {
		return false;
	} finally {
		try {
			db?.close();
		} catch {
			/* already closed or never opened */
		}
	}
}

// ---------------------------------------------------------------------------
// N10 — FIFO keep-last-N prune
// ---------------------------------------------------------------------------

/**
 * Order snapshots by ACTUAL creation order: `mtimeMs` first (the filename
 * alone is ambiguous — same-second backups carry `-2`/`-3` disambiguators and
 * lexicographic order puts the bare name LAST within one second), with the
 * parsed `(UTC stamp, disambiguator)` as tiebreaker, then the name.
 */
function compareCreationOrder(a: string, b: string, aDir: string, bDir: string): number {
	const mtimeA = safeMtime(join(aDir, a));
	const mtimeB = safeMtime(join(bDir, b));
	if (mtimeA !== mtimeB) return mtimeA - mtimeB;
	const keyA = parseBackupName(a);
	const keyB = parseBackupName(b);
	if (keyA && keyB) {
		if (keyA.stamp !== keyB.stamp) return keyA.stamp < keyB.stamp ? -1 : 1;
		return keyA.seq - keyB.seq;
	}
	return a < b ? -1 : a > b ? 1 : 0;
}

/** `index-<UTC>-<git-short>[-<n>].db` → sortable key (null when unparseable). */
function parseBackupName(name: string): { stamp: string; seq: number } | null {
	const m = /^index-(\d{8}T\d{6}Z)-(?:[0-9a-f]{7}|nogit)(?:-(\d+))?\.db$/.exec(name);
	if (!m) return null;
	return { stamp: m[1]!, seq: m[2] ? Number(m[2]) : 1 };
}

function safeMtime(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

/**
 * Append one `type:"trim"` manifest line per deletion (N9 provenance + the
 * N10 "every FIFO trim writes an audit event" trail in human-readable form).
 */
function appendTrimLines(dir: string, projectName: string, deleted: string[], keep: number): void {
	for (const rel of deleted) {
		appendManifestLine(dir, {
			type: "trim",
			project: projectName,
			deleted: rel,
			at: new Date().toISOString(),
			kept: keep,
		});
	}
}

/**
 * F17/F18 best-effort audit row for a FIFO trim: only when the source DB
 * exists AND already has an `audit_ledger` (never opens a DB that would have
 * to be migrated from inside a backup). Any failure is swallowed — the
 * manifest lines already record the trim.
 */
function auditTrim(cwd: string, projectName: string, deleted: string[], keep: number): void {
	const dbPath = buildStoreDbPath(projectName, cwd);
	if (!existsSync(dbPath)) return;
	try {
		const probe = openStoreDbReadOnly(dbPath);
		let hasLedger = false;
		try {
			const row = probe
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_ledger'")
				.get() as { name?: string } | undefined;
			hasLedger = row?.name === "audit_ledger";
		} finally {
			probe.close();
		}
		if (!hasLedger) return;

		const db = openStoreDb(dbPath);
		try {
			appendAuditEntry(db, {
				actor: "velpari-backup",
				action: "backup-trim",
				reason: `FIFO keep-last-${keep}`,
				detail: { project: projectName, deleted, kept: keep },
			});
		} finally {
			closeStoreDb(db);
		}
	} catch {
		/* best effort — never blocks a caller */
	}
}

/**
 * Keep the newest `keep` snapshots in `Backup/velpari/<project>/` and delete
 * the rest oldest-first (N10 — the 11th backup auto-deletes the oldest).
 * `keep` comes from `retentionConfig(cwd).backups` (default 10; malformed
 * `files.json` falls back to 10 and is clamped to >= 1). Each deletion writes
 * a `type:"trim"` manifest line and, when the store has an `audit_ledger`, a
 * `backup-trim` audit row (rule 5). Never throws.
 */
function pruneBackups(cwd: string, projectName: string): void {
	try {
		const dir = buildBackupDir(projectName, cwd);
		if (!existsSync(dir)) return;

		let keep = 10;
		try {
			keep = retentionConfig(cwd).backups;
		} catch {
			keep = 10;
		}
		if (!Number.isFinite(keep) || keep < 1) keep = 10;
		keep = Math.max(1, Math.trunc(keep));

		const names = readdirSync(dir).filter((n) => /^index-.*\.db$/.test(n));
		names.sort((a, b) => compareCreationOrder(a, b, dir, dir));
		if (names.length <= keep) return;

		// ascending creation order → the FIRST (names.length - keep) are oldest
		const excess = names.slice(0, names.length - keep);
		const deleted: string[] = [];
		for (const name of excess) {
			const abs = join(dir, name);
			try {
				unlinkSync(abs);
				deleted.push(relative(cwd, abs));
			} catch {
				/* a locked file stays; it will be retried next time */
			}
		}
		if (deleted.length === 0) return;

		appendTrimLines(dir, projectName, deleted, keep);
		auditTrim(cwd, projectName, deleted, keep);
	} catch {
		/* never throws (rule 1) */
	}
}

/**
 * Every snapshot basename this folder has EVER used: files on disk plus the
 * names recorded in the manifest (`backupPath` on backup lines, `deleted` on
 * trim lines). A FIFO trim deletes the file but never frees the name — reusing
 * a pruned basename would let two manifest lines claim the same path with
 * different digests (ambiguous provenance for restore).
 */
function historicalNames(dir: string): Set<string> {
	const used = new Set<string>();
	try {
		for (const name of readdirSync(dir)) used.add(name);
	} catch {
		/* folder absent — nothing to collide with */
	}
	try {
		const file = manifestPathFor(dir);
		if (existsSync(file)) {
			for (const raw of readFileSync(file, "utf8").split("\n")) {
				if (raw.trim() === "") continue;
				try {
					const line = JSON.parse(raw) as BackupManifestLine;
					for (const field of [line.backupPath, line.deleted]) {
						if (typeof field === "string" && field !== "") used.add(basename(field));
					}
				} catch {
					/* unparseable line — readers never throw */
				}
			}
		}
	} catch {
		/* best effort */
	}
	return used;
}

/**
 * First free snapshot path for `base`: bare name first (n=1), then `-2`, `-3`,
 * … skipping anything already on disk or historically named in the manifest
 * (N10: `VACUUM INTO` refuses an existing target, and a name stays used even
 * after its file is trimmed away).
 */
function nextFreeSnapshotPath(dir: string, base: string): string {
	const used = historicalNames(dir);
	let n = 1;
	let candidate = join(dir, n === 1 ? `${base}.db` : `${base}-${n}.db`);
	while (used.has(basename(candidate)) || existsSync(candidate)) {
		n++;
		candidate = join(dir, `${base}-${n}.db`);
	}
	return candidate;
}

// ---------------------------------------------------------------------------
// N9 — create one snapshot backup
// ---------------------------------------------------------------------------

/**
 * Create one snapshot backup of a store DB (N9/N10/N11).
 *
 * Steps: guard (never create the source) → folder → git commit → unique
 * filename `index-<UTC>-<git-short-sha>.db` → `VACUUM INTO` (G-3) →
 * read-only `quick_check` (N11) → SHA-256 → manifest line → FIFO prune.
 *
 * NEVER throws and NEVER blocks: any failure returns `null` and leaves the
 * source untouched (a partial snapshot file is cleaned up).
 *
 * @param params - cwd, projectName, N9 trigger, and the source DB path.
 * @returns The backup record, or null when no backup happened.
 */
export function createBackupSnapshot(params: {
	cwd: string;
	projectName: string;
	trigger: BackupTrigger;
	dbPath: string;
}): BackupRecord | null {
	try {
		const { cwd, projectName, trigger, dbPath } = params;
		// Rule 2: never create or migrate the source as a side effect.
		if (!dbPath || !existsSync(dbPath)) return null;

		const dir = buildBackupDir(projectName, cwd);
		mkdirSync(dir, { recursive: true });

		const gitCommit = gitCommitAt(cwd);
		const gitShort = gitCommit ? gitCommit.slice(0, 7) : "nogit";

		// D1 (confirmed): filename carries the git short sha; VACUUM INTO
		// refuses an existing target, so disambiguate with -2, -3, … The name
		// must also stay unique ACROSS prunes (a trimmed basename is still
		// claimed by the manifest) — see nextFreeSnapshotPath.
		const base = `index-${utcStamp(new Date())}-${gitShort}`;
		const outPath = nextFreeSnapshotPath(dir, base);

		try {
			writeSnapshot(dbPath, outPath);
		} catch (err) {
			// Never leave a half-written snapshot for the FIFO to count.
			try {
				if (existsSync(outPath)) unlinkSync(outPath);
			} catch {
				/* best effort */
			}
			throw err;
		}

		// N11: self-test BEFORE digesting (read-only → bytes never change).
		const quickCheckOk = quickCheckFile(outPath);
		const dbDigest = sha256File(outPath);
		const createdAt = new Date().toISOString();
		const backupPath = relative(cwd, outPath);

		appendManifestLine(dir, {
			type: "backup",
			project: projectName,
			dbPath: relative(cwd, dbPath),
			backupPath,
			sha256: dbDigest,
			bytes: statSync(outPath).size,
			gitCommit,
			createdAt,
			trigger,
			quickCheck: quickCheckOk,
		});

		const record: BackupRecord = { projectName, backupPath, dbDigest, gitCommit, createdAt, quickCheckOk };

		// Step 9 — FIFO prune (N10), AFTER the snapshot exists (rule 4).
		// Own try/catch: a prune failure must never turn a real backup into a
		// null result (the caller would wrongly think nothing was saved).
		try {
			pruneBackups(cwd, projectName);
		} catch {
			/* backup stands on its own */
		}

		return record;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// readers (Phase 6 doctor + merge-runbook consumers)
// ---------------------------------------------------------------------------

/** Resolve a caller-supplied backup path (absolute or cwd-relative). */
function resolveBackupPath(cwd: string, backupPath: string): string {
	return isAbsolute(backupPath) ? normalize(backupPath) : join(cwd, backupPath);
}

/** Last `type:"backup"` manifest entry naming this snapshot (null when absent). */
function findBackupLine(lines: readonly BackupManifestLine[], rel: string, asGiven: string): BackupManifestLine | null {
	let found: BackupManifestLine | null = null;
	for (const line of lines) {
		if (line.type !== "backup") continue;
		if (line.backupPath === rel || line.backupPath === asGiven) found = line;
	}
	return found;
}

/** `PRAGMA user_version` of an existing DB file (read-only; null on failure). */
function readSchemaVersion(path: string): number | null {
	let db: DatabaseSync | undefined;
	try {
		db = openStoreDbReadOnly(path);
		return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
	} catch {
		return null;
	} finally {
		try {
			db?.close();
		} catch {
			/* never opened */
		}
	}
}

/** True when the file already has an audit_ledger (never creates one). */
function hasAuditLedger(path: string): boolean {
	let db: DatabaseSync | undefined;
	try {
		db = openStoreDbReadOnly(path);
		const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_ledger'").get() as
			| { name?: string }
			| undefined;
		return row?.name === "audit_ledger";
	} catch {
		return false;
	} finally {
		try {
			db?.close();
		} catch {
			/* never opened */
		}
	}
}

/**
 * Read `manifest.jsonl` for one project: lines in FILE order; an unparseable
 * or non-object line is skipped (never thrown) — a damaged manifest must not
 * break reporting or restore. Returns `[]` when the manifest is absent.
 */
export function readBackupManifest(cwd: string, projectName: string): BackupManifestLine[] {
	const file = manifestPathFor(buildBackupDir(projectName, cwd));
	let text: string;
	try {
		if (!existsSync(file)) return [];
		text = readFileSync(file, "utf8");
	} catch {
		return [];
	}
	const out: BackupManifestLine[] = [];
	for (const raw of text.split("\n")) {
		if (raw.trim() === "") continue;
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (typeof parsed === "object" && parsed !== null) out.push(parsed as BackupManifestLine);
		} catch {
			/* damaged line — skipped, readers never throw */
		}
	}
	return out;
}

/**
 * Snapshot files (absolute paths), NEWEST first — the order a picker or the
 * doctor should show them in. Never throws (`[]` when the folder is absent).
 */
export function listBackupFiles(cwd: string, projectName: string): string[] {
	const dir = buildBackupDir(projectName, cwd);
	let names: string[];
	try {
		names = readdirSync(dir).filter((n) => /^index-.*\.db$/.test(n));
	} catch {
		return [];
	}
	names.sort((a, b) => compareCreationOrder(a, b, dir, dir));
	return names.reverse().map((n) => join(dir, n));
}

/**
 * Verify one snapshot against its manifest (N9 provenance + N11 self-test):
 * file exists, a `type:"backup"` line names it, SHA-256 matches, and a
 * read-only `PRAGMA quick_check` on the snapshot says `ok`.
 * Never throws; `problems` lists every failure found (not just the first).
 */
export function verifyBackup(
	cwd: string,
	projectName: string,
	backupPath: string,
): { ok: boolean; problems: string[] } {
	const problems: string[] = [];
	const abs = resolveBackupPath(cwd, backupPath);
	const rel = relative(cwd, abs);

	const line = findBackupLine(readBackupManifest(cwd, projectName), rel, backupPath);
	if (!line) {
		problems.push(`no manifest entry for ${rel} — the snapshot cannot be proven`);
	}
	if (!existsSync(abs)) {
		problems.push(`snapshot missing: ${rel}`);
		return { ok: false, problems };
	}
	if (line) {
		if (!line.sha256) {
			problems.push(`manifest entry for ${rel} has no sha256`);
		} else {
			const actual = sha256File(abs);
			if (actual !== line.sha256) {
				problems.push(`digest mismatch for ${rel}: manifest ${line.sha256}, file ${actual} (tampered or corrupted)`);
			}
		}
	}
	if (!quickCheckFile(abs)) {
		problems.push(`quick_check failed for ${rel}`);
	}
	return { ok: problems.length === 0, problems };
}

/** Outcome of `restoreBackupSnapshot` (never throws — every failure lands here). */
export interface RestoreResult {
	ok: boolean;
	/** Refusal/failure reasons — CLOSED set: unproven/tampered snapshot, newer schema, active run lock, or a failed post-copy check. */
	problems: string[];
	/** Non-blocking notes: safety snapshot skipped (GAP-1), audit row skipped, … */
	warnings: string[];
	/** Repo-relative snapshot restored from ("" when refused before any write). */
	restoredFrom: string;
	/** Repo-relative pre-restore safety snapshot (null = skipped — GAP-1). */
	safetyCopy: string | null;
	/**
	 * Internal torn-copy proof: `true` when the restored bytes matched the
	 * manifest digest immediately after the atomic replace (Issue 5 — the
	 * later migration/audit writes change the bytes, so a caller cannot
	 * re-derive this). `false` on a mismatch; omitted when never checked.
	 */
	bytesMatchSnapshot?: boolean;
}

/**
 * Deliberate restore (N10: the CALLER owns the confirmation gate — this L0
 * function has no UI). Provenance + digest + schema + run-lock checks FIRST,
 * then a best-effort pre-restore safety snapshot, then an atomic replace and
 * re-verification. Recreates a MISSING target (GAP-1) — the disaster restore
 * exists for; a corrupt target is skipped for the safety copy (GAP-1b) and
 * replaced. Refusal is CLOSED: only an unproven/tampered snapshot, a
 * newer-schema snapshot, an active run lock, or a failed safety copy for a
 * HEALTHY target may refuse. Never throws.
 */
export function restoreBackupSnapshot(params: { cwd: string; projectName: string; backupPath: string }): RestoreResult {
	const { cwd, projectName } = params;
	const warnings: string[] = [];
	const refuse = (problem: string): RestoreResult => ({
		ok: false,
		problems: [problem],
		warnings,
		restoredFrom: "",
		safetyCopy: null,
	});

	try {
		const abs = resolveBackupPath(cwd, params.backupPath);
		const rel = relative(cwd, abs);
		const target = buildStoreDbPath(projectName, cwd);
		const manifestHint = join(BACKUP_ROOT_DIR, projectName, MANIFEST_NAME);

		// 1. Provenance (N9): an existing type:"backup" line must name it.
		const lines = readBackupManifest(cwd, projectName);
		const entry = findBackupLine(lines, rel, params.backupPath);
		if (!entry) {
			return refuse(
				`no manifest entry for ${rel} — the snapshot cannot be proven; inspect ${manifestHint} (or re-derive the digest manually) before retrying.`,
			);
		}

		// 2. Tamper/corruption gate: zero writes on any problem.
		const verdict = verifyBackup(cwd, projectName, rel);
		if (!verdict.ok) {
			return { ok: false, problems: verdict.problems, warnings, restoredFrom: "", safetyCopy: null };
		}

		// 3. Schema ceiling (G3): never replace a DB with one this build cannot open.
		const snapshotVersion = readSchemaVersion(abs);
		if (snapshotVersion !== null && snapshotVersion > maxKnownVersion()) {
			return refuse(
				`snapshot schema v${snapshotVersion} is newer than this extension (v${maxKnownVersion()}) — upgrade before restoring.`,
			);
		}

		// 4. Active-run guard: replacing the file under an open writer (which
		//    would then checkpoint its own -wal over it) is how a restore
		//    corrupts the file it rescues.
		const lockPath = runLockDir(cwd);
		const holder = readLockInfo(cwd);
		if (holder || existsSync(lockPath)) {
			const who = holder
				? `held by pid ${holder.pid} (command ${holder.command}, heartbeat ${holder.heartbeatAt})`
				: "holder unreadable";
			return refuse(
				`a run lock exists at ${lockPath} — ${who}; close any running pi session first; if the holder is dead, clear the lock via the runbook / N13 path.`,
			);
		}

		// 5. Pre-restore safety snapshot — best effort, gated on target health.
		let safetyCopy: string | null = null;
		if (!existsSync(target)) {
			warnings.push("pre-restore safety snapshot skipped — no target to copy");
		} else if (!quickCheckFile(target)) {
			warnings.push("pre-restore safety snapshot skipped — target failed quick_check (corrupt)");
		} else {
			const dir = buildBackupDir(projectName, cwd);
			mkdirSync(dir, { recursive: true });
			const gitShort = gitCommitAt(cwd)?.slice(0, 7) ?? "nogit";
			const safetyAbs = nextFreeSnapshotPath(dir, `index-${utcStamp(new Date())}-${gitShort}`);
			try {
				writeSnapshot(target, safetyAbs);
			} catch {
				return refuse(
					`pre-restore safety snapshot failed for a healthy target — refusing to overwrite a DB we could not protect; free space/permissions in ${dir} and retry.`,
				);
			}
			safetyCopy = relative(cwd, safetyAbs);
			appendManifestLine(dir, {
				type: "pre-restore",
				project: projectName,
				backupPath: safetyCopy,
				dbPath: relative(cwd, target),
				sha256: sha256File(safetyAbs),
				bytes: statSync(safetyAbs).size,
				createdAt: new Date().toISOString(),
				quickCheck: quickCheckFile(safetyAbs),
			});
		}

		// 6. Replace: atomic write through io/, then drop stale WAL sidecars
		//    (a leftover -wal would replay over the restored file).
		mkdirSync(dirname(target), { recursive: true });
		const tmpPath = `${target}.restore.tmp`;
		atomicWriteFile(tmpPath, readFileSync(abs));
		renameSync(tmpPath, target);
		for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
			try {
				if (existsSync(sidecar)) unlinkSync(sidecar);
			} catch {
				warnings.push(`stale sidecar ${relative(cwd, sidecar)} could not be removed`);
			}
		}

		// 7. Verify: byte identity against the manifest digest, then open +
		//    quick_check (G3 + migrations) + checkpoint. The byte check is the
		//    internal torn-copy proof (Issue 5: the audit row appended in
		//    step 8 changes the bytes afterwards, so callers cannot re-derive it).
		if (entry.sha256) {
			const restoredDigest = sha256File(target);
			if (restoredDigest !== entry.sha256) {
				return {
					ok: false,
					problems: [
						`restored bytes do not match the snapshot digest (manifest ${entry.sha256}, restored ${restoredDigest}) — the copy was torn${safetyCopy ? `; the safety copy ${safetyCopy} is on disk for a retry` : ""}.`,
					],
					warnings,
					restoredFrom: rel,
					safetyCopy,
					bytesMatchSnapshot: false,
				};
			}
		}
		try {
			const db = openStoreDb(target);
			let postOk = false;
			try {
				const row = db.prepare("PRAGMA quick_check").get() as { quick_check?: string };
				postOk = row?.quick_check === "ok";
			} finally {
				closeStoreDb(db);
			}
			if (!postOk) {
				return {
					ok: false,
					problems: [`post-restore quick_check failed for ${rel}`],
					warnings,
					restoredFrom: rel,
					safetyCopy,
				};
			}
		} catch (err) {
			return {
				ok: false,
				problems: [`post-restore open failed: ${(err as Error)?.message ?? String(err)}`],
				warnings,
				restoredFrom: rel,
				safetyCopy,
			};
		}

		// 8. Record: manifest line (atomic) + best-effort audit row (rule 5).
		const dir = buildBackupDir(projectName, cwd);
		try {
			appendManifestLine(dir, {
				type: "restore",
				project: projectName,
				backupPath: rel,
				restoredFrom: rel,
				dbPath: relative(cwd, target),
				safetyCopy,
				at: new Date().toISOString(),
			});
		} catch {
			warnings.push("restore manifest line could not be written");
		}
		try {
			if (hasAuditLedger(target)) {
				const db = openStoreDb(target);
				try {
					appendAuditEntry(db, {
						actor: "velpari-backup",
						action: "backup-restore",
						detail: { from: rel, safetyCopy },
					});
				} finally {
					closeStoreDb(db);
				}
			} else {
				warnings.push("restore audit row skipped — target has no audit_ledger");
			}
		} catch {
			warnings.push("restore audit row could not be written");
		}

		// 9. Success.
		return {
			ok: true,
			problems: [],
			warnings,
			restoredFrom: rel,
			safetyCopy,
			bytesMatchSnapshot: entry.sha256 ? true : undefined,
		};
	} catch (err) {
		return {
			ok: false,
			problems: [`restore failed: ${(err as Error)?.message ?? String(err)}`],
			warnings,
			restoredFrom: "",
			safetyCopy: null,
		};
	}
}
