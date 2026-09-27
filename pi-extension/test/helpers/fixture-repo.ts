/**
 * Shared git fixture for the Phase-6 merge-back tests (6.8.3): the bare
 * **error-clean** project shape — copy `skills/` + `package.json` + a
 * minimal `.pi/velpari/files.json` (projectName) + an empty store DB +
 * `.gitignore` WAL patterns + `git init`. Probed: `runDoctor` reports
 * 0 errors on this shape (contingency C1 in the Phase-6 plan — unlike
 * `setupFullCwd`, whose stale PSRS/frontmatter fixtures report 40).
 *
 * Lives under test/helpers/ so both `test/ops/merge-back.test.ts` and
 * `test/commands/merge-back.test.ts` (and future consumers) share one
 * recipe. TMPDIR must point at /var/tmp locally — /tmp tmpfs quota
 * breaks SQLite WAL.
 */
import { spawnSync } from "node:child_process";
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildStoreDbPath, findPackageRoot } from "../../src/core/paths.js";
import { closeStoreDb, openStoreDb } from "../../src/io/db.js";

/** Project name baked into the fixture's files.json. */
export const FIXTURE_PROJECT = "MergeApp";

const REPO_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** Run git; throws on non-zero exit. */
export function git(cwd: string, args: string[]): string {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.error) throw r.error;
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr?.trim() ?? ""}`);
	return (r.stdout ?? "").trim();
}

/** Stage everything and commit. */
export function commitAll(cwd: string, message: string): void {
	git(cwd, ["add", "-A"]);
	git(cwd, ["commit", "-q", "-m", message]);
}

/**
 * Create the error-clean fixture repo at a fresh temp dir.
 * The repo starts on `main` with one `init` commit containing `f.txt`.
 */
export function mkErrorCleanRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "velpari-fixture-repo-"));
	cpSync(join(REPO_ROOT, "skills"), join(dir, "skills"), { recursive: true });
	copyFileSync(join(REPO_ROOT, "package.json"), join(dir, "package.json"));
	mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
	writeFileSync(join(dir, ".pi", "velpari", "files.json"), JSON.stringify({ projectName: FIXTURE_PROJECT }, null, 2));
	writeFileSync(join(dir, ".gitignore"), "Doc/store/**/index.db-wal\nDoc/store/**/index.db-shm\n");
	writeFileSync(join(dir, "f.txt"), "base line\n");
	const dbPath = buildStoreDbPath(FIXTURE_PROJECT, dir);
	mkdirSync(dirname(dbPath), { recursive: true });
	const db = openStoreDb(dbPath);
	closeStoreDb(db);
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.email", "t@example.com"]);
	git(dir, ["config", "user.name", "velpari test"]);
	commitAll(dir, "init");
	return dir;
}

/**
 * Divergent history from the fixture HEAD: `feat` edits feat.txt, `main`
 * edits main.txt — a clean (conflict-free) merge-back candidate.
 */
export function divergent(dir: string): void {
	const base = git(dir, ["rev-parse", "HEAD"]);
	git(dir, ["checkout", "-q", "-b", "feat", base]);
	writeFileSync(join(dir, "feat.txt"), "feat side\n");
	commitAll(dir, "feat work");
	git(dir, ["checkout", "-q", "main"]);
	writeFileSync(join(dir, "main.txt"), "main side\n");
	commitAll(dir, "main work");
}
