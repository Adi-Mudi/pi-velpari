/**
 * Remediate orchestrator (Phase 2, Level B).
 *
 * Wraps the per-fingerprint `RemediateFn` registry
 * (`doctor/checks/remediate/index.ts`) with two safety rails:
 *
 *   1. SAFE_WHITELIST check (`doctor/checks/fix-suggestions.ts`) —
 *      fingerprints NOT in the whitelist throw. This means adding a
 *      new `"auto-safe"` entry to `FIX_LEVELS` without a paired
 *      whitelist entry + RemediateFn is a bug we catch at runtime,
 *      not silently.
 *
 *   2. try/catch around the registered `RemediateFn` — a thrown error
 *      becomes `{ ok: false, message }` instead of bubbling up. The
 *      dispatcher in `fix-dispatch.ts` aggregates failures and
 *      notifies the user without crashing the audit loop.
 *
 * The orchestrator NEVER calls `runDoctor` itself. Re-auditing after a
 * remediate run is the dispatcher's job (see
 * `doctor/fix-dispatch.ts:dispatchFixChoice` `kind: "all-safe"` branch
 * and the per-item `kind: "fix-one"` branch for `auto-safe` items).
 */

import { SAFE_WHITELIST } from "./checks/fix-suggestions.js";
import { REMEDIATE_FNS, type RemediateOutcome } from "./checks/remediate/index.js";

export interface RunRemediateOptions {
	cwd: string;
	projectName: string;
	fingerprint: string;
}

export interface RunRemediateResult {
	ok: boolean;
	/** Human-readable message for `ctx.ui.notify`. */
	message: string;
	/** Files the remediate fn actually modified (empty when `ok: false`). */
	changedFiles: string[];
}

/**
 * Run a single safe remediate fn. Defense in depth:
 *
 *   - `SAFE_WHITELIST.has(fingerprint)` throws when the fingerprint
 *     isn't explicitly cleared for auto-remediation.
 *   - `REMEDIATE_FNS[fingerprint]` throws when no RemediateFn is
 *     registered.
 *
 * The function returns a structured result; it never throws.
 */
export async function runRemediate(
	opts: RunRemediateOptions,
): Promise<RunRemediateResult> {
	if (!SAFE_WHITELIST.has(opts.fingerprint)) {
		throw new Error(
			`runRemediate: fingerprint "${opts.fingerprint}" is not in SAFE_WHITELIST. Refusing to auto-remediate.`,
		);
	}
	const fn = REMEDIATE_FNS[opts.fingerprint];
	if (!fn) {
		throw new Error(
			`runRemediate: no RemediateFn registered for "${opts.fingerprint}". Did you forget to add it to REMEDIATE_FNS in doctor/checks/remediate/index.ts?`,
		);
	}

	let outcome: RemediateOutcome;
	try {
		outcome = await fn({ cwd: opts.cwd, projectName: opts.projectName });
	} catch (err) {
		return {
			ok: false,
			message: `Remediate "${opts.fingerprint}" failed: ${(err as Error).message ?? String(err)}`,
			changedFiles: [],
		};
	}
	return {
		ok: true,
		message:
			outcome.changedFiles.length === 0
				? `Remediate "${opts.fingerprint}": nothing to fix (already clean).`
				: `Remediate "${opts.fingerprint}": rewrote ${outcome.changedFiles.length} file(s).`,
		changedFiles: outcome.changedFiles,
	};
}

/**
 * Run every safe remediate in turn (Phase 2 `kind: "all-safe"` branch).
 * Returns one `RunRemediateResult` per fingerprint in whitelist order.
 * Errors from one fn do NOT stop the others — each is wrapped in
 * try/catch.
 */
export async function runAllSafeRemediates(
	opts: Omit<RunRemediateOptions, "fingerprint">,
): Promise<RunRemediateResult[]> {
	const results: RunRemediateResult[] = [];
	for (const fp of SAFE_WHITELIST) {
		results.push(await runRemediate({ ...opts, fingerprint: fp }));
	}
	return results;
}
