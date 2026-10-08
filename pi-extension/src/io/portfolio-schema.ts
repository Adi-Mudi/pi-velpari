// ============================================================================
// io/portfolio-schema.ts — the portfolio REGISTRY schema (Layer 0, Phase 10)
// ============================================================================
// Decision record §15.5 (Phase 10 amendment — portfolio registry):
//   D6    — hub-and-spoke: per-project index.db (the spokes) + ONE optional
//           central registry (the hub) at Doc/store/portfolio.db (user-locked
//           home, git-committed raw per D2/D7).
//   Q5    — one DB per projectName; the silo isolates; cross-project
//           visibility goes through THIS registry — METADATA ONLY
//           (user-locked narrowing: no artifact rollups, additive later).
//
// Deliberately SEPARATE from io/db-schema.ts (review v1.1 gap 5): the store's
// schema pins (user_version 3, EXPECTED_TABLES in test/db-store/schema.test.ts)
// must never see registry tables, and the registry carries its OWN version
// ceiling + pin test. Integrity check consciously skipped — the registry is
// fully rebuildable from the spokes via /velpari-portfolio --repair.
// ============================================================================

/**
 * Registry DDL v001-p — STRICT per RES-2, metadata-only (user-locked).
 * One row per known project spoke; columns:
 *   project_name      — PK; the Doc/store/<name>/ dir name (silo key).
 *   display_name      — human label (files.json projectName; dir-name fallback).
 *   db_path           — repo-relative path of the spoke DB (drift-detectable).
 *   last_published_at — newest published envelope's generated_at (spoke-derived).
 *   last_run_id       — run id of that newest publish.
 *   last_stage        — stage string of that newest publish.
 */
export const PORTFOLIO_SCHEMA_V001_DDL = `
CREATE TABLE IF NOT EXISTS projects (
	project_name TEXT PRIMARY KEY,
	display_name TEXT,
	db_path TEXT NOT NULL,
	last_published_at TEXT,
	last_run_id TEXT,
	last_stage TEXT
) STRICT;
`;

/** Highest registry schema version known to this build (G3 ceiling). */
export const PORTFOLIO_USER_VERSION = 1;
