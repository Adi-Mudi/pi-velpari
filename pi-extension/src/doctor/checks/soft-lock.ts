// ============================================================================
// doctor/checks/soft-lock.ts — publish-gate store enforcement (Phase B, G1)
// ============================================================================
// Decision record: .IDE_Plans/velpari-upgrade-phase-b-locking_plan_20260928_0806_v1.0.md
//   D8  — DETECT only when `gateErrorsSoFar === 0`: the block runs LAST in
//         gate.ts, so detection + marking happen only when every other gate
//         check has passed (a publish that later aborts releases its locks
//         through revertPublish — Phase 3.3).
//   D2  — LOCK finding = WARNING here; the deliberate lock is the L1 refusal
//         (io/db.ts). `errors` stays EMPTY by construction (except nothing —
//         this check can never add errors, ever).
//   D13a/D13b — provisioning writes the AGENTS.md section + the commit-msg
//         hook; failures/skips surface as warnings, never errors.
// Layer 1: imports L0 (core/soft-lock, core/agents-md, core/freshness) +
// ops/git-hooks (L1→L1, sanctioned by plan anchor #14).
// ============================================================================

import { ensureProtectedAssetsSection } from "../../core/agents-md.js";
import { ensureCommitMsgHook } from "../../ops/git-hooks.js";
import { manifestKey } from "../../core/freshness.js";
import {
	artifactKeyToStoreKind,
	consumerKeysForKind,
	listSoftLocks,
	markConsumedUpstreams,
	upstreamArtifactsForPublish,
} from "../../core/soft-lock.js";

/** Inputs of one publish-gate store-enforcement run. */
export interface StoreEnforcementInput {
	/** Gate artifact key ("PRD", "test-plan", …). */
	artifact: string;
	/** Project root. */
	cwd: string;
	/** Store project name. */
	projectName: string;
	/** FOUND declared inputs of this publish ("<kind>:<id>"). */
	declaredInputIds: readonly string[];
	/** Freshness keys from id-coverage rules with parseable refs (status ≠ not-checkable). */
	coverageUpstreamKeys: readonly string[];
	/** Errors accumulated by the OTHER gate checks (D8 gate). */
	gateErrorsSoFar: number;
}

/** Findings of one store-enforcement run (errors stay empty — D2). */
export interface StoreEnforcementResult {
	errors: string[];
	warnings: string[];
}

/** Skips that mean "the guard is already active" (not reportable). */
const BENIGN_SKIPS = new Set(["section already current", "hook already installed"]);

/**
 * DETECT → MARK → SURFACE + provisioning for one publish (D8/D13/D2).
 * - Provision (always): AGENTS.md section + commit-msg hook; failures and
 *   guard-inactive skips → one warning each, never an error.
 * - Surface (always): locked PUBLISHED revisions of the artifact being
 *   republished → immutable-content warning naming the consumer.
 * - Detect + mark (only when `gateErrorsSoFar === 0`): lock the published
 *   head revisions of every declared/coverage upstream; one warning per
 *   NEWLY locked revision (already-locked stay silent — idempotent).
 * - Fail-open: any thrown error → `soft-lock: enforcement skipped (…)`,
 *   errors stay empty.
 * @param {StoreEnforcementInput} input - Gate context.
 * @returns {StoreEnforcementResult} warnings only (by design).
 */
export function gateStoreEnforcement(input: StoreEnforcementInput): StoreEnforcementResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	try {
		// 1. Provision (always) — advisory layers L2 + L3.
		const section = ensureProtectedAssetsSection(input.cwd);
		const sectionDetail = section.error ?? section.skipped;
		if (sectionDetail !== undefined && !BENIGN_SKIPS.has(sectionDetail)) {
			warnings.push(`store-enforcement: AGENTS.md section not written (${sectionDetail})`);
		}
		const hook = ensureCommitMsgHook(input.cwd);
		const hookDetail = hook.error ?? hook.skipped;
		if (hookDetail !== undefined && !BENIGN_SKIPS.has(hookDetail)) {
			warnings.push(`store-enforcement: commit-msg hook not installed (${hookDetail})`);
		}

		const kind = artifactKeyToStoreKind(input.artifact);

		// 2. Surface (always) — what this republish is about to version-bump.
		if (kind !== null) {
			for (const lock of listSoftLocks(input.cwd, input.projectName, kind)) {
				if (lock.status !== "published") continue; // superseded markers are history
				warnings.push(
					`soft-lock: ${input.artifact} v${lock.revisionNumber} is locked ` +
						`(consumed by ${lock.lockedBy} at ${lock.lockedAt}) — content is immutable; ` +
						"this publish creates a NEW version and re-stales downstream consumers.",
				);
			}
		}

		// 3. Detect + mark (only when every other gate check passed — D8).
		if (input.gateErrorsSoFar === 0) {
			const upstreams = upstreamArtifactsForPublish({
				artifactKey: input.artifact,
				declaredInputIds: input.declaredInputIds,
				coverageUpstreamKeys: input.coverageUpstreamKeys,
			});
			const marked = markConsumedUpstreams(
				input.cwd,
				input.projectName,
				manifestKey(input.artifact, input.projectName),
				upstreams,
			);
			for (const lock of marked.locked) {
				const primaryKey = consumerKeysForKind(lock.kind)[0] ?? lock.kind;
				warnings.push(
					`soft-lock: locked ${manifestKey(primaryKey, input.projectName)} revision ` +
						`v${lock.revisionNumber} — consumed by this publish.`,
				);
			}
		}
	} catch (err) {
		warnings.push(`soft-lock: enforcement skipped (${err instanceof Error ? err.message : String(err)})`);
	}
	return { errors, warnings };
}
