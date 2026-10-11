/**
 * Check-mode + machine-report helpers (Doctor upgrade Phase 1 — lane a2,
 * subphase 1.4; contract T1/T2).
 *
 * The `/velpari-doctor` handler is interactive by default (chat report +
 * optional `--velpari-fix` picker). These pure helpers let the caller
 * opt into the two non-interactive paths wired in `commands/doctor.ts`:
 *
 *   - `--velpari-json`  → also write the versioned JSON report.
 *   - `--velpari-check` → report PASS/FAIL and set the process exit code
 *                         (0 = clean, 1 = errors) so CI can gate on it.
 *
 * Layer rule: L1 `doctor/` — imports L0 only (`_types.ts` is the same
 * layer). No IO, no UI.
 */

import type { DiagnosticReport } from "./_types.js";

/** Process exit code for a clean report (no errors). */
export const EXIT_OK = 0;

/** Process exit code when the report contains at least one error. */
export const EXIT_ERRORS = 1;

/**
 * Structural view of the extension API needed for flag lookup. Matches
 * the shape of `ExtensionAPI.getFlag` without coupling L1 to the Pi
 * package (the preflight module uses the same structural approach).
 */
export interface CheckModePi {
	/** Flag lookup (`--velpari-check` / `--velpari-json`). */
	getFlag?(name: string): unknown;
}

/**
 * Map a diagnostic report to a process exit code: `0` when the report
 * is ok, `1` when it carries errors. Pure — mirrors the report verdict
 * (`report.ok` is `summary.error === 0`).
 * @param {DiagnosticReport} report - The audit report.
 * @returns {number} `EXIT_OK` (0) or `EXIT_ERRORS` (1).
 */
export function exitCodeFor(report: DiagnosticReport): number {
	return report.ok ? EXIT_OK : EXIT_ERRORS;
}

/**
 * True when the user asked for non-interactive check mode.
 * @param {CheckModePi} [pi] - Extension API (flag lookup only).
 * @returns {boolean} Whether `--velpari-check` is set.
 */
export function isCheckMode(pi?: CheckModePi): boolean {
	return pi?.getFlag?.("velpari-check") === true;
}

/**
 * True when the user asked for the machine-readable JSON report.
 * @param {CheckModePi} [pi] - Extension API (flag lookup only).
 * @returns {boolean} Whether `--velpari-json` is set.
 */
export function isJsonMode(pi?: CheckModePi): boolean {
	return pi?.getFlag?.("velpari-json") === true;
}
