/**
 * Orchestrator-level guard for doctor checks (D7 — "doctor ALWAYS renders").
 *
 * `runDoctor` invokes ~60 checks. Most self-guard their own I/O, but a
 * single unguarded throw would abort the whole audit — contradicting the
 * doctor's "always renders" contract. `safeSection` wraps one check thunk
 * so a throw becomes a rendered error section instead of a crash.
 *
 * L1 module: imports only `./_types.js` (no upward edges, no cycles).
 */

import type { DiagnosticSection } from "./_types.js";

/** Run one doctor check; a throw becomes a rendered error section, never a crash. */
export function safeSection(fn: () => DiagnosticSection): DiagnosticSection {
	try {
		return fn();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			title: "Check failed",
			items: [
				{
					status: "error",
					message: `A doctor check threw an error: ${msg}`,
					suggestion: "This is a doctor bug — the run continued past the failing check. Report it with this message.",
				},
			],
		};
	}
}
