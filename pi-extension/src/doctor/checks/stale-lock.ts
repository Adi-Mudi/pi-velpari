/**
 * Stale-lock detection (Phase 6 — N13/G-5).
 *
 * The run lock (`.pi/velpari/.lock/meta.json`) serializes `state.json`
 * mutations. A holder that is dead (pid gone) or silent (heartbeat past
 * the freshness threshold) leaves the lock stale. This check reports it
 * and names the ONLY sanctioned recovery: `/velpari-reset` (confirm +
 * audit event — `ops/reset.ts` clears the lock) — never hand-deleting
 * `.lock/`, which would bypass the audit trail.
 *
 * The staleness predicate itself lives in L0 (`readLockStatus` —
 * pid-alive OR fresh heartbeat); this check never re-implements it and
 * never probes git. Duplicates the gate-wiring lock line's *detail*
 * (decision D5: that line drops to an info pointer so one defect is
 * reported once, with recovery attached).
 *
 * Writes nothing, never throws (R2/R3). L1 (doctor) → L0 — legal.
 */

import { runLockDir, readLockStatus } from "../../io/run-lock.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Run lock (N13)";

/** Build the "Run lock (N13)" section for the cwd. */
export function checkRunLockSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		const { holder, stale } = readLockStatus(cwd);

		if (!holder) {
			items.push({ status: "ok", message: "Run lock: free." });
			return { title: SECTION_TITLE, items };
		}

		const heartbeatAgeSec = Math.max(0, Math.round((Date.now() - Date.parse(holder.heartbeatAt)) / 1000));
		const details = [
			`lock=${runLockDir(cwd)}`,
			`pid=${holder.pid} host=${holder.host} command=${holder.command}`,
			`started=${holder.startedAt} heartbeat=${holder.heartbeatAt} (${heartbeatAgeSec}s ago)`,
		];

		if (!stale) {
			items.push({
				status: "info",
				message:
					`Run lock held by pid=${holder.pid} (${holder.command}) — ` +
					`a state mutation is in flight (heartbeat ${heartbeatAgeSec}s ago).`,
				details,
			});
			return { title: SECTION_TITLE, items };
		}

		items.push({
			status: "warning",
			message:
				`Run lock is STALE (pid=${holder.pid}, host=${holder.host}, command=${holder.command}, ` +
				`last heartbeat ${heartbeatAgeSec}s ago) — the holder process is dead or stopped.`,
			details,
			suggestion: suggestionFor("stale-lock-reset"),
		});
	} catch (err) {
		items.push({
			status: "info",
			message: `Run lock check skipped: ${err instanceof Error ? err.message : String(err)}`,
		});
	}
	return { title: SECTION_TITLE, items };
}
