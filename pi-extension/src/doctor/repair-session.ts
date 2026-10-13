/**
 * Gated repair session — DGR P0 (D1 / D2 / D6 / D9).
 *
 * The gated counterpart to the one-confirm `runFixFlow` auto path
 * (`doctor/fix-flow.ts`, preserved unchanged as the explicit
 * `--velpari-auto-fix` entry point). This module runs the
 * `Analyze → Report → GATE A → Plan → GATE B → Apply → Verify` stage
 * machine: every gate blocks for the developer, and **nothing is
 * written before GATE B** (decline at either gate = zero writes).
 *
 * Stage machine:
 *   1. Analyze/Report — the caller already ran `runDoctor`; `notify` the summary.
 *   2. GATE A — `select("Doctor found N issue(s)", [Show details, Build a fix plan, Abort])`.
 *      Show details lists each actionable item then re-asks; Abort ends
 *      with zero writes; Build a fix plan continues.
 *   3. Plan — build the batch list (auto-safe whitelist + manual items),
 *      exactly as `fix-flow.ts` does today.
 *   4. GATE B — `confirm("Apply N fix(es)?", <the batch list>)`. Decline
 *      ends with zero writes; confirm continues.
 *   5. Apply — `runAllSafeRemediates` + `dispatchOne` per manual item.
 *   6. Verify — `reRun()`; notify the result. (GATE C + the no-auto
 *      guarantee land in DGR P2; P0 stops here after one pass.)
 *
 * Non-interactive degrade (the `fix-flow.ts` precedent): if `ui.select`
 * is absent → `{action:"aborted", reason:"non-interactive"}` (never hang).
 *
 * Layer 1: uses the injected `RepairSessionUi` primitives directly (the
 * `fix-flow.ts` precedent) — no `ui/` import, no `doctor/index.ts`
 * import (the re-audit reaches `runDoctor` only through the caller's
 * `reRun` closure). No write happens before GATE B.
 */

import type { DiagnosticReport } from "./_types.js";
import { runAllSafeRemediates } from "./remediate.js";
import { listActionableItems, type ActionableItem } from "./fix-dispatch.js";
import { SAFE_WHITELIST, SUGGESTIONS, levelFor, type FixLevel, type SuggestionKey } from "./checks/fix-suggestions.js";
import type { PreflightFinding } from "./preflight.js"; // type-only: no runtime cycle

/** The Pi UI primitives the gated session needs (absent functions degrade, never hang). */
export interface RepairSessionUi {
	/** Report a line to the TUI footer/chat. */
	notify(message: string, kind?: string): void;
	/** Show a picker; resolves to the picked label, or null/undefined on cancel. */
	select?(title: string, labels: string[]): Promise<string | null | undefined>;
	/** yes/no gate; resolves to false on decline. */
	confirm?(title: string, message?: string): Promise<boolean>;
}

/** Where the actionable items come from (preflight findings or a doctor report). */
export type RepairSessionSource =
	| { kind: "doctor"; report: DiagnosticReport }
	| { kind: "preflight"; findings: PreflightFinding[] };

/** Everything one gated repair session needs — all side-effect paths injected. */
export interface RepairSessionOptions {
	/** UI primitives (notify always; select/confirm may be absent → degrade). */
	ui: RepairSessionUi;
	/** Project root (scoped remediates). */
	cwd: string;
	/** Configured project name ("" = remediates short-circuit). */
	projectName: string;
	/** The actionable source for this session. */
	source: RepairSessionSource;
	/** Re-audit after the batch (runDoctor for doctor, runPreflight for preflight). */
	reRun: () => Promise<{ ok: boolean; actionableCount: number }>;
	/** Per-item manual dispatch (caller supplies `dispatchFixChoice` for doctor). */
	dispatchOne?: (item: ActionableItem) => Promise<void>;
	/**
	 * The auto batch executor (defaults to `runAllSafeRemediates`) —
	 * injectable so tests can spy "zero remediate calls" on decline.
	 */
	runAuto?: () => Promise<unknown>;
}

/** Outcome of one gated repair session (two gates, one apply pass). */
export type RepairSessionOutcome =
	/** Batch ran (and/or manual dispatches happened) — check `remainingManual`. */
	| { action: "fixed"; remainingManual: number }
	/** User declined/aborted or the UI was non-interactive — zero writes. */
	| { action: "aborted"; reason: string }
	/** Nothing was actionable — caller proceeds/reports clean. */
	| { action: "no-actionables" };

/** Partitioned view over one source: what the batch will do vs what stays manual. */
interface RepairView {
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
 * Build the actionable partition for one source (mirrors
 * `fix-flow.ts:buildView`, kept local so the auto path stays untouched).
 * @param {RepairSessionSource} source - Preflight findings or a doctor report.
 * @returns {RepairView} Items + auto batch names + manual remainder.
 */
function buildView(source: RepairSessionSource): RepairView {
	if (source.kind === "preflight") {
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
 * Build the one-line summary the Report stage notifies (step 1).
 * @param {RepairSessionSource} source - Preflight findings or a doctor report.
 * @param {number} actionable - Number of actionable items.
 * @returns {string} A short human-readable summary line.
 */
function reportSummary(source: RepairSessionSource, actionable: number): string {
	if (source.kind === "doctor") {
		const { error, warning } = source.report.summary;
		return `Doctor: ${error} error(s), ${warning} warning(s) — ${actionable} actionable item(s).`;
	}
	const blocking = source.findings.filter((f) => f.blocking).length;
	return `Doctor: ${blocking} blocking finding(s) — ${actionable} actionable item(s).`;
}

/**
 * The gated repair session — Analyze → Report → GATE A → Plan → GATE B
 * → Apply → Verify. Never throws; every side effect is gated behind
 * GATE B (decline → `{ action: "aborted" }`, zero writes).
 * @param {RepairSessionOptions} opts - UI, cwd, project, source, reRun, optional dispatch/batch injectors.
 * @returns {Promise<RepairSessionOutcome>} fixed / aborted / no-actionables.
 */
export async function runRepairSession(opts: RepairSessionOptions): Promise<RepairSessionOutcome> {
	// Analyze / Plan (in-memory only — no writes).
	const view = buildView(opts.source);
	if (view.items.length === 0) return { action: "no-actionables" };

	// Non-interactive degrade: never hang without a picker.
	if (typeof opts.ui.select !== "function") {
		return { action: "aborted", reason: "non-interactive" };
	}

	// Report — the caller already ran the audit; surface the summary.
	opts.ui.notify(reportSummary(opts.source, view.items.length), "info");

	// GATE A — Show details loops back; Abort ends with zero writes.
	for (;;) {
		const choice = await opts.ui.select(`Doctor found ${view.items.length} issue(s)`, [
			"Show details",
			"Build a fix plan",
			"Abort",
		]);

		if (choice === null || choice === undefined || choice.startsWith("Abort")) {
			return { action: "aborted", reason: "user aborted" };
		}
		if (choice.startsWith("Show details")) {
			for (const item of view.items) {
				opts.ui.notify(`[${item.status}] ${item.section} — ${item.message}\n  → ${item.suggestion}`, "info");
			}
			continue; // re-ask (loop back to select)
		}
		// "Build a fix plan" — or any unrecognized label: treat as continue.
		break;
	}

	// GATE B — the batch list is shown FIRST; decline = zero writes.
	if (typeof opts.ui.confirm !== "function") {
		return { action: "aborted", reason: "no confirm primitive available" };
	}

	const batchLines = [...Array.from(SAFE_WHITELIST), ...view.manual.map((m) => `manual: ${m.message}`)];
	const batchList =
		batchLines.map((l) => `  - ${l}`).join("\n") +
		(view.manual.length > 0
			? `\n${view.manual.length} item(s) need a manual /velpari-* command after the automatic fixes.`
			: "");

	const confirmed = await opts.ui.confirm(`Apply ${batchLines.length} fix(es)?`, batchList);
	if (!confirmed) {
		return { action: "aborted", reason: "user declined batch" }; // zero writes
	}

	// Apply — the auto batch (whitelist → fn → try/catch) then the manual remainder.
	const runAuto = opts.runAuto ?? (async () => runAllSafeRemediates({ cwd: opts.cwd, projectName: opts.projectName }));
	try {
		await runAuto();
	} catch (err) {
		opts.ui.notify(`Auto-fix batch failed: ${(err as Error)?.message ?? String(err)}`, "warning");
	}

	if (opts.dispatchOne) {
		for (const item of view.manual) {
			try {
				await opts.dispatchOne(item);
			} catch (err) {
				opts.ui.notify(`Fix dispatch failed: ${(err as Error)?.message ?? String(err)}`, "warning");
			}
		}
	}

	// Verify — one re-audit; P0 stops here (no retry loop).
	const fresh = await opts.reRun();
	const clean = fresh.ok && fresh.actionableCount === 0;
	if (clean) {
		opts.ui.notify("Repair complete — re-audit clean.", "info");
	} else {
		opts.ui.notify(
			`${fresh.actionableCount} item(s) remain after the fixes — fix the manual items below, then re-run the command.`,
			"warning",
		);
	}

	const remainingManual = clean ? 0 : view.manual.length;
	return { action: "fixed", remainingManual };
}
