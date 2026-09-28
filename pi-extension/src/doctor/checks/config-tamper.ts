/**
 * Config-tamper check — Phase C (G3), Doctor v2.
 *
 * Answers "did a config file change since the recorded baseline?" with
 * git evidence:
 *
 *   - no manifest            → single `info config-baseline-missing`
 *     (the doctor NEVER writes the baseline — that happens only in the
 *     confirm-gated fix flow, N23);
 *   - JSON-invalid config    → **`error`** `config-unreadable`;
 *   - hash ≠ baseline        → **`warning`** `config-drift`, details =
 *     short hashes + `git status --porcelain` intent (staged / modified /
 *     untracked / clean / unavailable) so the user can tell a deliberate
 *     edit from a foreign one (`git diff .pi/velpari/`);
 *   - file deleted since     → **`warning`** (baseline row with no file);
 *   - all match              → one `ok`.
 *
 * Read-only; whole function try/catch-wrapped (doctor ALWAYS renders).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { diffAgainstBaseline, loadConfigManifest } from "../config-manifest.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Config tamper (drift vs recorded baseline + git intent)";

/**
 * Git intent for one root-relative path (fail-soft).
 * @param {string} cwd - Project root.
 * @param {string} relPath - Project-relative config path.
 * @returns {string} One of `clean`, `staged`, `modified`, `untracked`, `deleted`, `combined …`, `unavailable`.
 */
export function gitIntent(cwd: string, relPath: string): string {
	try {
		const r = spawnSync("git", ["status", "--porcelain", "--", relPath], { cwd, encoding: "utf8" });
		if (r.error || r.status !== 0) return "unavailable";
		// NOTE: do NOT trim the line — porcelain columns are positional and
		// the leading worktree column is a space (" M" = modified-in-worktree).
		const line = (r.stdout ?? "").split("\n").find((l) => l.trim() !== "") ?? "";
		if (line.trim() === "") return "clean";
		const x = line[0] ?? " ";
		const y = line[1] ?? " ";
		if (x === "?" || y === "?") return "untracked";
		const parts: string[] = [];
		if (x !== " ") parts.push("staged");
		if (y === "D") parts.push("deleted-in-worktree");
		else if (y !== " ") parts.push("modified");
		return parts.length > 0 ? parts.join("+") : "clean";
	} catch {
		return "unavailable";
	}
}

/**
 * Build the "Config tamper" section (read-only).
 * @param {string} cwd - Project root.
 * @returns {DiagnosticSection} One section; missing baseline is `info`, drift is `warning`, invalid JSON is `error`.
 */
export function checkConfigTamperSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		const manifest = loadConfigManifest(cwd);
		if (manifest === null) {
			items.push({
				status: "info",
				message: "config-baseline-missing: no config baseline recorded — tamper detection inactive. Run `/velpari-doctor --velpari-fix` and choose Fix all to record it (one confirm).",
				suggestion: suggestionFor("config-baseline-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		const diffs = diffAgainstBaseline(cwd);
		if (diffs.length === 0) {
			items.push({
				status: "info",
				message: "Baseline records no config files yet — re-run the fix flow to record one.",
				suggestion: suggestionFor("config-baseline-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		let matches = 0;
		for (const diff of diffs) {
			const intent = gitIntent(cwd, diff.relPath);
			if (diff.status === "deleted") {
				items.push({
					status: "warning",
					message: `${diff.relPath}: deleted since the baseline was recorded (git: ${intent}).`,
					details: [`baseline sha256: ${diff.baselineSha256.slice(0, 16)}…`],
					suggestion: suggestionFor("config-drift"),
				});
				continue;
			}
			if (diff.status === "unreadable") {
				items.push({
					status: "error",
					message: `config-unreadable: ${diff.relPath} exists but cannot be read (git: ${intent}).`,
					suggestion: suggestionFor("config-unreadable"),
				});
				continue;
			}

			// Readable — check JSON validity before anything else (doctor
			// consumers parse these files; invalid JSON blocks them).
			try {
				JSON.parse(readFileSync(join(cwd, diff.relPath), "utf8"));
			} catch (err) {
				items.push({
					status: "error",
					message: `config-unreadable: ${diff.relPath} is not valid JSON (${(err as Error)?.message ?? String(err)}) (git: ${intent}).`,
					suggestion: suggestionFor("config-unreadable"),
				});
				continue;
			}

			if (diff.status === "drifted") {
				items.push({
					status: "warning",
					message: `config-drift: ${diff.relPath} changed since the baseline (git: ${intent}).`,
					details: [
						`baseline sha256: ${diff.baselineSha256.slice(0, 16)}…`,
						`current  sha256: ${(diff.sha256 ?? "").slice(0, 16)}…`,
						intent === "clean"
							? "git clean vs HEAD — the change is committed (deliberate?) or predates the baseline"
							: `git intent: ${intent} — run \`git diff ${diff.relPath}\` to see the foreign edit`,
					],
					suggestion: suggestionFor("config-drift"),
				});
			} else {
				matches++;
			}
		}

		if (matches === diffs.length) {
			items.push({
				status: "ok",
				message: `All ${diffs.length} config file(s) match the recorded baseline.`,
			});
		}
	} catch (err) {
		items.push({
			status: "warning",
			message: `config tamper check skipped (${(err as Error)?.message ?? String(err)})`,
		});
	}
	return { title: SECTION_TITLE, items };
}
