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
 *   4. Feedback (D4 + D8) — after "Build a fix plan", one select per
 *      actionable item: its possible solutions (derived from
 *      `action-policy.decideAction` + `FixLevel` — Fix now / Manual step /
 *      Escalate) plus "Ignore (accept the risk)" / "Defer", with an
 *      "Accept all (recommended)" fast path. Ignored/deferred items are
 *      audited and never applied; the included set becomes the plan.
 *   5. GATE B — `confirm("Apply N fix(es)?", <the batch list>)`. Decline
 *      ends with zero writes; confirm continues.
 *   6. Apply — `runAllSafeRemediates` (only when an auto-safe item is
 *      included) + `dispatchOne` per included manual item.
 *   7. Verify — `reRun()`; notify the result. (GATE C + the no-auto
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
import { decideAction } from "./action-policy.js";
import type { FixAction } from "./failure-taxonomy.js";
import { recordFixAudit, type FixDecision } from "./fix-audit.js";
import { sectionId } from "./report-schema.js";
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

/**
 * One planned repair item: the actionable item plus its derived solution
 * (`decideAction`) and the feedback decision it carries through the session.
 */
interface RepairItem {
	/** The item shown/ dispatched (stable `ActionableItem` shape). */
	item: ActionableItem;
	/** The possible solution derived from `action-policy.decideAction`. */
	action: FixAction;
	/** Best-effort fingerprint for the audit journal. */
	fingerprint: string;
	/** Resolved GATE-A feedback decision (defaults to `"applied"`). */
	decision: FixDecision;
}

/** Partitioned view over one source: what the batch will do vs what stays manual. */
interface RepairView {
	/** Every actionable item, in source order (for Show details + dispatch). */
	items: RepairItem[];
	/** Fix fingerprints the batch will run (auto-safe / preflight `autoFixable`). */
	autoNames: string[];
	/** Items that need a manual command (never auto-executed). */
	manual: RepairItem[];
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
 * Each item also carries its derived possible solution (D8) and a
 * fingerprint for the audit journal.
 * @param {RepairSessionSource} source - Preflight findings or a doctor report.
 * @returns {RepairView} Items + auto batch names + manual remainder.
 */
function buildView(source: RepairSessionSource): RepairView {
	if (source.kind === "preflight") {
		const relevant = source.findings.filter((f) => f.blocking || f.autoFixable);
		const items: RepairItem[] = relevant.map((f, i) => {
			const item: ActionableItem = {
				index: i,
				section: "Preflight",
				status: f.blocking ? ("error" as const) : ("warning" as const),
				message: f.item.message,
				suggestion: f.item.suggestion ?? "",
				level: (levelFor(f.fingerprint as SuggestionKey) ?? "interactive") as FixLevel,
			};
			const action: FixAction = f.autoFixable ? "auto-safe" : decideAction("Preflight", item);
			return { item, action, fingerprint: f.fingerprint, decision: "applied" };
		});
		return {
			items,
			autoNames: items.filter((p) => p.action === "auto-safe").map((p) => p.fingerprint),
			manual: items.filter((p) => p.action !== "auto-safe"),
		};
	}
	const items = listActionableItems(source.report);
	const idByTitle = new Map(source.report.sections.map((s) => [s.title, sectionId(s)] as const));
	const planned: RepairItem[] = items.map((item) => {
		const sid = idByTitle.get(item.section) ?? item.section;
		return {
			item,
			action: decideAction(sid, item),
			fingerprint: keyForSuggestion(item.suggestion) ?? sid,
			decision: "applied",
		};
	});
	return {
		items: planned,
		autoNames: planned.filter((p) => p.action === "auto-safe").map((p) => p.fingerprint),
		manual: planned.filter((p) => p.action !== "auto-safe"),
	};
}

/** D8 menu labels — the possible solutions for one actionable item. */
const AUTO_LABEL = "Fix now (auto-safe)";
const MANUAL_LABEL = "Manual step (`/velpari-*`)";
const ESCALATE_LABEL = "Escalate (manual — store integrity)";
const IGNORE_LABEL = "Ignore (accept the risk)";
const DEFER_LABEL = "Defer";
const ACCEPT_ALL_LABEL = "Accept all (recommended)";

/**
 * The label for one derived solution (D8). `agentic` and `manual` both
 * route through the manual `/velpari-*` handoff; `escalate` (store
 * integrity — human) gets its own row.
 * @param {FixAction} action - The derived solution action.
 * @returns {string} The menu/plan label.
 */
function labelFor(action: FixAction): string {
	if (action === "auto-safe") return AUTO_LABEL;
	if (action === "escalate") return ESCALATE_LABEL;
	return MANUAL_LABEL;
}

/**
 * The D8 option rows for one item: the derived primary solution, an
 * optional safe alternative, then Ignore/Defer (D4 exclude/defer).
 * @param {FixAction} action - The derived solution action.
 * @returns {string[]} The option labels (without the accept-all fast path).
 */
function solutionOptions(action: FixAction): string[] {
	const primary = labelFor(action);
	const alternatives = action === "auto-safe" ? [MANUAL_LABEL] : [];
	return [primary, ...alternatives, IGNORE_LABEL, DEFER_LABEL];
}

/**
 * D4 + D8 — the per-item feedback pass. Each item gets its possible
 * solutions (from `decideAction`) plus Ignore/Defer, with an
 * "Accept all (recommended)" fast path. Mutates each item's `decision`
 * (and `action`, when a non-default solution is picked).
 * @param {RepairSessionUi} ui - UI primitives (`select` is present).
 * @param {RepairItem[]} items - The planned items to resolve.
 * @returns {Promise<boolean>} false when the user cancelled (caller aborts).
 */
async function collectFeedback(ui: RepairSessionUi, items: RepairItem[]): Promise<boolean> {
	if (typeof ui.select !== "function") return false;
	let acceptAll = false;
	for (let i = 0; i < items.length; i++) {
		const planned = items[i]!;
		if (acceptAll) {
			planned.decision = "applied";
			continue;
		}
		const choice = await ui.select(`Issue ${i + 1}/${items.length}: ${planned.item.message}`, [
			ACCEPT_ALL_LABEL,
			...solutionOptions(planned.action),
		]);
		if (choice === null || choice === undefined) return false;
		if (choice.startsWith("Accept all")) {
			acceptAll = true;
			planned.decision = "applied";
			continue;
		}
		if (choice.startsWith("Ignore")) {
			planned.decision = "ignored";
			continue;
		}
		if (choice.startsWith("Defer")) {
			planned.decision = "deferred";
			continue;
		}
		// A solution label (or an unrecognized label → keep the derived solution).
		if (choice.startsWith("Manual step")) planned.action = "manual";
		else if (choice.startsWith("Escalate")) planned.action = "escalate";
		else if (choice.startsWith("Fix now")) planned.action = "auto-safe";
		planned.decision = "applied";
	}
	return true;
}

/**
 * Best-effort audit row for one GATE-A feedback decision (D4).
 * `recordFixAudit` never throws, so this can never break the session.
 * @param {RepairItem} planned - The resolved item.
 * @param {string} cwd - Project root.
 * @param {boolean} ok - Whether the item was applied cleanly.
 */
function auditDecision(planned: RepairItem, cwd: string, ok: boolean): void {
	recordFixAudit(
		{
			at: new Date().toISOString(),
			fingerprint: planned.fingerprint,
			ok,
			changedFiles: [],
			decision: planned.decision,
		},
		cwd,
	);
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
 * The gated repair session — Analyze → Report → GATE A → Feedback →
 * GATE B → Apply → Verify. Never throws; every side effect is gated
 * behind GATE B (decline → `{ action: "aborted" }`, zero writes).
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
			for (const planned of view.items) {
				const { item } = planned;
				opts.ui.notify(`[${item.status}] ${item.section} — ${item.message}\n  → ${item.suggestion}`, "info");
			}
			continue; // re-ask (loop back to select)
		}
		// "Build a fix plan" — or any unrecognized label: treat as continue.
		break;
	}

	// D4 + D8 — per-item feedback pass (include / exclude / defer + solutions).
	// Cancelling the pass aborts with zero writes.
	const collected = await collectFeedback(opts.ui, view.items);
	if (!collected) return { action: "aborted", reason: "user cancelled feedback" };

	const included = view.items.filter((p) => p.decision === "applied");
	const excluded = view.items.filter((p) => p.decision !== "applied");
	// Excluded / deferred items are recorded but never applied (D4).
	for (const planned of excluded) auditDecision(planned, opts.cwd, false);
	if (included.length === 0) {
		opts.ui.notify("No items selected — nothing to apply.", "info");
		return { action: "aborted", reason: "nothing selected" };
	}

	const includedAuto = included.filter((p) => p.action === "auto-safe");
	const includedManual = included.filter((p) => p.action !== "auto-safe");

	// GATE B — the plan + batch list is shown FIRST; decline = zero writes.
	if (typeof opts.ui.confirm !== "function") {
		return { action: "aborted", reason: "no confirm primitive available" };
	}

	const planLines = included.map((p) => `  - [${labelFor(p.action)}] ${p.item.message}`);
	// The safe batch is atomic (full whitelist); it only runs when at least one
	// auto-safe item is included. Manual lines are the included manual remainder.
	const batchLines = [
		...(includedAuto.length > 0 ? Array.from(SAFE_WHITELIST) : []),
		...includedManual.map((m) => `manual: ${m.item.message}`),
	];
	const batchList =
		`Your plan:\n${planLines.join("\n")}\n\n` +
		batchLines.map((l) => `  - ${l}`).join("\n") +
		(includedManual.length > 0
			? `\n${includedManual.length} item(s) need a manual /velpari-* command after the automatic fixes.`
			: "") +
		(excluded.length > 0 ? `\n${excluded.length} item(s) excluded/deferred (recorded, not applied).` : "");

	const confirmed = await opts.ui.confirm(`Apply ${batchLines.length} fix(es)?`, batchList);
	if (!confirmed) {
		return { action: "aborted", reason: "user declined batch" }; // zero writes
	}

	// Apply — the safe batch (skipped when no auto-safe item is included) then
	// the included manual remainder.
	const runAuto = opts.runAuto ?? (async () => runAllSafeRemediates({ cwd: opts.cwd, projectName: opts.projectName }));
	if (includedAuto.length > 0) {
		try {
			await runAuto();
		} catch (err) {
			opts.ui.notify(`Auto-fix batch failed: ${(err as Error)?.message ?? String(err)}`, "warning");
		}
	}

	if (opts.dispatchOne) {
		for (const planned of includedManual) {
			try {
				await opts.dispatchOne(planned.item);
				auditDecision(planned, opts.cwd, true);
			} catch (err) {
				opts.ui.notify(`Fix dispatch failed: ${(err as Error)?.message ?? String(err)}`, "warning");
				auditDecision(planned, opts.cwd, false);
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

	const remainingManual = clean ? 0 : includedManual.length;
	return { action: "fixed", remainingManual };
}
