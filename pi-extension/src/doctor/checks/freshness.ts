/**
 * Freshness stale-set check (B4 + A3).
 *
 * Renders the hash-based stale set from `core/freshness.ts` — the single
 * source of truth also consumed by the stage-start check
 * (`stages/registry.ts:runStage`) and the publish gate
 * (`doctor/gate.ts:runPublishGate`):
 *
 *  - input-changed / input-missing → error (D7): a declared input of a
 *    published artifact changed or vanished since it was published;
 *  - no-stamp → warning: legacy artifact (pre-B4 publish, or no manifest
 *    entry) — republish to stamp;
 *  - logging-plan → info note only (D5: excluded from v1 freshness —
 *    it publishes outside handleApprove).
 */

import {
	computeStaleSet,
	enumeratePublishedArtifacts,
	loadFreshnessManifest,
	manifestKey,
} from "../../core/freshness.js";
import { resolveDocArtifactAll } from "../../core/paths.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

export function checkFreshnessSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];
	const manifest = loadFreshnessManifest(cwd);
	const enumerated = enumeratePublishedArtifacts(cwd);
	const tracked = new Set([
		...Object.keys(manifest.artifacts),
		...enumerated.map((a) => manifestKey(a.artifactKind, a.slug ?? a.projectName ?? "")),
	]);

	const stale = computeStaleSet(cwd, { enumerated });
	for (const item of stale) {
		if (item.reason === "no-stamp") {
			items.push({
				status: "warning",
				message: `${item.key}: no freshness stamp (legacy pre-B4 publish) — republish to stamp.`,
				suggestion: suggestionFor("freshness-no-stamp"),
			});
		} else {
			items.push({
				status: "error",
				message: `${item.key}: stale (${item.reason}) — changed inputs: ` + `${item.changedInputs.join(", ")}.`,
				// D4: input-missing is republish-only; only input-changed may
				// also be re-confirmed (A5).
				suggestion:
					item.reason === "input-missing" ? suggestionFor("stale-input-missing") : suggestionFor("stale-input"),
			});
		}
	}

	// D5 — logging-plan publishes via parent-LLM `cp`, not handleApprove,
	// so v1 freshness cannot track it. Known gap, note only.
	if (resolveDocArtifactAll(cwd, "logging-plan").length > 0) {
		items.push({
			status: "info",
			message: "logging-plan is not freshness-tracked in v1 (D5 known gap — it publishes outside the publish tool).",
		});
	}

	items.push(
		stale.length === 0
			? {
					status: "ok",
					message:
						tracked.size === 0
							? "No published artifacts tracked yet."
							: `0 stale / ${tracked.size} tracked artifact(s).`,
				}
			: {
					status: "info",
					message: `${stale.length} stale / ${tracked.size} tracked artifact(s).`,
				},
	);

	return { title: "Freshness (stale set)", items };
}
