// ============================================================================
// core/backup.ts — Backup subsystem contract (Layer 0, Foundation 2026-09-27)
// ============================================================================
// Decisions N9/N10/N11: offline snapshot backups of the store DB, written by
// CODE (zero-token, no LLM) at the risky moments — before every publish
// commit, before /velpari-db-reset, before migrate-store --execute. Location:
// Backup/velpari/<project>/ (local-only, gitignore-healed via
// ops/git-attributes.ts BACKUP_IGNORE_LINES), FIFO keep-last-N
// (core/config.ts retentionConfig, default 10), N11 self-test
// (PRAGMA quick_check at creation, result recorded in the manifest).
//
// Foundation ships the TYPES + a NO-OP default only, so Phase 1 can wire the
// trigger call sites without waiting for Phase 3, which replaces the no-op
// with the real SQLite snapshot implementation.
// ============================================================================

/** The events that trigger an automatic snapshot backup (N9). */
export const BACKUP_TRIGGERS = ["publish", "db-reset", "migrate"] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

/** One backup manifest record (written next to the snapshot, N9). */
export interface BackupRecord {
	projectName: string;
	/** Backup/velpari/<project>/index-<UTC>-<sha>.db */
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
 * Create one snapshot backup. NO-OP default (returns null) until Phase 3
 * installs the real implementation — callers must treat null as "backup
 * subsystem not yet installed" and continue (never block a publish on it).
 */
export function createBackupSnapshot(_params: {
	cwd: string;
	projectName: string;
	trigger: BackupTrigger;
	dbPath: string;
}): BackupRecord | null {
	return null;
}
