/**
 * Git integration check (Phase 9 1.5 - G2a visibility).
 *
 * Verifies the USER repo's git protection for the raw-committed store DB:
 * .gitattributes carries the store-DB binary attribute (merge prevention)
 * and .gitignore excludes the index.db-wal / index.db-shm sidecar files
 * (they are checkpointed away pre-commit and must never be committed).
 * Missing patterns are a WARNING (not an error): the next publish
 * auto-heals them via ops/git-attributes.ts:ensureStoreGitIntegration,
 * and the runbook (skills/db-store-merge-runbook.md) documents the manual
 * fix.
 *
 * Drift must be doctor-visible, not discovered at merge time (plan review
 * gap 1's visibility half).
 *
 * L1 (doctor) imports L1 (ops/git-attributes - same-layer, legal) for the
 * canonical pattern constants so the check can never drift from the heal.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STORE_DB_ATTR_LINE, STORE_IGNORE_LINES } from "../../ops/git-attributes.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable - tests + action-items callout key on it). */
const SECTION_TITLE = "Git integration";

/** Does `content` carry `line`? (trimmed exact-match per line) */
function hasLine(content: string, line: string): boolean {
	return content
		.split(/\r?\n/)
		.map((l) => l.trim())
		.includes(line);
}

/**
 * Build the "Git integration" section. One item per file (attributes +
 * ignore patterns). Config-missing degrades to a warning per file (doctor
 * must always render a usable report).
 * @param {string} cwd - Project root (the user's git work tree).
 * @returns {DiagnosticSection} The section.
 */
export function checkGitIntegrationSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	const attrPath = join(cwd, ".gitattributes");
	const ignorePath = join(cwd, ".gitignore");

	// .gitattributes - binary attr (merge prevention).
	if (!existsSync(attrPath)) {
		items.push({
			status: "warning",
			message:
				".gitattributes missing - the store DB has no binary attribute (merge conflicts on index.db will need the runbook instead of refusing loudly).",
			details: [`expected line: ${STORE_DB_ATTR_LINE}`],
			suggestion: suggestionFor("git-attr-missing"),
		});
	} else {
		const content = readFileSync(attrPath, "utf8");
		if (hasLine(content, STORE_DB_ATTR_LINE)) {
			items.push({ status: "ok", message: ".gitattributes: store DB marked binary." });
		} else {
			items.push({
				status: "warning",
				message: ".gitattributes exists but lacks the store-DB binary attribute.",
				details: [`expected line: ${STORE_DB_ATTR_LINE}`],
				suggestion: suggestionFor("git-attr-missing"),
			});
		}
	}

	// .gitignore - WAL sidecars never committed.
	if (!existsSync(ignorePath)) {
		items.push({
			status: "warning",
			message: ".gitignore missing - the WAL sidecar files (-wal/-shm) risk being committed.",
			details: STORE_IGNORE_LINES.map((l) => `expected line: ${l}`),
			suggestion: suggestionFor("git-ignore-missing"),
		});
	} else {
		const content = readFileSync(ignorePath, "utf8");
		const missing = STORE_IGNORE_LINES.filter((line) => !hasLine(content, line));
		if (missing.length === 0) {
			items.push({ status: "ok", message: ".gitignore: WAL sidecars excluded." });
		} else {
			items.push({
				status: "warning",
				message: `.gitignore lacks ${missing.length} store sidecar pattern(s).`,
				details: missing.map((l) => `expected line: ${l}`),
				suggestion: suggestionFor("git-ignore-missing"),
			});
		}
	}

	return { title: SECTION_TITLE, items };
}
