/**
 * Doctor check registry — Phase 5 (plan §Phase 5).
 *
 * Reads overlay-specific doctor checks from the overlay's
 * `doctor/check-overlay.md` file. The file is plain Markdown with one
 * rule per bullet line. The registry returns the list as strings;
 * the doctor's index.ts surfaces them under the overlay section.
 *
 * Pure IO + Markdown. No LLM calls. No UI calls.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalogue, findOverlay } from "../core/standards-catalogue.js";
import { loadOverlay, overlayDir } from "../core/standards-overlay.js";

/** Absolute path to the overlay's check-overlay.md. */
function overlayCheckPath(cwd: string, overlayId: string): string {
	return join(overlayDir(cwd, overlayId), "doctor", "check-overlay.md");
}

/**
 * Return the list of overlay-specific check strings for the active
 * standards overlay. Returns `[]` when:
 *   - the overlay id is absent or unknown
 *   - the overlay profile declares no `doctorChecks` entries
 *   - the catalogue is missing
 *   - `check-overlay.md` is missing or malformed
 *
 * The function never throws — failures degrade gracefully to an empty
 * check list so the doctor still renders a usable report.
 */
export function loadOverlayChecks(cwd: string, overlayId: string | undefined): string[] {
	if (!overlayId) return [];

	const catalogue = loadCatalogue(cwd);
	if (!catalogue) return [];
	const listed = findOverlay(catalogue, overlayId);
	if (!listed) return [];

	const overlay = loadOverlay(cwd, overlayId);
	if (!overlay || overlay.doctorChecks.length === 0) return [];

	// Verify the file exists; if missing, fall back to the inline list.
	const path = overlayCheckPath(cwd, overlayId);
	if (!existsSync(path)) return overlay.doctorChecks;

	try {
		const content = readFileSync(path, "utf8");
		const fromFile = parseCheckOverlayMd(content);
		// Prefer the file's bullets; fall back to the inline list when the
		// file is empty or only has frontmatter.
		return fromFile.length > 0 ? fromFile : overlay.doctorChecks;
	} catch {
		return overlay.doctorChecks;
	}
}

/**
 * Parse a `check-overlay.md` file. Each non-empty bullet becomes one check
 * string. Lines starting with `#` are headings (ignored). Frontmatter is
 * stripped if present.
 */
function parseCheckOverlayMd(content: string): string[] {
	const lines = content.split("\n");
	const checks: string[] = [];
	let inFrontmatter = false;
	let pastFrontmatter = false;

	for (const raw of lines) {
		const line = raw.trim();
		if (!pastFrontmatter && line === "---") {
			inFrontmatter = !inFrontmatter;
			if (!inFrontmatter) pastFrontmatter = true;
			continue;
		}
		if (line.startsWith("#")) continue; // heading
		if (line.startsWith("- ")) {
			checks.push(line.slice(2).trim());
			continue;
		}
		if (line.startsWith("* ")) {
			checks.push(line.slice(2).trim());
		}
	}
	return checks.filter((c) => c.length > 0);
}
