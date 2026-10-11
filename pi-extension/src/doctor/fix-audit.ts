/**
 * Repair audit log (Doctor upgrade Phase 2 — contract T8).
 *
 * Every applied auto-safe repair appends ONE JSON line to
 * `.IDE_Plans/velpari/doctor-fix-audit.jsonl` — the "Learn" half of the
 * Monitor → Diagnose → Repair → Verify → Learn loop. The log is
 * append-only and best-effort: a failed write must NEVER break a repair
 * (see `remediate.ts`), and a malformed line is skipped on read rather
 * than throwing.
 *
 * Lives in the `doctor/` layer (L1). Uses `node:fs` directly — the
 * append helper in `io/atomic-write.ts` is for whole-file atomic
 * replacement, not append-only journals.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** One repair attempt. */
export interface FixAuditEntry {
	/** ISO-8601 timestamp of the attempt. */
	at: string;
	/** The fix fingerprint that ran (e.g. `frontmatter-missing`). */
	fingerprint: string;
	/** Did the remediate run without throwing? */
	ok: boolean;
	/** Files the remediate actually modified (empty when none / on failure). */
	changedFiles: string[];
}

/** Project-root-relative location of the audit journal. */
const AUDIT_RELATIVE = join(".IDE_Plans", "velpari", "doctor-fix-audit.jsonl");

/**
 * Resolve the audit file path for a project root.
 * @param {string} [cwd] - Project root (defaults to `process.cwd()`).
 * @returns {string} Absolute path to the journal.
 */
function auditPath(cwd?: string): string {
	return join(cwd ?? process.cwd(), AUDIT_RELATIVE);
}

/**
 * Append one audit entry. Best-effort: never throws — a repair that
 * succeeded must not be reported as failed because the log could not be
 * written.
 * @param {FixAuditEntry} entry - The attempt to record.
 * @param {string} [cwd] - Project root (defaults to `process.cwd()`).
 */
export function recordFixAudit(entry: FixAuditEntry, cwd?: string): void {
	try {
		const file = auditPath(cwd);
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
	} catch {
		/* best-effort: a failed audit must never break the repair */
	}
}

/**
 * Read every audit entry, oldest first. Tolerant: a missing file yields
 * `[]`, and malformed lines are skipped instead of throwing.
 * @param {string} [cwd] - Project root (defaults to `process.cwd()`).
 * @returns {FixAuditEntry[]} Parsed entries.
 */
export function readFixAudit(cwd?: string): FixAuditEntry[] {
	try {
		const file = auditPath(cwd);
		if (!existsSync(file)) return [];
		const entries: FixAuditEntry[] = [];
		for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const parsed = JSON.parse(trimmed) as FixAuditEntry;
				if (parsed && typeof parsed === "object") entries.push(parsed);
			} catch {
				/* skip malformed line */
			}
		}
		return entries;
	} catch {
		return [];
	}
}
