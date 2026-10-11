/**
 * Failure taxonomy → action policy (Doctor upgrade Phase 0 — contract C4).
 *
 * Ports the "classify the failure before acting" pattern from
 * self-healing-agent research (Monitor → Diagnose → Repair → Verify →
 * Learn) into the doctor: every actionable item gets a coarse
 * `FailureClass`, and the class (plus the item's fingerprint, when its
 * suggestion text resolves to one) maps to a `FixAction`.
 *
 * Pure — no IO, no state. The fingerprint bridge reads
 * `doctor/checks/fix-suggestions.ts` (`SUGGESTIONS`, `FIX_LEVELS` via
 * `levelFor`, `SAFE_WHITELIST`) so the taxonomy can never disagree with
 * the actual repair policy.
 */

import { SUGGESTIONS, SAFE_WHITELIST, levelFor, type SuggestionKey } from "./checks/fix-suggestions.js";

/** Coarse failure classes the doctor can hit. */
export type FailureClass =
	| "config-broken"
	| "state-unreadable"
	| "bookkeeping-drift"
	| "scaffold-missing"
	| "fingerprint-drift"
	| "artifact-stale"
	| "store-integrity"
	| "lock-stale"
	| "agent-config"
	| "environment"
	| "unknown";

/** How the doctor should act on a classified failure. */
export type FixAction = "auto-safe" | "agentic" | "manual" | "escalate";

/** Minimal item shape needed for classification (structurally a `DiagnosticItem`). */
export interface TaxonomyItem {
	message: string;
	status?: string;
	suggestion?: string;
}

/**
 * Section-id → class rules, checked in order. Section ids are stable
 * (see `report-schema.ts:sectionId`) so this stays deterministic.
 */
const SECTION_RULES: ReadonlyArray<readonly [RegExp, FailureClass]> = [
	[
		/store-db|store-digest|db-integrity|db-link|hash-chain|baselines|last-verified-backup|soft-locks|semver-bump|portfolio-registry|git-integration/,
		"store-integrity",
	],
	[/run-lock|run-worktree|worktree-binding|worktree-removal|binding/, "lock-stale"],
	[/^agent|agent-|scout|sub-agent|generated|stage-skills|skill/, "agent-config"],
	[/data-sidecar|frontmatter|working-published|fingerprint|config-tamper/, "fingerprint-drift"],
	[
		/freshness|stale|id-coverage|verifier-verdict|shape-compatibility|psrs|rtm|trace|feasibility-decision|design-readiness/,
		"artifact-stale",
	],
	[/setup-progress|grouped-legacy|doc-artifacts|scaffold/, "scaffold-missing"],
	[/environment|multiplexer|herdr|conformance|web-tool|secret-scan|stray-files|official-extension/, "environment"],
	[/^config$|^config-|requirements-profile|standards-profile|available-scans/, "config-broken"],
	[/run-state/, "state-unreadable"],
	[/sequence-hardening|bookkeeping|gate-wiring/, "bookkeeping-drift"],
];

/** Message-keyword fallback for sections that match no id rule. */
const MESSAGE_RULES: ReadonlyArray<readonly [RegExp, FailureClass]> = [
	[/files\.json|config.*(invalid|unreadable|missing)|invalid json/, "config-broken"],
	[/state.*(unreadable|corrupt)/, "state-unreadable"],
	[/fingerprint|diverged|drift/, "fingerprint-drift"],
	[/stale|out of date|changed since/, "artifact-stale"],
	[/integrity|hash chain|checksum|corrupt/, "store-integrity"],
	[/lock/, "lock-stale"],
	[/agents?\.json|scout agent|agent mapping/, "agent-config"],
	[/missing|not found/, "scaffold-missing"],
	[/node\.js|git |path|environment/, "environment"],
];

/** Conservative default action per class; a known fingerprint can override. */
const CLASS_ACTION: Readonly<Record<FailureClass, FixAction>> = {
	"config-broken": "manual",
	"state-unreadable": "manual",
	"bookkeeping-drift": "manual",
	"scaffold-missing": "manual",
	"fingerprint-drift": "manual",
	"artifact-stale": "manual",
	"store-integrity": "escalate",
	"lock-stale": "manual",
	"agent-config": "manual",
	environment: "manual",
	unknown: "manual",
};

/**
 * Classify one doctor item. The section id is the primary signal; when
 * it matches no rule the item message is scanned. Unknown → `"unknown"`.
 */
export function classifyItem(item: TaxonomyItem, sectionId: string): FailureClass {
	const id = sectionId.toLowerCase();
	for (const [pattern, cls] of SECTION_RULES) {
		if (pattern.test(id)) return cls;
	}
	const message = item.message.toLowerCase();
	for (const [pattern, cls] of MESSAGE_RULES) {
		if (pattern.test(message)) return cls;
	}
	return "unknown";
}

/**
 * Map a failure class to the action the doctor should take. When the
 * item's suggestion text resolves to a known fingerprint, the actual
 * repair policy wins: SAFE_WHITELIST → auto-safe, agentic level →
 * agentic. Otherwise the class default applies.
 */
export function actionForFailure(cls: FailureClass, item: TaxonomyItem): FixAction {
	const fingerprint = fingerprintFromSuggestion(item.suggestion);
	if (fingerprint) {
		if (SAFE_WHITELIST.has(fingerprint)) return "auto-safe";
		if (levelFor(fingerprint as SuggestionKey) === "agentic") return "agentic";
	}
	return CLASS_ACTION[cls];
}

/**
 * Reverse-lookup a fingerprint from its `SUGGESTIONS` prose. The doctor
 * does not yet carry a fingerprint field on actionable items, so the
 * suggestion text is the only bridge (same convention as `fix-brief.ts`).
 */
function fingerprintFromSuggestion(suggestion: string | undefined): string | undefined {
	if (!suggestion) return undefined;
	for (const [fingerprint, text] of Object.entries(SUGGESTIONS)) {
		if (text === suggestion) return fingerprint;
	}
	return undefined;
}
