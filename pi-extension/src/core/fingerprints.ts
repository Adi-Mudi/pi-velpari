/**
 * Requirement fingerprints (RTM traceability upgrade, Phase 3).
 *
 * Doorstop pattern: every RTM row stores a SHA-256 fingerprint of the
 * requirement's PSRS table-row text (all cells except the ID and Status
 * columns — lifecycle moves must not flag a link as stale). When the
 * requirement text changes in a PSRS revision, the fingerprint no longer
 * matches and doctor flags the RTM row as "suspect".
 *
 * The LLM never computes hashes: the publish gate (called via
 * `handleApprove` from the publish tool or the per-stage
 * `/velpari-<stage>-approve` fall-back) stamps fingerprints
 * into the JSON sidecar at publish time, from the published PSRS.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readSectionBody } from "./psrs.js";
import { resolveDocArtifact } from "./paths.js";
import { loadRtmDataForEngine, type RtmData, type RtmRow } from "./rtm-data.js";

/** SHA-256 hex of the normalized requirement text. */
export function hashRequirementText(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * SHA-256 hex of a file's UTF-8 content. Returns null when the file is
 * missing or unreadable so callers can distinguish "input absent" from
 * "input changed". Used by the freshness stamps (B4).
 */
export function hashFileContent(absolutePath: string): string | null {
	if (!existsSync(absolutePath)) return null;
	try {
		return createHash("sha256").update(readFileSync(absolutePath, "utf8"), "utf8").digest("hex");
	} catch {
		return null;
	}
}

/**
 * Remove the `## Change Log` section (from the `^## Change Log` heading to
 * the next `^## ` heading or EOF). Change Log entries are audit metadata,
 * not artifact substance — appending the mandated re-confirm line there
 * must not stale downstream consumers (A5/D3). Files without the section
 * are returned unchanged, so the normalized hash equals the whole-file
 * hash for them.
 */
export function stripChangeLogSection(content: string): string {
	const lines = content.split("\n");
	const start = lines.findIndex((line) => /^## Change Log\s*$/.test(line));
	if (start === -1) return content;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^## /.test(lines[i]!)) {
			end = i;
			break;
		}
	}
	lines.splice(start, end - start);
	return lines.join("\n");
}

/**
 * SHA-256 hex of a file's UTF-8 content with the `## Change Log` section
 * stripped (D3). Returns null when the file is missing or unreadable —
 * same contract as `hashFileContent`. Freshness manifest entries stamped
 * with `hashv: 2` are checked with this hash so a Change Log append (the
 * re-confirm audit line) never cascades into downstream staleness.
 */
export function hashFileContentNormalized(absolutePath: string): string | null {
	if (!existsSync(absolutePath)) return null;
	try {
		const stripped = stripChangeLogSection(readFileSync(absolutePath, "utf8"));
		return createHash("sha256").update(stripped, "utf8").digest("hex");
	} catch {
		return null;
	}
}

/**
 * Extract id → fingerprint from the published PSRS. Reads the Functional
 * Requirements and Non-Functional Requirements tables; for each row the
 * hashed content is every cell between the ID and the trailing Status
 * cell (title, priority, phase, acceptance, verification — the substance).
 * A Phase edit therefore flags the RTM row as suspect, as intended.
 */
export function extractRequirementFingerprints(psrsMarkdown: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const section of ["Functional Requirements", "Non-Functional Requirements"]) {
		const body = readSectionBody(psrsMarkdown, section);
		for (const line of body.split("\n")) {
			const trimmed = line.trim();
			if (!/^\|\s*(?:FR|NFR)-\d+\s*\|/.test(trimmed)) continue;
			const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
			if (cells.length < 3) continue;
			const id = cells[0]!;
			// Drop the ID cell and the trailing Status cell.
			const substance = cells.slice(1, -1).join(" | ");
			out.set(id, hashRequirementText(substance));
		}
	}
	return out;
}

type FingerprintProblem = "suspect" | "untracked" | "unknown-id" | "orphan";

interface FingerprintIssue {
	id: string;
	problem: FingerprintProblem;
	message: string;
}

/**
 * Check RTM rows against the PSRS fingerprints:
 *  - unknown-id:  row id does not exist in the PSRS;
 *  - untracked:   row carries no fingerprint (predates Phase 3);
 *  - suspect:     fingerprint mismatch — the requirement changed after linking;
 *  - orphan:      PSRS requirement with no RTM row (coverage gap, NFR-04).
 */
export function checkRowFingerprints(
	rows: readonly RtmRow[],
	fingerprints: ReadonlyMap<string, string>,
): FingerprintIssue[] {
	const issues: FingerprintIssue[] = [];
	const rowIds = new Set(rows.map((r) => r.id));
	for (const row of rows) {
		const expected = fingerprints.get(row.id);
		if (!expected) {
			issues.push({
				id: row.id,
				problem: "unknown-id",
				message: `${row.id}: no such requirement in the PSRS.`,
			});
			continue;
		}
		if (!row.fingerprint) {
			issues.push({
				id: row.id,
				problem: "untracked",
				message: `${row.id}: no fingerprint — republish to stamp it.`,
			});
			continue;
		}
		if (row.fingerprint !== expected) {
			issues.push({
				id: row.id,
				problem: "suspect",
				message: `${row.id}: requirement text changed after linking — review design/test links.`,
			});
		}
	}
	for (const id of fingerprints.keys()) {
		if (!rowIds.has(id)) {
			issues.push({
				id,
				problem: "orphan",
				message: `${id}: PSRS requirement has no RTM row (coverage gap).`,
			});
		}
	}
	return issues;
}

/**
 * Stamp fingerprints into RTM rows (mutates a copy). Rows whose id is not
 * in the PSRS keep no fingerprint — the doctor reports them as unknown-id.
 */
export function stampFingerprints(
	rows: readonly RtmRow[],
	fingerprints: ReadonlyMap<string, string>,
): RtmRow[] {
	return rows.map((row) => {
		const fp = fingerprints.get(row.id);
		return fp ? { ...row, fingerprint: fp } : { ...row };
	});
}

/**
 * Count trace-link problems (suspect / unknown-id / orphan) between the
 * published PSRS and the published RTM JSON sidecar. Returns null when
 * the inputs are missing or unreadable — callers treat null as "nothing
 * to report". Used by the session-start hook (Phase 6).
 */
export function countTraceIssues(cwd: string, projectName: string): number | null {
	if (!projectName) return null;
	// Phase 6 §14.3: DB-first reader (`loadRtmDataForEngine`) prefers the
	// project store; falls back to the legacy sidecar ONLY when no
	// published rows exist for the (project, rtm) pair.
	const data = loadRtmDataForEngine(cwd, projectName);
	if (!data) return null;
	const psrs = resolveDocArtifact("PRD", projectName, cwd);
	if (!psrs) return null;
	try {
		if (!Array.isArray(data.rows)) return null;
		const fingerprints = extractRequirementFingerprints(readFileSync(psrs.path, "utf8"));
		return checkRowFingerprints(data.rows, fingerprints).filter(
			(i) => i.problem !== "untracked",
		).length;
	} catch {
		return null;
	}
}
