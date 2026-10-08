/**
 * Brainstorm notes module (Phase 4 of the lifecycle v2 upgrade).
 *
 * Owns the brainstorm-notes.md contract: the required-sections list, the
 * `_TBD_` placeholder rule, the strikethrough amendment helper, and the
 * machine-managed decision ledger (## Agreed / ## Not wanted / ## Open)
 * that is regenerated from state.brainstormQuestions on every change.
 *
 * Single source of truth for the section model — the guard layer
 * (./guard.ts) imports the constants from here instead of defining its own.
 *
 * Velpari adaptation: senai's appendOutOfScopeDecision is NOT ported — the
 * velpari notes template has no Out-of-scope section; rejected questions
 * live in the rendered `## Not wanted` list (with reason) instead.
 */

import { existsSync, readFileSync } from "node:fs";
import { atomicWriteFile } from "../../io/atomic-write.js";
import type { BrainstormQuestion } from "../../core/state.js";

// ─────────────────────────────────────────────────────────────────────────
// Section model
// ─────────────────────────────────────────────────────────────────────────

/** Required brainstorm-notes.md sections: the base 4 (Mission, Interview
 *  Answers, Scout Proposals, Decision Summary) plus the 3 decision-ledger
 *  sections (Agreed / Not wanted / Open). */
export const REQUIRED_NOTES_SECTIONS = [
	"Mission",
	"Interview Answers",
	"Scout Proposals",
	"Decision Summary",
	"Agreed",
	"Not wanted",
	"Open",
] as const;

/** Placeholder marker that counts as an unfilled notes section. */
export const NOTES_CONTENT_PLACEHOLDER = "_TBD_";

/** Markers wrapping the machine-managed decisions block inside the notes
 *  file. The block is REGENERATED from state.brainstormQuestions on every
 *  change, so it is always consistent — no incremental edits. */
export const DECISIONS_BLOCK_START = "<!-- pi-velpari decisions:start -->";
export const DECISIONS_BLOCK_END = "<!-- pi-velpari decisions:end -->";

/** Extract the body of a `## <name>` section (up to the next `## ` heading
 *  or end of document). Returns undefined when the heading is missing. */
export function sectionBody(raw: string, name: string): string | undefined {
	const heading = new RegExp(`^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
	const match = heading.exec(raw);
	if (!match) return undefined;
	const rest = raw.slice(match.index + match[0].length);
	const nextHeading = /^##\s/m.exec(rest);
	return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
}

/** Validate that every required notes section exists and has REAL content —
 *  not empty, not `_TBD_`. Returns { ok } plus a reason naming every
 *  unfilled section when validation fails. */
export function validateNotesContent(raw: string): { ok: boolean; reason?: string } {
	const unfilled: string[] = [];
	for (const name of REQUIRED_NOTES_SECTIONS) {
		const body = sectionBody(raw, name);
		if (body === undefined) {
			unfilled.push(`${name} (missing)`);
		} else if (body.length === 0) {
			unfilled.push(`${name} (empty)`);
		} else if (body.includes(NOTES_CONTENT_PLACEHOLDER)) {
			unfilled.push(`${name} (${NOTES_CONTENT_PLACEHOLDER} placeholder)`);
		}
	}
	if (unfilled.length > 0) {
		return {
			ok: false,
			reason: `Brainstorm notes are missing or unfilled sections: ${unfilled.join(", ")}`,
		};
	}
	return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Amendment helper
// ─────────────────────────────────────────────────────────────────────────

/** Cross out an old bullet and insert its replacement, preserving the
 *  superseded text in place:
 *
 *    - ~~old text~~
 *    - new text
 *
 *  When the old line is not found, the replacement bullet is appended at
 *  the end (the ledger must never lose a decision). Pure helper. */
export function amendBullet(text: string, oldLine: string, replacement: string): string {
	const bulletLine = `- ${oldLine}`;
	const replacementLine = `- ${replacement}`;
	if (!text.includes(bulletLine)) {
		return `${text}\n${replacementLine}`;
	}
	return text.replace(bulletLine, `- ~~${oldLine}~~\n${replacementLine}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Decision ledger (Agreed / Not wanted / Open)
// ─────────────────────────────────────────────────────────────────────────

/** Render the three decision lists from the question ledger.
 *  - agreed  → "## Agreed" (with suggested answer when recorded)
 *  - not-wanted / replaced → "## Not wanted" (with reason; replaced keeps
 *    the strikethrough so the superseded text survives)
 *  - draft / discussing → "## Open" (with the current state labeled) */
export function renderDecisionsBlock(questions: BrainstormQuestion[]): string {
	const agreed = questions.filter((q) => q.state === "agreed");
	const rejected = questions.filter((q) => q.state === "not-wanted" || q.state === "replaced");
	const open = questions.filter((q) => q.state === "draft" || q.state === "discussing");

	const lines: string[] = [DECISIONS_BLOCK_START, "", "## Agreed", ""];
	if (agreed.length === 0) lines.push("- (none yet)");
	for (const q of agreed) {
		lines.push(`- ${q.id}: ${q.text}${q.suggestedAnswer ? ` — ${q.suggestedAnswer}` : ""}`);
	}
	lines.push("", "## Not wanted", "");
	if (rejected.length === 0) lines.push("- (none)");
	for (const q of rejected) {
		const text = q.state === "replaced" ? `~~${q.text}~~ (superseded)` : q.text;
		lines.push(`- ${q.id}: ${text} — reason: ${q.reason ?? "(no reason recorded)"}`);
	}
	lines.push("", "## Open", "");
	if (open.length === 0) lines.push("- (none)");
	for (const q of open) {
		lines.push(`- ${q.id}: ${q.text} (state: ${q.state})`);
	}
	lines.push("", DECISIONS_BLOCK_END);
	return lines.join("\n");
}

/** Write (or refresh) the marker-wrapped decisions block inside the notes
 *  file. Creates the block at the end when absent; replaces the existing
 *  block in place when present (idempotent). All other content is
 *  preserved. Atomic write. Returns the notes path. */
export function syncDecisionsToNotes(notesPath: string, questions: BrainstormQuestion[]): string {
	const block = renderDecisionsBlock(questions);
	const current = existsSync(notesPath) ? readFileSync(notesPath, "utf8") : "";
	const start = current.indexOf(DECISIONS_BLOCK_START);
	const end = current.indexOf(DECISIONS_BLOCK_END);
	let next: string;
	if (start !== -1 && end !== -1 && end > start) {
		next = current.slice(0, start) + block + current.slice(end + DECISIONS_BLOCK_END.length);
	} else {
		const base = current.trimEnd();
		next = base ? `${base}\n\n${block}\n` : `${block}\n`;
	}
	atomicWriteFile(notesPath, next, "utf8");
	return notesPath;
}
