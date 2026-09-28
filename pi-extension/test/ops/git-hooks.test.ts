// Integration tests — ops/git-hooks.ts (Phase B, G5/D13/D13a/N21 L3).
// Real `git init` fixtures (pattern of test/ops/git-attributes.test.ts):
// the hook must actually reject a staged Doc/store/** commit (exit 1 + our
// message), allow the velpari( marker and non-store commits, install
// idempotently, never touch a foreign hook, skip non-git dirs, be executable,
// and honor core.hooksPath (in-repo custom dir vs outside-project redirect).
// Fixture hygiene: every repo sets a LOCAL core.hooksPath (.git/hooks) so the
// hook under test runs even on machines with a global hooksPath (D13a).
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ensurePreCommitHook,
	preCommitHookScript,
	HOOK_MARKER,
	VELPARI_COMMIT_PREFIX,
} from "../../src/ops/git-hooks.js";

let dirs: string[] = [];

beforeEach(() => {
	dirs.push(mkdtempSync(join(tmpdir(), "velpari-git-hooks-")));
});

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Current fixture dir (last created by beforeEach). */
function cwd(): string {
	return dirs[dirs.length - 1]!;
}

/**
 * Initialize a git repo in the fixture with a local identity and a
 * repo-local core.hooksPath so hook execution is hermetic (D13a).
 * @param {string} dir - Fixture directory (becomes the repo root).
 */
function initRepo(dir: string): void {
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
	execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
	execFileSync("git", ["config", "core.hooksPath", ".git/hooks"], { cwd: dir });
}

/**
 * Stage paths and attempt a commit; never throws (hook rejections exit 1).
 * @param {string} dir - Repo root.
 * @param {string} message - Commit message.
 * @param {string[]} paths - Paths to stage (also passed to commit --).
 * @returns {{ status: number | null; output: string }} Exit status + combined output.
 */
function tryCommit(dir: string, message: string, paths: string[]): { status: number | null; output: string } {
	execFileSync("git", ["add", "--", ...paths], { cwd: dir });
	const res = spawnSync("git", ["commit", "-m", message, "--", ...paths], { cwd: dir, encoding: "utf-8" });
	return { status: res.status, output: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

/** Create a fake store file inside the repo and return its repo-relative path. */
function stageStoreFile(dir: string): string {
	const rel = join("Doc", "store", "p1", "index.db");
	mkdirSync(join(dir, "Doc", "store", "p1"), { recursive: true });
	writeFileSync(join(dir, rel), "sqlite-fake", "utf8");
	return rel;
}

describe("ops/git-hooks — ensurePreCommitHook + hook behavior", () => {
	test("(a) staged Doc/store/** + plain message → rejected (exit 1) with our message", () => {
		const dir = cwd();
		initRepo(dir);
		assert.equal(ensurePreCommitHook(dir).changed, true, "hook installed");
		const rel = stageStoreFile(dir);
		const res = tryCommit(dir, "manual edit", [rel]);
		assert.equal(res.status, 1, "the store commit is rejected");
		assert.match(res.output, /refusing to commit Doc\/store\/\*\* outside the velpari publish flow/);
		assert.match(res.output, /velpari\(recover\)/, "recovery instruction names the marker path (D14)");
	});

	test("(b) same staging + velpari( message → allowed", () => {
		const dir = cwd();
		initRepo(dir);
		ensurePreCommitHook(dir);
		const rel = stageStoreFile(dir);
		const res = tryCommit(dir, `${VELPARI_COMMIT_PREFIX}PRD): p v2 (run r)`, [rel]);
		assert.equal(res.status, 0, `publish-flow commit must pass: ${res.output}`);
	});

	test("(c) non-store commit with any message → allowed", () => {
		const dir = cwd();
		initRepo(dir);
		ensurePreCommitHook(dir);
		writeFileSync(join(dir, "README.md"), "hello\n", "utf8");
		const res = tryCommit(dir, "docs: whatever", ["README.md"]);
		assert.equal(res.status, 0, `ordinary commit must pass: ${res.output}`);
	});

	test("(d) idempotent install: second call changed:false, content byte-stable", () => {
		const dir = cwd();
		initRepo(dir);
		const first = ensurePreCommitHook(dir);
		assert.equal(first.changed, true);
		const before = readFileSync(first.path, "utf8");
		const second = ensurePreCommitHook(dir);
		assert.equal(second.changed, false);
		assert.ok(second.skipped !== undefined, "result says why nothing changed");
		assert.equal(readFileSync(first.path, "utf8"), before, "content byte-stable");
	});

	test("(e) foreign commit-msg (no marker) → never overwritten", () => {
		const dir = cwd();
		initRepo(dir);
		const hookPath = join(dir, ".git", "hooks", "commit-msg");
		writeFileSync(hookPath, "#!/bin/sh\necho foreign\n", "utf8");
		const result = ensurePreCommitHook(dir);
		assert.equal(result.changed, false);
		assert.match(result.skipped ?? "", /left untouched/);
		assert.equal(readFileSync(hookPath, "utf8"), "#!/bin/sh\necho foreign\n", "foreign content intact");
	});

	test("(f) non-git dir → skipped, nothing written", () => {
		const dir = cwd(); // NOT initialized
		const result = ensurePreCommitHook(dir);
		assert.equal(result.changed, false);
		assert.match(result.skipped ?? "", /not a git repository/);
		assert.equal(existsSync(join(dir, ".git", "hooks", "commit-msg")), false);
	});

	test("(g) the installed hook is executable (0755)", () => {
		const dir = cwd();
		initRepo(dir);
		const result = ensurePreCommitHook(dir);
		const mode = statSync(result.path).mode;
		assert.ok((mode & 0o111) !== 0, `hook must be executable (mode ${mode.toString(8)})`);
	});

	test("(h) D13a: core.hooksPath OUTSIDE the project → skipped warning, no external write", () => {
		const dir = cwd();
		initRepo(dir);
		const external = mkdtempSync(join(tmpdir(), "velpari-external-hooks-"));
		try {
			execFileSync("git", ["config", "core.hooksPath", external], { cwd: dir });
			const result = ensurePreCommitHook(dir);
			assert.equal(result.changed, false);
			assert.match(result.skipped ?? "", /points outside the project/);
			assert.match(result.skipped ?? "", /not active/);
			assert.equal(existsSync(join(dir, ".git", "hooks", "commit-msg")), false, "nothing written in-repo");
			assert.equal(existsSync(join(external, "commit-msg")), false, "nothing written outside the project");
		} finally {
			rmSync(external, { recursive: true, force: true });
		}
	});

	test("(h2) D13a: in-repo custom hooks dir → hook installed there AND enforced", () => {
		const dir = cwd();
		initRepo(dir);
		execFileSync("git", ["config", "core.hooksPath", "githooks"], { cwd: dir });
		const result = ensurePreCommitHook(dir);
		assert.equal(result.changed, true);
		assert.ok(result.path.endsWith(join("githooks", "commit-msg")), `written to ${result.path}`);
		assert.ok(existsSync(result.path), "hook exists in the custom dir");
		const rel = stageStoreFile(dir);
		const rejected = tryCommit(dir, "manual edit", [rel]);
		assert.equal(rejected.status, 1, "git runs the hook from the custom dir (relative resolution)");
		const allowed = tryCommit(dir, `${VELPARI_COMMIT_PREFIX}recover): rebuilt rows`, [rel]);
		assert.equal(allowed.status, 0, `marker path still passes: ${allowed.output}`);
	});

	test("(i) script shape: marker + prefix constants + e2e hygiene (no backticks/`${...}`)", () => {
		const script = preCommitHookScript();
		assert.ok(script.includes(HOOK_MARKER));
		assert.ok(script.startsWith("#!/bin/sh"));
		assert.ok(script.includes(`case "$first_line" in`), "prefix match implemented in sh");
		assert.ok(script.includes('head -n 1 "$1"'), "reads the message from $1 (commit-msg gate, D13b)");
		assert.equal(script.includes("`"), false, "no backticks (e2e-convention hygiene)");
		assert.equal(script.includes("${"), false, "no ${...} (e2e-convention hygiene)");
		assert.match(script, /velpari\\\(\*/, "matches the VELPARI_COMMIT_PREFIX family");
	});
});
