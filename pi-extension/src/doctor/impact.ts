/**
 * Failure impact map (DGR P1 — lane 1a, D7).
 *
 * `failure-taxonomy.classifyItem` returns a coarse `FailureClass`, not
 * prose. D7 needs a one-line human "why it matters / what breaks"
 * sentence per actionable item, so this module is the single
 * `FailureClass → impact` text map. The report renderer and the fix
 * plan both derive their impact line here — never at the call site.
 *
 * Layer rule: L1 `doctor/` — imports sibling L1 `failure-taxonomy.ts`
 * only. Pure; no IO, no state.
 */

import { classifyItem, type FailureClass, type TaxonomyItem } from "./failure-taxonomy.js";

/**
 * One-line impact sentence per failure class. Typed as a
 * `Record<FailureClass, string>` so the compiler rejects a map that
 * misses a class — the taxonomy and this prose can never drift apart.
 */
export const FAILURE_IMPACTS: Readonly<Record<FailureClass, string>> = {
	"config-broken":
		"Velpari can't read its own configuration, so stages may run with the wrong inputs or refuse to start at all.",
	"state-unreadable":
		"The run state can't be read, so velpari can't tell which stage is active or which command is legal next.",
	"bookkeeping-drift":
		"Internal bookkeeping has drifted from the artifacts, so stage gates and next-step hints may point at the wrong stage.",
	"scaffold-missing":
		"Expected folders or files are missing, so stages can't write their working copies or find published artifacts.",
	"fingerprint-drift":
		"A published artifact changed after its inputs were stamped, so downstream traceability can no longer be trusted.",
	"artifact-stale":
		"An upstream artifact changed, so this artifact may describe outdated requirements, design or tests.",
	"store-integrity":
		"The store database, its hash chain or a backup is damaged, so published history may be lost or unverifiable — repair by hand, never automatically.",
	"lock-stale": "A stale run lock or worktree binding blocks new commands or points at the wrong working tree.",
	"agent-config":
		"A scout/sub-agent mapping is missing or invalid, so stage fan-out will fail or dispatch the wrong agent.",
	environment: "The local environment (Node, git, multiplexer or extension) is incomplete, so some commands can't run.",
	unknown: "The doctor could not classify this issue — review it by hand before changing anything.",
};

/**
 * Derive the impact sentence for one actionable item.
 *
 * @param {string} sectionId - Stable machine section id (see `report-schema.ts:sectionId`).
 * @param {TaxonomyItem} item - The actionable item (message + optional suggestion).
 * @returns {string} The class impact sentence; the generic `unknown` text
 *   when the item matches no taxonomy rule.
 */
export function impactFor(sectionId: string, item: TaxonomyItem): string {
	const cls = classifyItem(item, sectionId);
	return FAILURE_IMPACTS[cls] ?? FAILURE_IMPACTS.unknown;
}
