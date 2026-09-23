/**
 * SCAN-gate picker (Layer 1 — stages/brainstorm).
 *
 * Renders the mandatory "which scans should run?" picker at the brainstorm
 * SCAN step. v2.1 lifecycle upgrade — there is NO default; the developer
 * always chooses.
 *
 * Lives at L1 (not in ui/) because the state tool needs to invoke it
 * from inside its action handler, and L1 cannot import from L2 (the
 * ui/ folder). scan-gate.ts is brainstorm-specific, not a generic TUI
 * widget, so this placement matches the brainstorm sub-module pattern.
 *
 * Uses native pi UI primitives:
 *   - ctx.ui.select    for the main choice (run-all / subset / adjust / skip)
 *   - ctx.ui.confirm   for the per-scan Adjust path (one yes/no each)
 *   - ctx.ui.input     for the freeform "Type something..." row (AskUserQuestion parity)
 *   - ctx.ui.notify    for the consent prompt when community is included
 *
 * Returns a ScanGateResult with `scans`, `cancelled`, and `freeform` flags
 * so the caller (state tool) can distinguish "user skipped scans" from
 * "user cancelled the picker" from "user typed custom scans".
 *
 * Config-aware: unavailable scans (per `getAvailableScanTypes`) are
 * hidden from the picker so a doc-only project doesn't get a confusing
 * "Run code scan" choice.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { FilesConfig } from "../../core/config.js";
import { availableScanList, getAvailableScanTypes, type AvailableScans } from "../../core/scan-options.js";
import type { ScanType } from "../../core/state.js";

interface ScanGateOptions {
	/** FilesConfig from .pi/velpari/files.json (v4). */
	config: FilesConfig;
	/** Project cwd for filesystem probes (defaults to process.cwd()). */
	cwd?: string;
}

/**
 * Rich result object. Lets the state tool distinguish:
 *   - {scans: [], cancelled: false} — user picked "Skip scans"
 *   - {scans: [], cancelled: true } — user cancelled the picker (Esc)
 *   - {scans: [...], freeform: true} — user typed a custom subset
 */
export interface ScanGateResult {
	scans: ScanType[];
	cancelled: boolean;
	freeform: boolean;
}

/**
 * Run the SCAN-gate picker.
 *
 * The picker ALWAYS asks. Returns:
 *   - {scans: [...], cancelled: false, freeform: false} when the user picked
 *     one of the structured branches
 *   - {scans: [],      cancelled: false, freeform: false} when the user
 *     picked "Skip scans"
 *   - {scans: [],      cancelled: true,  freeform: false} when the user
 *     pressed Esc / cancelled the picker (no choice was made)
 *   - {scans: [...],   cancelled: false, freeform: true}  when the user
 *     typed a custom subset via the freeform "Type something..." row
 *
 * If `ctx.ui.select` is not available (test fallback), the picker
 * returns the cancelled sentinel.
 */
export async function runScanGatePicker(
	ctx: ExtensionCommandContext,
	options: ScanGateOptions,
): Promise<ScanGateResult> {
	const available = getAvailableScanTypes(options.config, options.cwd);
	const scans = availableScanList(available);

	// Defensive: ctx or ctx.ui may be missing in test mocks. Bail to
	// "cancelled" so the parent LLM falls back to inline research only.
	if (!ctx || !ctx.ui || typeof ctx.ui.select !== "function") {
		return { scans: [], cancelled: true, freeform: false };
	}

	if (scans.length === 0) {
		// No scans available — there is always community, so this branch
		// is unreachable today. Kept as a safety guard for the future
		// (community could become gated).
		return { scans: [], cancelled: true, freeform: false };
	}

	const labels = buildMainLabels(available);
	const choice = await ctx.ui.select("Which scans should run for this brainstorm?", labels);
	if (!choice) return { scans: [], cancelled: true, freeform: false };

	// The freeform "Type something..." row is always last. AskUserQuestion
	// parity — Claude Code's picker auto-injects a free-text escape.
	if (choice === labels[labels.length - 1]) {
		return await runFreeform(ctx, scans);
	}

	if (choice === labels[0]) {
		// Run all available. Community still needs explicit consent.
		if (available.community) {
			const ok = await ctx.ui.confirm(
				"Community scan = web search (FR-52 consent).",
				"This will search the public web. Confirm?",
			);
			if (!ok) return await runAdjust(ctx, available);
		}
		return { scans, cancelled: false, freeform: false };
	}

	if (choice === labels[1]) {
		// Run code + doc only (community excluded even when available)
		const subset: ScanType[] = [];
		if (available.code) subset.push("code");
		if (available.doc) subset.push("doc");
		return { scans: subset, cancelled: false, freeform: false };
	}

	if (choice === labels[2]) {
		// Community only — needs consent
		if (!available.community) {
			return { scans: [], cancelled: false, freeform: false };
		}
		const ok = await ctx.ui.confirm(
			"Community scan = web search (FR-52 consent).",
			"This will search the public web. Confirm?",
		);
		if (!ok) return await runAdjust(ctx, available);
		return { scans: ["community"], cancelled: false, freeform: false };
	}

	if (choice === labels[3]) {
		return await runAdjust(ctx, available);
	}

	// "Skip scans" — second-to-last label
	return { scans: [], cancelled: false, freeform: false };
}

/**
 * Adjust path — one ctx.ui.confirm per available scan. Returns the
 * subset the user opted into.
 */
async function runAdjust(ctx: ExtensionCommandContext, available: AvailableScans): Promise<ScanGateResult> {
	const out: ScanType[] = [];

	if (typeof ctx.ui.confirm !== "function") {
		return { scans: out, cancelled: false, freeform: false };
	}

	if (available.code) {
		const yes = await ctx.ui.confirm("Run CODE scan?", "Read local source files for extraction.");
		if (yes) out.push("code");
	}

	if (available.doc) {
		const yes = await ctx.ui.confirm("Run DOC scan?", "Read existing project docs for prior decisions.");
		if (yes) out.push("doc");
	}

	if (available.community) {
		const yes = await ctx.ui.confirm("Run COMMUNITY scan? (FR-52 consent)", "This will search the public web.");
		if (yes) out.push("community");
	}

	return { scans: out, cancelled: false, freeform: false };
}

/**
 * Freeform row — AskUserQuestion "Type something..." parity.
 *
 * The user types comma-separated scan names. We parse + filter to the
 * available set, ignoring unknown names. Empty input → cancelled.
 */
async function runFreeform(ctx: ExtensionCommandContext, available: ScanType[]): Promise<ScanGateResult> {
	if (typeof ctx.ui.input !== "function") {
		return { scans: [], cancelled: true, freeform: false };
	}
	const raw = await ctx.ui.input(`Type scans (comma-separated): ${available.join(", ")}`);
	if (!raw || !raw.trim()) {
		return { scans: [], cancelled: true, freeform: false };
	}
	const parsed = raw
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter((s): s is ScanType => (available as readonly string[]).includes(s));
	return { scans: parsed, cancelled: false, freeform: true };
}

/**
 * Build the labels for the main picker. Dynamically hides options that
 * don't apply given current availability.
 */
function buildMainLabels(available: AvailableScans): string[] {
	const labels: string[] = [];

	const availableSet = availableScanList(available);
	if (availableSet.length > 0) {
		const suffix = unavailableSuffix(available);
		labels.push(
			availableSet.length === availableScanList(available).length
				? `Run all (${availableSet.join(" + ")})`
				: `Run all available (${availableSet.join(" + ")})${suffix}`,
		);
	}

	// Code + doc subset only available when at least one is available
	if (available.code || available.doc) {
		const which = [available.code ? "code" : null, available.doc ? "doc" : null].filter(Boolean).join(" + ");
		const why = !available.code || !available.doc ? " (one unavailable)" : "";
		labels.push(`Run ${which} only${why}`);
	}

	if (available.community) {
		labels.push("Run community only (web search — FR-52 consent)");
	}

	labels.push("Adjust (pick per-scan)");
	labels.push("Skip scans (inline research only)");
	// Freeform row — AskUserQuestion "Type something..." parity. Always last.
	labels.push(`Type something... (freeform — name the scans)`);

	return labels;
}

/** Returns a parenthesized reason when at least one scan is unavailable. */
function unavailableSuffix(available: AvailableScans): string {
	const parts: string[] = [];
	if (!available.code) parts.push("code unavailable");
	if (!available.doc) parts.push("doc unavailable");
	return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

// v1.x — re-open the SCAN picker for scans the developer did NOT pick at the
// upfront gate. Used during the DISCUSS loop when the developer mentions
// community / web / official / industrial and the active brainstorm has
// not opted in yet. Hides the already-selected scans; community consent
// (FR-52) preserved when community ends up in the picked set.
export async function runExtraScanPicker(
	ctx: ExtensionCommandContext,
	options: ScanGateOptions & { alreadySelected: readonly ScanType[] },
): Promise<ScanGateResult> {
	if (!ctx || !ctx.ui || typeof ctx.ui.select !== "function") {
		return { scans: [], cancelled: true, freeform: false };
	}
	const available = getAvailableScanTypes(options.config, options.cwd);
	const allScans = availableScanList(available);
	const missing = allScans.filter((s) => !(options.alreadySelected as readonly ScanType[]).includes(s));
	if (missing.length === 0) {
		// Nothing to add — return ok so the caller can skip the picker.
		return { scans: [], cancelled: false, freeform: false };
	}
	const labels: string[] = [`Add all missing (${missing.join(", ")})`];
	for (const s of missing) {
		labels.push(`Add ${s} only`);
	}
	labels.push("Skip — inline research only");
	const choice = await ctx.ui.select("Which additional scans do you want for this brainstorm?", labels);
	if (!choice) return { scans: [], cancelled: true, freeform: false };
	if (choice === labels[labels.length - 1]) {
		return { scans: [], cancelled: false, freeform: false };
	}
	if (choice === labels[0]) {
		if (missing.includes("community")) {
			const ok = await ctx.ui.confirm(
				"Community scan = web search (FR-52 consent).",
				"This will search the public web. Confirm?",
			);
			if (!ok) return { scans: [], cancelled: false, freeform: false };
		}
		return { scans: missing, cancelled: false, freeform: false };
	}
	// "Add <scan> only" — index 1..missing.length
	const idx = labels.indexOf(choice);
	const picked = missing[idx - 1];
	if (!picked) return { scans: [], cancelled: true, freeform: false };
	if (picked === "community") {
		const ok = await ctx.ui.confirm(
			"Community scan = web search (FR-52 consent).",
			"This will search the public web. Confirm?",
		);
		if (!ok) return { scans: [], cancelled: false, freeform: false };
	}
	return { scans: [picked], cancelled: false, freeform: false };
}

/**
 * Per-dispatch consent prompt for a single web call. Returns `true` when
 * the developer confirmed; `false` on Esc / cancel / missing ui.confirm.
 * Used by the brainstorm state tool immediately before the parent LLM
 * calls `subagent()` for web-search-agent.
 *
 * The dispatcher keeps the FR-52 role anchor (web-search-agent ⇒ community
 * scan type). The parent LLM honors this consent result between
 * `confirm-web-dispatch` and `subagent()`; the dispatcher itself does not
 * re-check the ledger (kept simple — parent discipline is the gate).
 */
export async function runWebDispatchConsent(ctx: ExtensionCommandContext, topic: string): Promise<boolean> {
	if (!ctx || !ctx.ui || typeof ctx.ui.confirm !== "function") return false;
	return Boolean(
		await ctx.ui.confirm("Web search dispatch", `This scout will search the public web for: ${topic}\nConfirm?`),
	);
}
