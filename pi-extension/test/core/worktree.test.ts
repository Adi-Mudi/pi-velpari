// Tests — core/worktree.ts (Phase 5, N5/N6/N14).
// Real git fixtures built in temp dirs (repo precedent:
// test/ops/git-attributes.test.ts). Covers: non-repo fail-open, branch / HEAD /
// toplevel detection, a second worktree + branchCheckedOutAt, detached HEAD,
// behind/ahead counts against a bare origin, lastCommitForPath
// (committed / uncommitted / missing), worktreeAddHint text, and the light
// probe the per-turn hook uses (no worktree list, no upstream probes).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import {
	branchCheckedOutAt,
	detectWorktree,
	lastCommitForPath,
	listWorktrees,
	worktreeAddHint,
} from "../../src/core/worktree.js";

/** Commit identity for fixtures — never touches global git config. */
const IDENT = ["-c", "user.email=velpari@test.local", "-c", "user.name=Velpari Test"];

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** A real repo with one commit on `branch`. */
function initRepo(dir: string, branch = "main"): void {
	git(dir, "init", "-b", branch);
	writeFileSync(join(dir, "README.md"), "# fixture\n", "utf8");
	git(dir, "add", "-A");
	git(dir, ...IDENT, "commit", "-m", "init");
}

let dirs: string[] = [];

function freshDir(prefix = "velpari-wt-", parent?: string): string {
	const dir = mkdtempSync(join(parent ?? tmpdir(), `${prefix}`));
	dirs.push(dir);
	return dir;
}

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("detectWorktree — basic probing", () => {
	let root: string;
	beforeEach(() => {
		root = freshDir();
	});

	test("non-repo folder fails open (no throw, NOT_GIT shape)", () => {
		const info = detectWorktree(root);
		assert.equal(info.isGit, false);
		assert.equal(info.worktree, "");
		assert.equal(info.branch, "");
		assert.equal(info.head, null);
		assert.equal(info.detached, false);
		assert.equal(info.upstream, null);
		assert.deepEqual(info.worktrees, []);
	});

	test("repo folder → branch, HEAD and toplevel", () => {
		initRepo(root, "main");
		const info = detectWorktree(root);
		assert.equal(info.isGit, true);
		assert.equal(info.worktree, realpathSync(root));
		assert.equal(info.branch, "main");
		assert.equal(info.head, git(root, "rev-parse", "HEAD").trim());
		assert.equal(info.detached, false);
		assert.equal(info.upstream, null); // no remote configured
		assert.equal(info.behind, 0);
	});

	test("a sub-folder resolves to the same worktree + branch", () => {
		initRepo(root, "velpari/line-A");
		const sub = join(root, "nested", "deeper");
		mkdirSync(sub, { recursive: true });
		const info = detectWorktree(sub);
		assert.equal(info.worktree, realpathSync(root));
		assert.equal(info.branch, "velpari/line-A");
	});

	test('detached HEAD → branch "HEAD" and detached: true', () => {
		initRepo(root);
		git(root, "checkout", "--detach");
		const info = detectWorktree(root);
		assert.equal(info.detached, true);
		assert.equal(info.branch, "HEAD");
		assert.ok(info.head);
	});

	test("light probe (per-turn hook) skips worktree list + upstream", () => {
		initRepo(root);
		const info = detectWorktree(root, { skipWorktrees: true, skipUpstream: true });
		assert.equal(info.isGit, true);
		assert.equal(info.branch, "main");
		assert.equal(info.worktree, realpathSync(root));
		assert.deepEqual(info.worktrees, []);
		assert.equal(info.upstream, null);
		assert.equal(info.behind, 0);
	});
});

describe("worktrees + branchCheckedOutAt (§3.13 A)", () => {
	let root: string;
	let second: string;

	beforeEach(() => {
		root = freshDir();
		initRepo(root, "main");
		second = join(freshDir(), "line-b");
		git(root, "worktree", "add", second, "-b", "velpari/line-B");
	});

	test("listWorktrees reports both worktrees with their branches", () => {
		const entries = listWorktrees(root);
		assert.equal(entries.length, 2);
		const branches = entries.map((e) => e.branch).sort();
		assert.deepEqual(branches, ["main", "velpari/line-B"]);
		assert.ok(entries.some((e) => realpathSync(e.path) === realpathSync(second)));
	});

	test("branchCheckedOutAt finds the OTHER folder, null for ours / nowhere", () => {
		const infoFromMain = detectWorktree(root);
		assert.equal(realpathSync(branchCheckedOutAt(infoFromMain, "velpari/line-B")!), realpathSync(second));
		assert.equal(branchCheckedOutAt(infoFromMain, "main"), null); // ours, not another folder
		assert.equal(branchCheckedOutAt(infoFromMain, "velpari/nope"), null);

		const infoFromSecond = detectWorktree(second);
		assert.equal(realpathSync(branchCheckedOutAt(infoFromSecond, "main")!), realpathSync(root));
	});
});

describe("lastCommitForPath (R5 — the notice's commit)", () => {
	let root: string;
	beforeEach(() => {
		root = freshDir();
		initRepo(root);
	});

	test('committed → short sha; uncommitted-only → "(uncommitted)"; unknown → null', () => {
		const sha = lastCommitForPath(root, "README.md");
		assert.match(sha!, /^[0-9a-f]{7,}$/);

		writeFileSync(join(root, "fresh.txt"), "never committed\n", "utf8");
		assert.equal(lastCommitForPath(root, "fresh.txt"), "(uncommitted)");

		assert.equal(lastCommitForPath(root, "does/not/exist.db"), null);
		assert.equal(lastCommitForPath(root, "  "), null);
	});
});

describe("behind / ahead against a bare origin (N14 advise)", () => {
	let root: string;
	let cloneA: string;

	beforeEach(() => {
		root = freshDir("velpari-wt-remote-");
		const bare = join(root, "origin.git");
		mkdirSync(bare);
		// Branch name "trunk" on purpose: some machines carry a global pre-push
		// hook that refuses pushes to main/master — the fixture must not depend
		// on that being absent (CI has none; a dev machine may).
		git(bare, "init", "--bare", "-b", "trunk");

		const seed = join(root, "seed");
		mkdirSync(seed);
		initRepo(seed, "trunk");
		git(seed, "remote", "add", "origin", bare);
		git(seed, "push", "-u", "origin", "trunk");

		cloneA = join(root, "a");
		const cloneB = join(root, "b");
		git(root, "clone", bare, cloneA);
		git(root, "clone", bare, cloneB);

		writeFileSync(join(cloneB, "second.txt"), "x\n", "utf8");
		git(cloneB, "add", "-A");
		git(cloneB, ...IDENT, "commit", "-m", "second");
		git(cloneB, "push", "origin", "trunk");
		git(cloneA, "fetch", "origin"); // the test fetches; Velpari itself never does (F24)
	});

	test("a behind branch reports upstream + behind count", () => {
		const info = detectWorktree(cloneA);
		assert.equal(info.upstream, "origin/trunk");
		assert.equal(info.behind, 1);
		assert.equal(info.ahead, 0);
	});

	test("no upstream configured → null upstream, zero counts", () => {
		git(cloneA, "checkout", "-b", "local-only");
		const info = detectWorktree(cloneA);
		assert.equal(info.upstream, null);
		assert.equal(info.behind, 0);
		assert.equal(info.ahead, 0);
	});
});

describe("worktreeAddHint (the N5 self-healing fix)", () => {
	test("builds the exact git worktree add command from a run id", () => {
		const hint = worktreeAddHint("2026-09-27T09-27-abcd");
		assert.match(hint, /^git worktree add \.\.\/2026-09-27t09-27-abcd -b velpari\/2026-09-27t09-27-abcd$/);
	});

	test("optional base branch is appended; empty label falls back to slugify's \"untitled\"", () => {
		assert.match(worktreeAddHint("alpha", "main"), /-b velpari\/alpha main$/);
		assert.match(worktreeAddHint(""), /-b velpari\/untitled$/);
	});
});

