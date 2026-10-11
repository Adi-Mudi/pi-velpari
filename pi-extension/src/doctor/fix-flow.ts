/**
 * Chat fix flow — Phase C (G7 / N22), Doctor v2.
 *
 * The AskUserQuestion-parity 3-option flow that replaces the
 * single-item picker as the `--velpari-fix` entry point (user decision
 * D-C2, 2026-09-28): **Fix all (Recommended) / Show details / Abort**.
 *
 * Write discipline (N23): nothing is written until the user sees the
 * batch list (`Apply N fix(es): …`) and confirms. Decline = zero
 * writes. The auto batch runs the EXISTING Level-B loop
 * (`runAllSafeRemediates` — whitelist check → registered fn →
 * try/catch); manual items go through the injected per-item dispatch
 * (`fix-dispatch.ts:dispatchFixChoice`, supplied by the caller); then a
 * bounded verify → repair → re-verify loop
 * (`verify-repair.ts:shouldContinue`) decides the outcome. The batch is
 * confirmed ONCE; retries re-run the SAME approved batch with **no new
 * prompts**, up to `maxAttempts` (default 3) — never an infinite loop.
 *
 * Layer 1: uses the injected `PreflightUi` primitives directly (the
 * scan-gate precedent) — no `ui/` import, no `doctor/index.ts` import
 * (the re-audit reaches `runDoctor` only through the caller's `reRun`
 * closure). **N23 invariant:** no approve/publish import anywhere in
 * this module, asserted by test + import scan.
 *
 * Recursion contract (v1.3, B#7 re-investigation — accept with evidence):
 * this flow NEVER re-enters itself. The `for(;;)` select loop below
 * re-asks only after "Show details" / an interactive fixable selection;
 * the bounded repair loop re-runs the SAME confirmed batch up to
 * `maxAttempts` and never calls `runFixFlow` again; `reRun` only
 * re-audits (runPreflight / runDoctor — neither calls runFixFlow);
 * `dispatchOne` walks manual items linearly; and `remediateOne` has no
 * path back into the flow. Re-entry from outside requires a fresh user
 * command (`/velpari-doctor --fix`) — user-gated, not code recursion.
 */

import type { DiagnosticReport } from "./_types.js";
import { runAllSafeRemediates } from "./remediate.js";
import { listActionableItems, type ActionableItem } from "./fix-dispatch.js";
import { SAFE_WHITELIST, SUGGESTIONS, levelFor, type FixLevel, type SuggestionKey } from "./checks/fix-suggestions.js";
import { DEFAULT_MAX_ATTEMPTS, shouldContinue, type VerifyOutcome } from "./verify-repair.js";
import type { PreflightFinding } from "./preflight.js"; // type-only: no runtime cycle

/** The Pi UI primitives the flow needs (absent functions degrade, never hang). */
export interface PreflightUi {
	/** Report a line to the TUI footer/chat. */
	notify(message: string, kind?: string): void;
	/** Show a picker; resolves to the picked label, or null/undefined on cancel. */
	select?(title: string, labels: string[]): Promise<string | null | undefined>;
	/** yes/no gate; resolves to false on decline. */
	confirm?(title: string, message?: string): Promise<boolean>;
}

/** Outcome of one fix-flow invocation (one confirm, up to `maxAttempts` repair passes). */
export type FixFlowOutcome =
	/** Batch ran (and/or manual dispatches happened) — check `remainingManual`. */
	| { action: "fixed"; remainingManual: number }
	/** User declined, aborted, or the UI was non-interactive — zero writes. */
	| { action: "aborted"; reason: string }
	/** Nothing was actionable — caller proceeds/reports clean. */
	| { action: "no-actionables" };

/** Where the actionable items come from (preflight findings or a doctor report). */
export type FixFlowSource =
	| { kind: "preflight"; findings: PreflightFinding[] }
	| { kind: "doctor"; report: DiagnosticReport };

/** Everything one fix-flow attempt needs — all side-effect paths injected. */
export interface FixFlowOptions {
	/** UI primitives (notify always; select/confirm may be absent → degrade). */
	ui: PreflightUi;
	/** Project root (scoped remediates). */
	cwd: string;
	/** Configured project name ("" = remediates short-circuit). */
	projectName: string;
	/** The actionable source for this attempt. */
	source: FixFlowSource;
	/** Re-audit after the batch (runDoctor for doctor, runPreflight for preflight). */
	reRun: () => Promise<{ ok: boolean; actionableCount: number }>;
	/** Per-item manual dispatch (caller supplies `dispatchFixChoice` for doctor). */
	dispatchOne?: (item: ActionableItem) => Promise<void>;
	/**
	 * The auto batch executor (defaults to `runAllSafeRemediates`) —
	 * injectable so tests can spy "zero remediate calls" on decline.
	 */
	runAuto?: () => Promise<unknown>;
	/**
	 * Hard cap on verify → repair → re-verify passes after the ONE confirm
	 * (defaults to `verify-repair.ts:DEFAULT_MAX_ATTEMPTS` = 3). Never exceeded.
	 */
	maxAttempts?: number;
}

/** Partitioned view over one source: what the batch will do vs what stays manual. */
interface FlowView {
	/** Every actionable item, in source order (for Show details + dispatch). */
	items: ActionableItem[];
	/** Fix fingerprints the batch will run (auto-safe / preflight `autoFixable`). */
	autoNames: string[];
	/** Items that need a manual command (never auto-executed). */
	manual: ActionableItem[];
}

/**
 * Reverse-map a suggestion TEXT back to its SUGGESTIONS key (the
 * dispatcher routes via suggestion text — `DiagnosticItem` has no
 * fingerprint field).
 * @param {string} suggestion - The item's suggestion text.
 * @returns {SuggestionKey | null} The key whose text matches, or null.
 */
function keyForSuggestion(suggestion: string): SuggestionKey | null {
	for (const [key, text] of Object.entries(SUGGESTIONS)) {
		if (text === suggestion) return key as SuggestionKey;
	}
	return null;
}

/**
 * Build the actionable partition for one source.
 * @param {FixFlowSource} source - Preflight findings or a doctor report.
 * @returns {FlowView} Items + auto batch names + manual remainder.
 */
function buildView(source: FixFlowSource): FlowView {
	if (source.kind === "preflight") {
		// Rows 4–8: blocking or auto-fixable findings are actionable;
		// non-blocking scaffold findings ride along in the batch (row 8).
		const relevant = source.findings.filter((f) => f.blocking || f.autoFixable);
		return {
			items: relevant.map((f, i) => ({
				index: i,
				section: "Preflight",
				status: f.blocking ? ("error" as const) : ("warning" as const),
				message: f.item.message,
				suggestion: f.item.suggestion ?? "",
				level: (levelFor(f.fingerprint as SuggestionKey) ?? "interactive") as FixLevel,
			})),
			autoNames: relevant.filter((f) => f.autoFixable).map((f) => f.fingerprint),
			manual: relevant
				.filter((f) => !f.autoFixable)
				.map((f, i) => ({
					index: i,
					section: "Preflight",
					status: "error" as const,
					message: f.item.message,
					suggestion: f.item.suggestion ?? "",
					level: "interactive" as FixLevel,
				})),
		};
	}
	const items = listActionableItems(source.report);
	const autoNames: string[] = [];
	const manualIdx: number[] = [];
	items.forEach((item, i) => {
		const key = keyForSuggestion(item.suggestion);
		if (key !== null && levelFor(key) === "auto-safe") autoNames.push(key);
		else manualIdx.push(i);
	});
	return {
		items,
		autoNames,
		manual: manualIdx.map((i) => items[i]!),
	};
}

/**
 * The N22 chat fix flow — 3-option select → confirm-gated batch →
 * one re-audit. Never throws; every side effect is gated behind the
 * confirm (decline → `{ action: "aborted" }`, zero writes).
 * @param {FixFlowOptions} opts - UI, cwd, project, source, reRun, optional dispatch/batch injectors.
 * @returns {Promise<FixFlowOutcome>} fixed / aborted / no-actionables.
 */
export async function runFixFlow(opts: FixFlowOptions): Promise<FixFlowOutcome> {
	const view = buildView(opts.source);
	if (view.items.length === 0) return { action: "no-actionables" };

	// Non-interactive degrade (row 10 pattern): never hang without a picker.
	if (typeof opts.ui.select !== "function") {
		return { action: "aborted", reason: "non-interactive — run /velpari-doctor --velpari-fix in a terminal" };
	}

	for (;;) {
		const choice = await opts.ui.select("Fix", ["Fix all (Recommended)", "Show details", "Abort"]);

		if (choice === null || choice === undefined || choice.startsWith("Abort")) {
			return { action: "aborted", reason: "user aborted" };
		}
		if (choice.startsWith("Show details")) {
			for (const item of view.items) {
				opts.ui.notify(`[${item.status}] ${item.section} — ${item.message}\n  → ${item.suggestion}`, "info");
			}
			continue; // re-ask (loop back to select)
		}
		// "Fix all (Recommended)" — or any unrecognized label: treat as Fix all
		// (the picker only offers the three labels above).
		if (typeof opts.ui.confirm !== "function") {
			return { action: "aborted", reason: "no confirm primitive available" };
		}
		if (view.autoNames.length === 0 && view.manual.length === 0) {
			return { action: "no-actionables" };
		}

		// Build the batch list FIRST — the user sees exactly what will run.
		const batchLines = [...Array.from(SAFE_WHITELIST), ...view.manual.map((m) => `manual: ${m.message}`)];
		const applyMsg =
			`Apply ${batchLines.length} fix(es):\n` +
			batchLines.map((l) => `  - ${l}`).join("\n") +
			(view.manual.length > 0
				? `\n${view.manual.length} item(s) need a manual /velpari-* command after the automatic fixes.`
				: "");

		const confirmed = await opts.ui.confirm("Apply fixes", applyMsg);
		if (!confirmed) {
			return { action: "aborted", reason: "user declined batch" }; // zero writes
		}

		const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
		let attempts = 0;
		let fresh: VerifyOutcome = { ok: false, actionableCount: view.items.length };
		const runAuto =
			opts.runAuto ?? (async () => runAllSafeRemediates({ cwd: opts.cwd, projectName: opts.projectName }));

		// Bounded verify → repair → re-verify (T3). The confirm above is the
		// ONE prompt; every pass below re-runs the SAME approved batch (no new
		// prompts), re-audits, then lets `shouldContinue` decide whether the
		// attempt budget allows another pass. Never exceeds `maxAttempts`.
		for (;;) {
			attempts++;

			// Auto batch — the existing Level-B loop (whitelist → fn → try/catch).
			// C-F2 (v1.2): runs after every confirm — the confirm list IS the
			// whitelist, so display and executor cannot diverge (the old
			// autoNames>0 gate skipped the batch whenever no suggestion text
			// reverse-mapped while the user had just confirmed the full safe list).
			try {
				await runAuto();
			} catch (err) {
				opts.ui.notify(`Auto-fix batch failed: ${(err as Error)?.message ?? String(err)}`, "warning");
			}

			// Manual remainder — caller's per-item dispatch (absent in preflight:
			// manual preflight rows are Abort-only by the decision table).
			if (opts.dispatchOne) {
				for (const item of view.manual) {
					try {
						await opts.dispatchOne(item);
					} catch (err) {
						opts.ui.notify(`Fix dispatch failed: ${(err as Error)?.message ?? String(err)}`, "warning");
					}
				}
			}

			// Re-audit, then decide. The condition lives in `shouldContinue` (pure).
			fresh = await opts.reRun();
			const clean = fresh.ok && fresh.actionableCount === 0;
			// C-F4 (Phase 4): `fresh.actionableCount` counts ALL actionable items,
			// not just manual ones — reporting it as "remaining manual" overcounted.
			// The notify below already reports the accurate actionable total.
			if (!clean) {
				opts.ui.notify(
					`Attempt ${attempts}/${maxAttempts}: ${fresh.actionableCount} item(s) remain after the batch — fix the manual items below, then re-run the command.`,
					"warning",
				);
			} else {
				opts.ui.notify(`Attempt ${attempts}/${maxAttempts}: clean.`, "info");
			}

			if (!shouldContinue(attempts, maxAttempts, fresh)) break;
		}

		const clean = fresh.ok && fresh.actionableCount === 0;
		const remainingManual = clean ? 0 : view.manual.length;
		return { action: "fixed", remainingManual };
	}
}
