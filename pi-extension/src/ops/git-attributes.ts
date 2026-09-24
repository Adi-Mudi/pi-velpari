// ============================================================================
// ops/git-attributes.ts — user-repo git integration (Layer 1, Phase 9 1.1)
// ============================================================================
// Decision record §15.4 (Phase 9 amendment — git integration). G2a must
// hold in EVERY user repo, not just this one: the store DB is committed
// raw, so the repo needs (a) `binary` for Doc/store/**/index.db (merge
// prevention — the `binary` macro implies -diff -merge -text) and
// (b) .gitignore entries for the -wal/-shm sidecar files (they are
// checkpointed away pre-commit and must never be committed).
//
// ensureStoreGitIntegration is called by the DB publish chain (db-publish
// step 7 preamble). Behavior contract (plan review v1.2 nit 6): the heal
// is AUTOMATIC (no question, no approval) but NEVER silent — the caller
// reports what was appended, and the changed files JOIN the publish
// commit's addPaths so the heal lands in the same publish commit.
//
// Append-only with exact-pattern detection: never rewrites or reorders
// existing lines; idempotent on every later publish (second call with the
// same repo appends nothing).
// ============================================================================

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The gitattributes pattern marking the store DB as binary (merge-proof). */
export const STORE_DB_ATTR_LINE = "Doc/store/**/index.db binary";

/** .gitignore patterns for the WAL sidecar files (G1 — never committed). */
export const STORE_IGNORE_LINES: readonly string[] = ["Doc/store/**/index.db-wal", "Doc/store/**/index.db-shm"];

/**
 * The gitattributes pattern marking the portfolio REGISTRY as binary
 * (Phase 10 — a second SQLite file with the exact G2 merge hazard).
 */
export const PORTFOLIO_ATTR_LINE = "Doc/store/portfolio.db binary";

/** .gitignore patterns for the REGISTRY's WAL sidecar files (registry G1). */
export const PORTFOLIO_IGNORE_LINES: readonly string[] = ["Doc/store/portfolio.db-wal", "Doc/store/portfolio.db-shm"];

/** Result of one ensureStoreGitIntegration call. */
export interface GitIntegrationResult {
	/** true when at least one line was appended to at least one file. */
	changed: boolean;
	/** Human-readable description of every appended line (empty = nothing changed). */
	appended: string[];
	/** Absolute paths of the files that were changed (caller adds them to the publish commit). */
	changedPaths: string[];
}

/**
 * Does `content` already carry `line`? Exact-pattern check per line — a
 * commented-out or differently-spelled variant does NOT count (the real
 * pattern must be present verbatim).
 * @param {string} content - Full file content ("" when the file is absent).
 * @param {string} line - The exact line to look for (trimmed comparison).
 * @returns {boolean} true when the line is already present.
 */
function hasLine(content: string, line: string): boolean {
	const lines = content.split(/\r?\n/).map((l) => l.trim());
	return lines.includes(line);
}

/**
 * Append missing lines to a git config file, creating it when absent.
 * Append-only: existing content (including its trailing-newline state) is
 * preserved; new lines are separated by a blank line when the file does
 * not already end with one.
 * @param {string} path - Absolute path of .gitattributes / .gitignore.
 * @param {string[]} additions - Lines to append (already filtered for absence).
 * @returns {string} The lines actually appended ("" when none).
 */
function appendLines(path: string, additions: string[]): string {
	if (additions.length === 0) return "";
	let existing = "";
	if (existsSync(path)) {
		existing = readFileSync(path, "utf8");
	}
	const needsSeparator = existing.length > 0 && !existing.endsWith("\n\n");
	const prefix =
		existing.length === 0
			? ""
			: needsSeparator
				? `${existing.endsWith("\n") ? existing : existing + "\n"}\n`
				: existing;
	const block = `${prefix}# Added by pi-velpari (DB-primary storage) — do not edit\n${additions.join("\n")}\n`;
	writeFileSync(path, block, "utf8");
	return additions.join(", ");
}

/**
 * Ensure the USER repo's .gitattributes/.gitignore carry the store-DB
 * protections. Idempotent + append-only (plan risk R5). File errors are
 * returned as a `changed:false` result with the error in `appended` —
 * never thrown (a git-integration heal failure must not fail the publish;
 * the doctor's git-integration check makes the gap visible instead).
 *
 * @param {string} cwd - Project root (the user's git work tree).
 * @returns {GitIntegrationResult} What was appended (usually nothing).
 */
export function ensureStoreGitIntegration(cwd: string): GitIntegrationResult {
	const attrPath = join(cwd, ".gitattributes");
	const ignorePath = join(cwd, ".gitignore");
	const appended: string[] = [];
	const changedPaths: string[] = [];
	try {
		const attrContent = existsSync(attrPath) ? readFileSync(attrPath, "utf8") : "";
		const missingAttrs = [STORE_DB_ATTR_LINE, PORTFOLIO_ATTR_LINE].filter((line) => !hasLine(attrContent, line));
		if (missingAttrs.length > 0) {
			const added = appendLines(attrPath, missingAttrs);
			if (added) {
				appended.push(`.gitattributes: ${added}`);
				changedPaths.push(attrPath);
			}
		}
		const ignoreContent = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
		const missingIgnores = [...STORE_IGNORE_LINES, ...PORTFOLIO_IGNORE_LINES].filter(
			(line) => !hasLine(ignoreContent, line),
		);
		if (missingIgnores.length > 0) {
			const added = appendLines(ignorePath, missingIgnores);
			if (added) {
				appended.push(`.gitignore: ${added}`);
				changedPaths.push(ignorePath);
			}
		}
	} catch (err) {
		appended.push(
			`heal failed (publish continues; run /velpari-doctor for the fix): ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	return { changed: appended.length > 0 && changedPaths.length > 0, appended, changedPaths };
}
