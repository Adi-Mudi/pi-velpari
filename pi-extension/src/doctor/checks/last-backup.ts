/**
 * Last-verified-backup report (Phase 6 — N11).
 *
 * Phase 3 writes every snapshot through `createBackupSnapshot` and
 * records provenance in `Backup/velpari/<project>/manifest.jsonl`
 * (SHA-256, byte count, git commit, trigger, quick_check — N11's
 * self-test half). This check is N11's doctor half: it reports the
 * newest snapshot and re-verifies it on the spot via `verifyBackup`
 * (fresh digest + read-only quick_check), so the report proves the
 * restore path instead of trusting the manifest blindly.
 *
 * Severity (plan §3 R1): store DB present but zero snapshots → WARNING
 * (instructions: "missing manifests when backups should exist = warning"
 * — self-heals at the next publish/db-reset/migrate backup trigger);
 * no store DB yet → info; failed verification → warning (Phase 3 owns
 * recovery, not this check). Never throws (R2), writes nothing (R3).
 *
 * L1 (doctor) → L0 (core/backup, core/paths, core/config,
 * core/projectnames) — legal direction.
 */

import { existsSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { buildStoreDbPath } from "../../core/paths.js";
import { loadFilesConfig, validateFilesConfig } from "../../core/config.js";
import { getEffectiveProjectNames } from "../../core/projectnames.js";
import { readBackupManifest, listBackupFiles, verifyBackup, type BackupManifestLine } from "../../core/backup.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Last verified backup (N11)";

/** Human age of an instant: "3d", "2h", "12m", "<1m". */
function ageText(fromMs: number): string | undefined {
	const delta = Date.now() - fromMs;
	if (!Number.isFinite(delta) || delta < 0) return undefined;
	const min = Math.floor(delta / 60_000);
	if (min < 1) return "<1m";
	if (min < 60) return `${min}m`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h}h`;
	return `${Math.floor(h / 24)}d`;
}

/** The `type:"backup"` manifest line naming this snapshot path, if any. */
function findLine(lines: readonly BackupManifestLine[], absPath: string, cwd: string): BackupManifestLine | undefined {
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (!line || line.type !== "backup" || !line.backupPath) continue;
		const lineAbs = resolve(cwd, line.backupPath);
		if (lineAbs === absPath) return line;
	}
	return undefined;
}

/** Effective projectNames for the cwd, or [] when config is missing/invalid. */
function effectiveProjectNamesSafe(cwd: string): string[] {
	try {
		const cfg = loadFilesConfig(cwd);
		if (!validateFilesConfig(cfg)) return [];
		return getEffectiveProjectNames(cfg);
	} catch {
		return [];
	}
}

/**
 * Build the "Last verified backup (N11)" section. Multi-design aware:
 * one audit per effective projectName's backup folder.
 */
export function checkLastBackupSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		const projectNames = effectiveProjectNamesSafe(cwd);

		if (projectNames.length === 0) {
			items.push({
				status: "info",
				message: "Backup report skipped — project name missing.",
				suggestion: suggestionFor("project-name-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		const dbPaths = projectNames.map((projectName) => ({
			projectName,
			dbPath: buildStoreDbPath(projectName, cwd),
		}));

		if (dbPaths.every(({ dbPath }) => !existsSync(dbPath))) {
			items.push({
				status: "info",
				message: "No store DB yet — no backups expected (the first publish writes one).",
				details: dbPaths.map(({ dbPath }) => `expected: ${dbPath}`),
				suggestion: suggestionFor("store-db-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		for (const { projectName, dbPath } of dbPaths) {
			if (!existsSync(dbPath)) {
				items.push({
					status: "info",
					message: `${projectName}: no store DB (pre-store project) — no backups expected.`,
					details: [`expected: ${dbPath}`],
					suggestion: suggestionFor("store-db-missing"),
				});
				continue;
			}

			const files = listBackupFiles(cwd, projectName);
			const manifestLines = readBackupManifest(cwd, projectName);
			const backupLines = manifestLines.filter((l) => l.type === "backup");

			if (files.length === 0) {
				if (backupLines.length > 0) {
					items.push({
						status: "warning",
						message: `${projectName}: manifest lists ${backupLines.length} backup(s) but no snapshot files remain under Backup/velpari/${projectName}/.`,
						details: ["the snapshots were deleted outside Velpari — restore from git history or a fresh snapshot"],
						suggestion: suggestionFor("backup-missing"),
					});
				} else {
					items.push({
						status: "warning",
						message: `${projectName}: no backup under Backup/velpari/${projectName}/ — the next publish, /velpari-db-reset or /velpari-migrate-store creates one (N9).`,
						details: [`store DB: ${dbPath}`],
						suggestion: suggestionFor("backup-missing"),
					});
				}
				continue;
			}

			const newest = files[0];
			if (!newest) continue;
			const rel = relative(cwd, newest);
			const line = findLine(manifestLines, newest, cwd);
			const createdMs = line?.createdAt ? Date.parse(line.createdAt) : Number.NaN;
			const mtimeMs = statSync(newest).mtimeMs;
			const age = ageText(Number.isFinite(createdMs) ? createdMs : mtimeMs);

			const verdict = verifyBackup(cwd, projectName, rel);
			if (verdict.ok) {
				const git = line?.gitCommit ? line.gitCommit.slice(0, 7) : "nogit";
				const trigger = line?.trigger ?? "unknown";
				items.push({
					status: "ok",
					message:
						`${projectName}: last backup ${basename(newest)} ` +
						`(${age ?? "?"} old, trigger ${trigger}, quick_check ok, git ${git}) — proven.`,
					details: [`path=${rel}`, line?.sha256 ? `sha256=${line.sha256}` : "sha256=manifest-unavailable"],
					suggestion: suggestionFor("backup-restore-hint"),
				});
			} else {
				items.push({
					status: "warning",
					message:
						`${projectName}: last backup ${basename(newest)} failed verification — ` +
						`${verdict.problems[0] ?? "unknown problem"}`,
					details: verdict.problems.slice(1).concat(`path=${rel}`),
					suggestion: suggestionFor("backup-verify-failed"),
				});
			}
		}
	} catch (err) {
		items.push({
			status: "info",
			message: `Backup report skipped: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
	return { title: SECTION_TITLE, items };
}
