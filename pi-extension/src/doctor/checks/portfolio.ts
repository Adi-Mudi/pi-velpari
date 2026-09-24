/**
 * Portfolio registry check (Phase 10 — §15.5 drift visibility).
 *
 * The registry (Doc/store/portfolio.db) is DERIVED from the spokes, so any
 * drift is repairable — but it must be VISIBLE (the Phase 9 lesson). This
 * check audits:
 *   1. registry↔disk: rows whose db_path vanished (portfolio-stale),
 *      spoke DBs with no row (portfolio-unregistered), registry rows whose
 *      spoke dir is gone (portfolio-orphan).
 *   2. D8 assets: image:-prefixed diagram text in published design rows —
 *      the asset must exist relative to the owning DB dir
 *      (portfolio-asset-missing); paths containing `..` are REJECTED
 *      outright, never probed on disk (portfolio-asset-invalid).
 *
 * Registry missing while spokes exist → info (pre-registry; the next
 * publish or /velpari-portfolio --repair creates it).
 *
 * L1 (doctor) imports L0 (io/db, io/portfolio, io/store, core/paths) and
 * same-layer ops/portfolio for the drift sweep — legal directions.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { buildPortfolioDbPath, buildStoreDbPath } from "../../core/paths.js";
import { openPortfolioDb, closeStoreDb } from "../../io/db.js";
import { listProjects } from "../../io/portfolio.js";
import { readLatestPublishedRows } from "../../io/store.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests + action-items callout key on it). */
const SECTION_TITLE = "Portfolio registry";

/** Spoke dirs = subdirectories of Doc/store carrying an index.db. */
function spokeNames(cwd: string): string[] {
	const storeDir = join(cwd, "Doc", "store");
	if (!existsSync(storeDir)) return [];
	try {
		return readdirSync(storeDir, { withFileTypes: true })
			.filter((e) => e.isDirectory() && existsSync(join(storeDir, e.name, "index.db")))
			.map((e) => e.name)
			.sort();
	} catch {
		return [];
	}
}

/**
 * Collect image: asset refs from the newest published design rows and
 * resolve each against the owning DB dir. Never probes paths containing
 * `..` (traversal — reported invalid without touching the filesystem).
 */
function auditDesignAssets(cwd: string, projectName: string): { missing: string[]; invalid: string[] } {
	const missing: string[] = [];
	const invalid: string[] = [];
	const read = readLatestPublishedRows(cwd, projectName, "design");
	if (!read) return { missing, invalid };
	const diagrams = (read.rows.diagram as Array<{ id?: unknown; mermaidText?: unknown }> | undefined) ?? [];
	const dbDir = dirname(buildStoreDbPath(projectName, cwd));
	for (const d of diagrams) {
		const text = String(d.mermaidText ?? "");
		if (!text.startsWith("image:")) continue;
		const asset = text.slice("image:".length).trim();
		if (asset.length === 0) continue;
		if (asset.includes("..")) {
			invalid.push(asset);
			continue;
		}
		if (!existsSync(join(dbDir, asset))) missing.push(asset);
	}
	return { missing, invalid };
}

/**
 * Build the "Portfolio registry" section. Registry-absent + no spokes →
 * single info note (fresh project). Every other state reports per-row.
 * @param {string} cwd - Project root.
 * @returns {DiagnosticSection} The section.
 */
export function checkPortfolioSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const registryPath = buildPortfolioDbPath(cwd);
	const spokes = spokeNames(cwd);

	// Fresh project: no registry AND no spokes.
	if (!existsSync(registryPath) && spokes.length === 0) {
		items.push({
			status: "info",
			message: "No portfolio registry and no per-project DBs (fresh project).",
			details: ["The registry is created by the next publish or /velpari-portfolio --repair."],
		});
		return { title: SECTION_TITLE, items };
	}

	if (!existsSync(registryPath)) {
		// Spokes exist but no hub — the pre-registry state.
		items.push({
			status: "info",
			message: `No portfolio registry yet (${spokes.length} project DB(s) under Doc/store).`,
			details: ["Created automatically by the next publish, or run /velpari-portfolio --repair now."],
			suggestion: suggestionFor("portfolio-unregistered"),
		});
		return { title: SECTION_TITLE, items };
	}

	let db: DatabaseSync;
	try {
		db = openPortfolioDb(registryPath);
	} catch (err) {
		items.push({
			status: "error",
			message: `Portfolio registry unreadable: ${err instanceof Error ? err.message : String(err)}`,
			suggestion: suggestionFor("portfolio-orphan"),
		});
		return { title: SECTION_TITLE, items };
	}

	try {
		const rows = listProjects(db);
		const rowNames = new Set(rows.map((r) => r.projectName));

		// 1. Registry rows vs disk.
		for (const row of rows) {
			const spokePath = join(cwd, row.dbPath);
			if (!existsSync(spokePath)) {
				items.push({
					status: "warning",
					message: `${row.projectName}: registry row points at a missing DB (${row.dbPath}).`,
					suggestion: suggestionFor("portfolio-stale"),
				});
			}
		}
		for (const name of spokes) {
			if (!rowNames.has(name)) {
				items.push({
					status: "warning",
					message: `${name}: project DB not registered in the portfolio registry.`,
					suggestion: suggestionFor("portfolio-unregistered"),
				});
			}
		}

		// 2. D8 asset sweep per REGISTERED spoke (row.dbPath is repo-relative
		// — the row's project dir is its dirname).
		for (const row of rows) {
			if (!existsSync(join(cwd, row.dbPath))) continue; // stale already reported
			const projectName = row.projectName;
			const { missing, invalid } = auditDesignAssets(cwd, projectName);
			for (const asset of missing) {
				items.push({
					status: "warning",
					message: `${projectName}: diagram asset missing on disk: ${asset} (expected under ${join("Doc", "store", projectName)}).`,
					suggestion: suggestionFor("portfolio-asset-missing"),
				});
			}
			for (const asset of invalid) {
				items.push({
					status: "warning",
					message: `${projectName}: diagram asset path escapes the DB dir (rejected, not probed): ${asset}.`,
					suggestion: suggestionFor("portfolio-asset-invalid"),
				});
			}
		}

		if (items.length === 0) {
			items.push({
				status: "ok",
				message: `Registry in sync (${rows.length} project(s)); no drift, no missing assets.`,
			});
		}
	} finally {
		closeStoreDb(db);
	}

	return { title: SECTION_TITLE, items };
}
