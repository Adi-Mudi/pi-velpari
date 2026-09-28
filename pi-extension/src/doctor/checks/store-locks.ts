/**
 * Soft-lock visibility check — Phase C (B contract consumer), N19.
 *
 * Read-only anytime view of Phase B's soft-lock markers: which published
 * revisions were consumed downstream and are therefore content-immutable
 * (the "copy → new version" rule, N19/N21). B's `checks/soft-lock.ts`
 * stays the publish-gate enforcement (never edited by C); this section
 * only renders `listSoftLocks` for the doctor report.
 *
 * Contract degradation (batch-1 pre-merge): `core/soft-lock.ts` absent →
 * single `info` line — never a finding that blocks.
 *
 * Every path wrapped — the doctor ALWAYS renders.
 */

import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { resolveSoftLockApi } from "../contract.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Section title (stable — tests key on it). */
const SECTION_TITLE = "Soft locks (N19)";

/**
 * Build the "Soft locks" section (read-only).
 * @param {string} cwd - Project root.
 * @param {string} projectName - Configured project name ("" = not configured).
 * @returns {DiagnosticSection} One `info` row per locked revision, or `ok` when none / degraded.
 */
export function checkStoreLocksSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	try {
		const api = resolveSoftLockApi();
		if (!api) {
			items.push({
				status: "info",
				message:
					"soft-lock-contract-unavailable: Phase B soft-lock API (core/soft-lock.ts) not present in this build — degraded.",
				suggestion: suggestionFor("soft-lock-contract-unavailable"),
			});
			return { title: SECTION_TITLE, items };
		}
		if (projectName === "") {
			items.push({
				status: "info",
				message: "No project configured — lock surfacing skipped.",
				suggestion: suggestionFor("project-name-missing"),
			});
			return { title: SECTION_TITLE, items };
		}

		const locks = api.listSoftLocks(cwd, projectName);
		if (locks.length === 0) {
			items.push({ status: "ok", message: "No soft locks — no published revision is consumed downstream yet." });
			return { title: SECTION_TITLE, items };
		}
		for (const lock of locks) {
			items.push({
				status: "info",
				message: `${lock.kind} r${lock.revisionId} v${lock.revisionNumber}: locked (consumed by ${lock.lockedBy} at ${lock.lockedAt}) — content immutable; republish creates a NEW version.`,
			});
		}
	} catch (err) {
		items.push({
			status: "warning",
			message: `soft-lock surfacing skipped (${(err as Error)?.message ?? String(err)})`,
		});
	}
	return { title: SECTION_TITLE, items };
}
