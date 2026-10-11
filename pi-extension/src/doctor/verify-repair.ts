/**
 * Bounded verify → repair → re-verify contract (Doctor v2, Phase 2 / T3 + U4).
 *
 * Pure decision helpers only — no imports, no I/O. `fix-flow.ts` owns the
 * loop; this module owns the *condition* (keep retrying while the doctor is
 * still dirty, still has actionable items, and the attempt budget is not
 * exhausted). Keeping it here makes the cap trivially unit-testable and keeps
 * the loop condition in exactly one place.
 */

/** Result of one re-audit, reduced to what the repair loop needs to decide. */
export interface VerifyOutcome {
	/** Whether the audit passed (`runDoctor`/`runPreflight` `ok`). */
	ok: boolean;
	/** Number of actionable items (blocking or auto-fixable) still open. */
	actionableCount: number;
}

/** Retry cap used when the caller does not pass `maxAttempts` to the fix flow. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Decide whether the repair loop may run one more attempt.
 *
 * True iff the last audit was dirty (`!last.ok`), still has actionable work
 * (`last.actionableCount > 0`), and the attempts performed so far are below
 * the hard cap. Pure — same inputs always give the same answer.
 *
 * @param {number} attempts - Attempts already performed (1-based count).
 * @param {number} max - Hard cap on attempts (never exceeded).
 * @param {VerifyOutcome} last - The most recent re-audit result.
 * @returns {boolean} Whether one more verify → repair → re-verify pass is allowed.
 */
export function shouldContinue(attempts: number, max: number, last: VerifyOutcome): boolean {
	return !last.ok && last.actionableCount > 0 && attempts < max;
}
