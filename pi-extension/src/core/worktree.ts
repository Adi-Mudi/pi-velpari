/**
 * core/worktree.ts — git worktree / branch probing (Layer 0; Phase 5, N5/N6/N14).
 *
 * One deterministic, dependency-free probe for the whole worktree-enforcement
 * feature: "which worktree am I in, on which branch, and what else is checked
 * out?" Everything runs through `spawnSync("git", …)` and is FAIL-SOFT — a
 * missing git binary, a non-repo folder or a broken ref yields the empty
 * `{ isGit: false }` shape instead of a throw (R4: the enforcement gates must
 * never wedge a non-git project).
 *
 * Why the options bag: `before_agent_start` fires on every turn, so the hook
 * uses the light probe (`skipWorktrees` + `skipUpstream`). The full probe
 * (worktree list + upstream counts) is for `/velpari-status`, the stage gate
 * and publish.
 *
 * Read-only by construction: no fs writes, no git mutation, no network
 * (`git fetch` is only ever *advised* — F24: Velpari never pushes or pulls).
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { slugify } from "./paths.js";

/** One entry of `git worktree list --porcelain`. */
export interface WorktreeEntry {
	/** Absolute path of the worktree folder. */
	path: string;
	/** Branch name (short), or null when the entry is detached. */
	branch: string | null;
	/** HEAD commit of that worktree, or null when unknown. */
	head: string | null;
	/** true when the worktree has a detached HEAD. */
	detached: boolean;
}

/** Full picture of the current folder's git state. */
export interface GitWorktreeInfo {
	/** `git rev-parse --is-inside-work-tree === "true"`. */
	isGit: boolean;
	/** Absolute toplevel path ("" when not a repo). */
	worktree: string;
	/** Current branch ("" when not a repo, "HEAD" when detached). */
	branch: string;
	/** Current HEAD commit (null when unknown). */
	head: string | null;
	/** true when HEAD is detached (`branch === "HEAD"`). */
	detached: boolean;
	/** Upstream ref of the current branch (`origin/main`), null when none. */
	upstream: string | null;
	/** Commits the upstream has that we do not (N14 advise). */
	behind: number;
	/** Commits we have that the upstream does not. */
	ahead: number;
	/** Every worktree of this repository ([] with `skipWorktrees`). */
	worktrees: WorktreeEntry[];
}

/** Cost controls — the cheap paths used by the per-turn hook. */
export interface DetectWorktreeOptions {
	/** Skip `git worktree list --porcelain` (the most expensive probe). */
	skipWorktrees?: boolean;
	/** Skip the upstream / ahead / behind probes. */
	skipUpstream?: boolean;
}

/** The shape returned for every non-repo or git-failure case. */
const NOT_GIT: GitWorktreeInfo = {
	isGit: false,
	worktree: "",
	branch: "",
	head: null,
	detached: false,
	upstream: null,
	behind: 0,
	ahead: 0,
	worktrees: [],
};

/**
 * Run one git command, returning trimmed stdout or null on any failure.
 * Lock-free (`GIT_OPTIONAL_LOCKS=0`) so a probe never writes a git lock file,
 * and stdin is closed so git can never block waiting for input.
 * @param {string} cwd - Folder to run in (the project root).
 * @param {string[]} args - Git arguments (no shell involved).
 * @returns {string | null} Trimmed stdout, or null when git failed.
 */
function gitIn(cwd: string, args: readonly string[]): string | null {
	try {
		const res = spawnSync("git", args as string[], {
			cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 5_000,
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		});
		if (res.error || res.status !== 0) return null;
		return (res.stdout ?? "").trim();
	} catch {
		return null;
	}
}

/** Parse `git worktree list --porcelain` output into entries. */
function parseWorktreeList(raw: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	let current: { path?: string; branch: string | null; head: string | null; detached: boolean } | null = null;
	const flush = () => {
		if (current?.path) {
			entries.push({
				path: current.path,
				branch: current.branch ?? null,
				head: current.head ?? null,
				detached: current.detached,
			});
		}
		current = null;
	};
	for (const line of raw.split(/\r?\n/)) {
		if (line.trim() === "") {
			flush();
			continue;
		}
		current ??= { branch: null, head: null, detached: false };
		if (line.startsWith("worktree ")) current.path = line.slice("worktree ".length).trim();
		else if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length).trim();
		else if (line.startsWith("branch "))
			current.branch = line
				.slice("branch ".length)
				.trim()
				.replace(/^refs\/heads\//, "");
		else if (line.trim() === "detached") current.detached = true;
	}
	flush();
	return entries;
}

/**
 * Every worktree of the repository containing `cwd` ([] when not a repo).
 * @param {string} cwd - Folder inside the repository.
 * @returns {WorktreeEntry[]} Entries in git's own order (main worktree first).
 */
export function listWorktrees(cwd: string): WorktreeEntry[] {
	const raw = gitIn(cwd, ["worktree", "list", "--porcelain"]);
	return raw === null ? [] : parseWorktreeList(raw);
}

/**
 * Probe the current folder's git state. Never throws (R4 fail-open).
 * @param {string} cwd - Project root.
 * @param {DetectWorktreeOptions} [opts] - Cost controls for per-turn callers.
 * @returns {GitWorktreeInfo} The probe result (NOT_GIT shape when not a repo).
 */
export function detectWorktree(cwd: string, opts?: DetectWorktreeOptions): GitWorktreeInfo {
	const inside = gitIn(cwd, ["rev-parse", "--is-inside-work-tree"]);
	if (inside !== "true") return { ...NOT_GIT };

	const worktree = gitIn(cwd, ["rev-parse", "--show-toplevel"]) ?? "";
	const branch = gitIn(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "";
	const head = gitIn(cwd, ["rev-parse", "HEAD"]);
	const rawUpstream = opts?.skipUpstream ? null : gitIn(cwd, ["rev-parse", "--abbrev-ref", "@{u}"]);
	// `@{u}` echoes back verbatim when the branch has no upstream — treat as none.
	const upstream = rawUpstream !== null && rawUpstream !== "@{u}" ? rawUpstream : null;
	let behind = 0;
	let ahead = 0;
	if (upstream) {
		behind = Number.parseInt(gitIn(cwd, ["rev-list", "--count", `HEAD..${upstream}`]) ?? "0", 10) || 0;
		ahead = Number.parseInt(gitIn(cwd, ["rev-list", "--count", `${upstream}..HEAD`]) ?? "0", 10) || 0;
	}
	return {
		isGit: true,
		worktree,
		branch,
		head,
		detached: branch === "HEAD",
		upstream,
		behind,
		ahead,
		worktrees: opts?.skipWorktrees ? [] : parseWorktreeList(gitIn(cwd, ["worktree", "list", "--porcelain"]) ?? ""),
	};
}

/** realpath when possible, the input otherwise (paths may not exist yet). */
export function realpathOrSelf(input: string): string {
	try {
		return realpathSync(input);
	} catch {
		return input;
	}
}

/** Path equality that tolerates symlinks and trailing separators. */
export function samePaths(a: string, b: string): boolean {
	if (a === "" || b === "") return false;
	return realpathOrSelf(a) === realpathOrSelf(b);
}

/**
 * A worktree OTHER than `info.worktree` that has `branch` checked out, or null.
 * Git forbids one branch in two worktrees, so a hit means the run's branch has
 * been re-homed into a different folder (§3.13 A.5).
 * @param {GitWorktreeInfo} info - Result of a probe that included `worktrees`.
 * @param {string} branch - Branch name to look for.
 * @returns {string | null} The other folder's path, or null.
 */
export function branchCheckedOutAt(info: GitWorktreeInfo, branch: string): string | null {
	for (const entry of info.worktrees) {
		if (entry.branch === branch && !samePaths(entry.path, info.worktree)) return entry.path;
	}
	return null;
}

/**
 * The commit that last touched `relPath` on the current branch (R5's "commit"
 * in the upstream-moved notice) — no schema change needed. Falls back to
 * "(uncommitted)" when the path has local changes and no commit yet, and to
 * null when git cannot answer at all.
 * @param {string} cwd - Project root.
 * @param {string} relPath - Root-relative path (e.g. the store DB).
 * @returns {string | null} Short commit sha, "(uncommitted)", or null.
 */
export function lastCommitForPath(cwd: string, relPath: string): string | null {
	if (relPath.trim() === "") return null;
	const sha = gitIn(cwd, ["log", "-1", "--format=%h", "--", relPath]);
	if (sha !== null && sha !== "") return sha;
	const dirty = gitIn(cwd, ["status", "--porcelain", "--", relPath]);
	return dirty !== null && dirty !== "" ? "(uncommitted)" : null;
}

/**
 * The exact self-healing fix printed in every N5 block message.
 * @param {string} label - Run id or project name to derive the folder from.
 * @param {string} [base] - Optional base branch to fork the new worktree from.
 * @returns {string} e.g. `git worktree add ../<slug> -b velpari/<slug>`.
 */
export function worktreeAddHint(label: string, base?: string): string {
	const slug = slugify(label); // slugify's own convention ("untitled" for an empty label)
	return `git worktree add ../${slug} -b velpari/${slug}${base ? ` ${base}` : ""}`;
}
