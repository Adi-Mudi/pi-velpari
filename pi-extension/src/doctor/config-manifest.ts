/**
 * Config baseline manifest — Phase C (G3), Doctor v2.
 *
 * The ONE writer of `.pi/velpari/config-manifest.json` (besides git).
 * Records SHA-256 baselines for the three velpari config files so the
 * doctor can answer "did someone edit this config outside the flow?"
 * with git evidence.
 *
 * Reads are fail-open (`null` / per-file `no-baseline`), writes are
 * atomic via `io/atomic-write.ts`. `runDoctor` never calls the writer —
 * baseline creation happens only inside the confirm-gated fix flow
 * (N23: one confirm per run, never content authoring).
 *
 * Tracked files (default): `.pi/velpari/files.json`,
 * `.pi/velpari/agents.json`, `.pi/velpari/requirements-profile.json`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hashFileContent } from "../core/fingerprints.js";
import { atomicWriteFile } from "../io/atomic-write.js";

/** Manifest schema version. */
export const CONFIG_MANIFEST_VERSION = 1;

/** Relative paths recorded by default (project-root-relative). */
export const DEFAULT_TRACKED_CONFIGS: readonly string[] = [
	".pi/velpari/files.json",
	".pi/velpari/agents.json",
	".pi/velpari/requirements-profile.json",
];

/** One recorded baseline row. */
export interface BaselineEntry {
	sha256: string;
	recordedAt: string;
	gitHead: string | null;
}

/** Manifest file shape. */
export interface ConfigManifest {
	version: number;
	files: Record<string, BaselineEntry>;
}

/** Per-file diff result against the recorded baseline. */
export interface BaselineDiff {
	relPath: string;
	/** match = hash equal; drifted = changed; deleted = gone; unreadable = exists but not readable. */
	status: "match" | "drifted" | "deleted" | "unreadable";
	/** Current sha256 (null when deleted/unreadable). */
	sha256: string | null;
	/** Baseline sha256 from the manifest. */
	baselineSha256: string;
}

/**
 * Manifest path for a project root.
 * @param {string} cwd - Project root.
 * @returns {string} Absolute path of `config-manifest.json`.
 */
export function configManifestPath(cwd: string): string {
	return join(cwd, ".pi", "velpari", "config-manifest.json");
}

/**
 * Load the manifest, fail-open.
 * @param {string} cwd - Project root.
 * @returns {ConfigManifest | null} Parsed manifest, or `null` when absent/corrupt/wrong shape.
 */
export function loadConfigManifest(cwd: string): ConfigManifest | null {
	try {
		const p = configManifestPath(cwd);
		if (!existsSync(p)) return null;
		const parsed = JSON.parse(readFileSync(p, "utf8")) as Partial<ConfigManifest>;
		if (
			parsed.version !== CONFIG_MANIFEST_VERSION ||
			typeof parsed.files !== "object" ||
			parsed.files === null ||
			Array.isArray(parsed.files)
		) {
			return null;
		}
		return { version: CONFIG_MANIFEST_VERSION, files: parsed.files };
	} catch {
		return null;
	}
}

/** Run a git helper fail-soft; returns trimmed stdout or `null`. */
function gitOut(cwd: string, args: string[]): string | null {
	try {
		const r = spawnSync("git", args, { cwd, encoding: "utf8" });
		if (r.error || r.status !== 0) return null;
		return (r.stdout ?? "").trim();
	} catch {
		return null;
	}
}

/**
 * Record (or refresh) the config baseline. THE writer — called only from
 * the confirm-gated fix flow, never from `runDoctor`.
 * @param {string} cwd - Project root.
 * @param {readonly string[]} [paths] - Override the tracked set (defaults to `DEFAULT_TRACKED_CONFIGS`).
 * @returns {ConfigManifest} The manifest as written (existing rows for unlisted paths are preserved).
 */
export function recordConfigBaseline(cwd: string, paths: readonly string[] = DEFAULT_TRACKED_CONFIGS): ConfigManifest {
	const existing = loadConfigManifest(cwd) ?? { version: CONFIG_MANIFEST_VERSION, files: {} };
	const head = gitOut(cwd, ["rev-parse", "HEAD"]);
	const recordedAt = new Date().toISOString();
	for (const rel of paths) {
		const abs = join(cwd, rel);
		const sha = hashFileContent(abs);
		if (sha === null) continue; // absent config → nothing to baseline
		existing.files[rel] = { sha256: sha, recordedAt, gitHead: head };
	}
	mkdirSync(join(cwd, ".pi", "velpari"), { recursive: true });
	atomicWriteFile(configManifestPath(cwd), `${JSON.stringify(existing, null, "\t")}\n`, "utf8");
	return existing;
}

/**
 * Compare every baseline entry against the current files on disk.
 * Reads only — never writes.
 * @param {string} cwd - Project root.
 * @returns {BaselineDiff[]} One row per manifest entry (manifest absent → empty array).
 */
export function diffAgainstBaseline(cwd: string): BaselineDiff[] {
	const manifest = loadConfigManifest(cwd);
	if (manifest === null) return [];
	const out: BaselineDiff[] = [];
	for (const [relPath, entry] of Object.entries(manifest.files)) {
		const abs = join(cwd, relPath);
		if (!existsSync(abs)) {
			out.push({ relPath, status: "deleted", sha256: null, baselineSha256: entry.sha256 });
			continue;
		}
		const sha = hashFileContent(abs);
		if (sha === null) {
			out.push({ relPath, status: "unreadable", sha256: null, baselineSha256: entry.sha256 });
			continue;
		}
		out.push({
			relPath,
			status: sha === entry.sha256 ? "match" : "drifted",
			sha256: sha,
			baselineSha256: entry.sha256,
		});
	}
	return out;
}

/**
 * Restore one tracked config file from `HEAD` — only when the path is
 * git-tracked AND has a HEAD version. THE restore writer (paired with
 * the `config-restore-git` remediate fn).
 * @param {string} cwd - Project root.
 * @param {string} relPath - Project-relative config path (e.g. `.pi/velpari/files.json`).
 * @returns {{ restored: boolean; reason: string }} `restored=true` when HEAD content was written back atomically.
 */
export function restoreFromGitHead(cwd: string, relPath: string): { restored: boolean; reason: string } {
	if (relPath.includes("..")) return { restored: false, reason: "path traversal rejected" };
	// Raw blob bytes — never the trimming helper (a trimmed restore would
	// change the file's hash vs HEAD).
	let blob: string | null = null;
	try {
		const r = spawnSync("git", ["show", `HEAD:${relPath}`], { cwd, encoding: "utf8" });
		if (!r.error && r.status === 0) blob = r.stdout ?? "";
	} catch {
		blob = null;
	}
	if (blob === null) {
		return { restored: false, reason: `${relPath} has no HEAD version (untracked or git unavailable)` };
	}
	try {
		atomicWriteFile(join(cwd, relPath), blob, "utf8");
		return { restored: true, reason: "restored from HEAD" };
	} catch (err) {
		return { restored: false, reason: (err as Error)?.message ?? String(err) };
	}
}
