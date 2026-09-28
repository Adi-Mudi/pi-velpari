// ============================================================================
// ops/git-hooks.ts — commit-msg store guard (Layer 1, Phase B, G5/N21 L3)
// ============================================================================
// Decision record: .IDE_Plans/velpari-upgrade-phase-b-locking_plan_20260928_0806_v1.0.md
//   G5    — "nothing blocks `git commit` of `Doc/store/**` from outside the
//         publish chain" → this hook is the L3 answer. Pattern of
//         ops/git-attributes.ts: idempotent, never destroys user content,
//         never throws (errors land in the result).
//   D13/D14 — install rules: not-a-git-repo → skipped; a FOREIGN hook (no
//         marker) is NEVER overwritten; our hook is rewritten only when the
//         content differs; recovery path: legitimate manual/backfill/recovery
//         store commits use a `velpari(...)` commit-message marker.
//   D13a (user-confirmed 2026-09-28, detect+warn) — the EFFECTIVE hooks
//         directory follows core.hooksPath (local overrides global): an
//         in-repo value gets our hook (safe); an OUTSIDE value (e.g. a global
//         ~/.git-hooks) is NEVER written to — the result carries a `skipped`
//         note so the gate/doctor surfaces "store guard not active" instead of
//         silently installing a hook git will ignore.
//   D13b (user-confirmed 2026-09-28) — the guard lives in `commit-msg`, NOT
//         `pre-commit`: with `git commit -m` the message file does not exist
//         yet at pre-commit time and no message env var is exported (verified
//         empirically), so a pre-commit message check would reject every -m
//         commit — including the publish chain's own. commit-msg receives the
//         message as $1 (verified) and aborts identically.
// Hygiene: the script avoids backticks and ${...} (e2e-convention rule).
// ============================================================================

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, resolve, sep } from "node:path";

/** Repo-relative hook path we manage (D13b: the commit-message gate). */
export const HOOK_RELATIVE_PATH = ".git/hooks/commit-msg";

/** Marker line proving the hook is ours (D13 foreign-hook rule). */
export const HOOK_MARKER = "# Added by pi-velpari (store protection) — do not edit";

/** Commit-message prefix that whitelists a manual store commit (D14). */
export const VELPARI_COMMIT_PREFIX = "velpari(";

/**
 * The POSIX-sh commit-msg hook: reject commits that stage `Doc/store/**`
 * unless the commit message (first line of "$1") starts with `velpari(`
 * (the publish chain's own marker — D13b: commit-msg is the only hook that
 * reliably sees the message).
 * @returns {string} Hook script (no trailing newline).
 */
export function preCommitHookScript(): string {
	return [
		"#!/bin/sh",
		HOOK_MARKER,
		"# Phase B (N19/N21 L3): store changes must come from the velpari publish",
		"# flow. Recovery exception: commit with a message starting 'velpari('",
		"# (e.g. velpari(recover): <why>) — see the rejection text.",
		"set -e",
		"if git diff --cached --name-only -- Doc/store/ | grep -q .; then",
		'  first_line=$(head -n 1 "$1" 2>/dev/null || true)',
		'  case "$first_line" in',
		"    velpari\\(*)",
		"      ;;",
		"    *)",
		'      echo "velpari: refusing to commit Doc/store/** outside the velpari publish flow." >&2',
		'      echo "Store rows are written by the velpari commands (publish, backfill, reconfirm, export, migrate)." >&2',
		'      echo "Legitimate manual/recovery store commit: use a commit message starting with velpari( (e.g. velpari(recover): <why>)." >&2',
		"      exit 1",
		"      ;;",
		"  esac",
		"fi",
	].join("\n");
}

/** Result of one ensurePreCommitHook call (never throws). */
export interface EnsureHookResult {
	/** true when the hook file was created or rewritten. */
	changed: boolean;
	/** Absolute path of the hook we manage (even on failure/skip). */
	path: string;
	/** Why nothing was written (mutually exclusive with changed:true). */
	skipped?: string;
	/** fs failure message (never thrown). */
	error?: string;
}

/** Where git will actually look for hooks, honoring core.hooksPath (D13a). */
interface ResolvedHooksDir {
	/** Absolute hooks directory to write into (default <cwd>/.git/hooks). */
	dir: string;
	/** true when the configured dir lies OUTSIDE the project (never write). */
	external: boolean;
	/** The configured value when core.hooksPath is set. */
	configured?: string;
}

/**
 * Resolve the hooks directory git will ACTUALLY use. `core.hooksPath` may
 * point anywhere (local config overrides global); a relative value resolves
 * against the project root.
 * @param {string} cwd - Project root.
 * @returns {ResolvedHooksDir} Effective dir + whether it is outside the project.
 */
function resolveHooksDir(cwd: string): ResolvedHooksDir {
	const root = resolve(cwd);
	let configured: string | undefined;
	try {
		const out = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" }).trim();
		if (out.length > 0) configured = out;
	} catch {
		configured = undefined; // unset (git exits 1) or no git — default .git/hooks
	}
	if (configured === undefined) return { dir: join(root, ".git", "hooks"), external: false };
	const abs = isAbsolute(configured) ? configured : resolve(root, configured);
	const inside = abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep);
	return inside ? { dir: abs, external: false, configured } : { dir: abs, external: true, configured };
}

/**
 * Idempotent ensure (D13/D14): install our commit-msg guard into the
 * EFFECTIVE hooks dir of <cwd>.
 * - no `.git` → `{changed:false, skipped:"not a git repository"}`
 * - `core.hooksPath` outside the project (global redirect) → `skipped`
 *   warning text, NEVER written outside the project boundary (D13a)
 * - hook absent → write script + chmod 0755 → `{changed:true}`
 * - our hook (marker present) → rewrite only when the content differs
 * - FOREIGN hook (marker absent) → never overwritten → `skipped`
 * - any fs error → `error` in the result; never throws.
 * @param {string} cwd - Project root.
 * @returns {EnsureHookResult} What happened (see interface).
 */
export function ensurePreCommitHook(cwd: string): EnsureHookResult {
	const fallbackPath = join(cwd, HOOK_RELATIVE_PATH);
	try {
		if (!existsSync(join(cwd, ".git"))) {
			return { changed: false, path: fallbackPath, skipped: "not a git repository" };
		}
		const hooks = resolveHooksDir(cwd);
		const path = join(hooks.dir, "commit-msg");
		if (hooks.external) {
			return {
				changed: false,
				path,
				skipped:
					`core.hooksPath points outside the project (${hooks.configured}) — the velpari store guard ` +
					"is not active here; unset it (git config --unset-all core.hooksPath) or set it to .git/hooks",
			};
		}
		const script = preCommitHookScript();
		const fileContent = `${script}\n`; // canonical on-disk form
		if (existsSync(path)) {
			const existing = readFileSync(path, "utf8");
			if (!existing.includes(HOOK_MARKER)) {
				return { changed: false, path, skipped: "existing commit-msg hook left untouched" };
			}
			if (existing === fileContent) {
				// Ours already: keep the executable bit honest (idempotent).
				if ((statSync(path).mode & 0o111) === 0) chmodSync(path, 0o755);
				return { changed: false, path, skipped: "hook already installed" };
			}
			writeFileSync(path, fileContent, "utf8");
			chmodSync(path, 0o755);
			return { changed: true, path };
		}
		mkdirSync(hooks.dir, { recursive: true });
		writeFileSync(path, fileContent, "utf8");
		chmodSync(path, 0o755);
		return { changed: true, path };
	} catch (err) {
		return { changed: false, path: fallbackPath, error: err instanceof Error ? err.message : String(err) };
	}
}
