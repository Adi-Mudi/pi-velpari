// ============================================================================
// core/agents-md.ts — AGENTS.md advisory section (Layer 0, Phase B, G4/N21 L2)
// ============================================================================
// Decision record: .IDE_Plans/velpari-upgrade-phase-b-locking_plan_20260928_0806_v1.0.md
//   G4/N21 — enforcement provisioning layer 2: the advisory rules an agent in
//         a client project actually reads every turn. The section is MARKED
//         (HTML comment sentinels) so we can update exactly our block and
//         preserve everything the user wrote around it — same idempotent
//         pattern as ops/git-attributes.ts.
//   N20    — the section states the content-frozen / status-allowed rule.
// Layer 0: only node:fs + node:path. Never throws (errors land in the result),
// so the caller (gate provisioning) can turn them into warnings (D2).
// ============================================================================

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Opening sentinel of the managed section in <cwd>/AGENTS.md. */
export const PROTECTED_ASSETS_START = "<!-- velpari:protected-assets:start -->";

/** Closing sentinel of the managed section in <cwd>/AGENTS.md. */
export const PROTECTED_ASSETS_END = "<!-- velpari:protected-assets:end -->";

/**
 * Render the advisory section body (N21 layer 2 + N20 rule): the marked
 * block exactly as it appears inside AGENTS.md.
 * @returns {string} Start marker + bullet list + end marker (no trailing newline).
 */
export function renderProtectedAssetsSection(): string {
	return [
		PROTECTED_ASSETS_START,
		"- `Doc/store/**` is managed by Velpari — never edit or delete it directly; use the velpari commands.",
		"- A published revision is **content-frozen** once consumed downstream (soft-locked) or at handoff (frozen); " +
			"**status changes are allowed** and are always audited; any content change = request a new version (copy → publish).",
		"- A git commit-msg hook rejects `Doc/store/**` commits that did not come from the velpari publish flow " +
			"(marker: commit message starting `velpari(`).",
		PROTECTED_ASSETS_END,
	].join("\n");
}

/** Result of one ensureProtectedAssetsSection call (never throws). */
export interface EnsureSectionResult {
	/** true when AGENTS.md content changed. */
	changed: boolean;
	/** Absolute path of AGENTS.md (even on failure — for the caller's warning). */
	path: string;
	/** Why nothing was written (mutually exclusive with changed:true). */
	skipped?: string;
	/** fs/parse failure message (never thrown). */
	error?: string;
}

/**
 * Idempotent ensure: create/update the marked section in <cwd>/AGENTS.md.
 * A missing file is created with the section only; an existing file keeps
 * EVERY byte outside the sentinels (the section between them is replaced
 * wholesale). Corrupt sentinel pairs (exactly one marker) or any fs error
 * return `{changed:false, error}` — never a throw.
 * @param {string} cwd - Project root.
 * @returns {EnsureSectionResult} What happened (see interface).
 */
export function ensureProtectedAssetsSection(cwd: string): EnsureSectionResult {
	const path = join(cwd, "AGENTS.md");
	try {
		const section = renderProtectedAssetsSection();
		if (!existsSync(path)) {
			writeFileSync(path, `${section}\n`, "utf8");
			return { changed: true, path };
		}
		const content = readFileSync(path, "utf8");
		const start = content.indexOf(PROTECTED_ASSETS_START);
		const end = content.indexOf(PROTECTED_ASSETS_END);
		if (start === -1 && end === -1) {
			// No section yet: append, preserving the user's bytes exactly.
			const prefix = content.length === 0 || content.endsWith("\n") ? content : `${content}\n`;
			writeFileSync(path, `${prefix}${section}\n`, "utf8");
			return { changed: true, path };
		}
		if (start === -1 || end === -1 || end < start) {
			return { changed: false, path, error: "AGENTS.md has a corrupt velpari protected-assets marker pair" };
		}
		const updated = content.slice(0, start) + section + content.slice(end + PROTECTED_ASSETS_END.length);
		if (updated === content) return { changed: false, path, skipped: "section already current" };
		writeFileSync(path, updated, "utf8");
		return { changed: true, path };
	} catch (err) {
		return { changed: false, path, error: err instanceof Error ? err.message : String(err) };
	}
}
