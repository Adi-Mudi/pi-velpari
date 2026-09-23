/**
 * Store DB integrity check (G4 — Phase 7, doctor as SQL).
 *
 * For every effective projectName, opens `Doc/store/<project>/index.db`
 * when present and runs `PRAGMA quick_check` (cheap) then `PRAGMA
 * integrity_check` (full). Any non-"ok" result is an error item; a
 * missing DB is an info note (pre-store project — OQ3).
 *
 * Stamping: on STANDALONE doctor runs only (`opts.embedded !== true`),
 * upserts `store_meta.integrity_checked_at` so the next run can report
 * the last audit time. The embedded post-publish doctor run passes
 * `embedded: true` and writes NOTHING — it executes after db-publish's
 * git commit, and a stamp there would dirty the just-committed DB file
 * (review v1.1, moderate 1). Guard note: envelope/export mappings in
 * `io/store.ts` are column-whitelisted (`readEnvelope`/`buildExportObject`),
 * so `store_meta` can never leak into export YAML or fingerprints.
 *
 * L1 (doctor) → L0 (io/db, io/store, core/paths) — legal direction.
 */

import { existsSync } from "node:fs";
import { buildStoreDbPath } from "../../core/paths.js";
import { loadFilesConfig, validateFilesConfig } from "../../core/config.js";
import { getEffectiveProjectNames } from "../../core/projectnames.js";
import { openStoreDb, closeStoreDb, storeMetaSet } from "../../io/db.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests + action-items callout key on it). */
const SECTION_TITLE = "Store DB integrity";

/** store_meta key stamped with the last standalone audit time. */
const STAMP_KEY = "integrity_checked_at";

/**
 * Effective projectNames for the cwd, or [] when config is missing or
 * invalid (the check degrades to an info item instead of throwing —
 * doctor must always render a usable report).
 */
function effectiveProjectNamesSafe(cwd: string): string[] {
	try {
		const cfg = loadFilesConfig(cwd);
		if (!validateFilesConfig(cfg)) return [];
		return getEffectiveProjectNames(cfg);
	} catch {
		return [];
	}
}

/** Options for the integrity check. */
export interface IntegrityCheckOptions {
	/** True when run inside the post-publish doctor (never stamps). */
	embedded?: boolean;
}

/** Single-DB audit result (internal). */
interface DbAudit {
	projectName: string;
	dbPath: string;
	/** Null when the DB file does not exist. */
	result: string | null;
}

/** Run quick_check + integrity_check on one DB; null when file absent. */
function auditOneDb(dbPath: string): string | null {
	if (!existsSync(dbPath)) return null;
	const db = openStoreDb(dbPath);
	try {
		const quick = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
		if (quick.quick_check !== "ok") return quick.quick_check;
		const full = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
		return full.integrity_check;
	} finally {
		// Checkpoint first (G1) so any read of the DB file sees a clean file.
		closeStoreDb(db);
	}
}

/**
 * Build the "Store DB integrity" section (G4). Multi-design aware: one
 * audit item per effective projectName's DB. No DB anywhere → single
 * info note (pre-store project).
 */
export function checkDbIntegritySection(cwd: string, opts: IntegrityCheckOptions = {}): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const projectNames = effectiveProjectNamesSafe(cwd);

	if (projectNames.length === 0) {
		items.push({
			status: "info",
			message: "Store DB integrity skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: SECTION_TITLE, items };
	}

	const audits: DbAudit[] = [];
	for (const projectName of projectNames) {
		const dbPath = buildStoreDbPath(projectName, cwd);
		audits.push({ projectName, dbPath, result: auditOneDb(dbPath) });
	}

	if (audits.every((a) => a.result === null)) {
		items.push({
			status: "info",
			message: "No store DB yet — integrity check will run after the first publish.",
			details: audits.map((a) => `expected: ${a.dbPath}`),
			suggestion: suggestionFor("store-db-missing"),
		});
		return { title: SECTION_TITLE, items };
	}

	for (const audit of audits) {
		if (audit.result === null) {
			items.push({
				status: "info",
				message: `${audit.projectName}: no store DB (pre-store project).`,
				details: [`expected: ${audit.dbPath}`],
				suggestion: suggestionFor("store-db-missing"),
			});
			continue;
		}
		if (audit.result === "ok") {
			items.push({
				status: "ok",
				message: `${audit.projectName}: integrity ok.`,
				details: [`db=${audit.dbPath}`, "PRAGMA quick_check + integrity_check passed."],
			});
		} else {
			items.push({
				status: "error",
				message: `${audit.projectName}: store DB integrity FAILED — ${audit.result}.`,
				details: [`db=${audit.dbPath}`],
				suggestion: suggestionFor("store-db-corrupt"),
			});
		}
	}

	// Stamp the last audit time — standalone runs only (locked decision 1).
	if (opts.embedded !== true) {
		const stamp = new Date().toISOString();
		for (const audit of audits) {
			if (audit.result === null) continue;
			try {
				const db = openStoreDb(audit.dbPath);
				try {
					storeMetaSet(db, STAMP_KEY, stamp);
				} finally {
					closeStoreDb(db);
				}
			} catch {
				// A failed stamp must never fail the check itself.
			}
		}
	}

	return { title: SECTION_TITLE, items };
}