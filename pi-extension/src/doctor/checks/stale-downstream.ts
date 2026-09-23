/**
 * Stale-downstream + deprecated-reference + gate-wiring checks.
 *
 * Living-documents safety net (the brainstorm-first update flow is the
 * mechanism; doctor only reports drift):
 *
 *   1. Stale downstream — hash-based (B4/A3): rendered from the shared
 *      stale set (`core/freshness.ts:computeStaleSet`). A published
 *      artifact is stale when one of its declared inputs changed
 *      (content hash differs) or vanished since it was published.
 *      Replaces the old mtime adjacent-pair comparisons — touch is not
 *      change; content hashes are the spec'd mechanism.
 *   2. Deprecated reference — a PRD requirement row marked `deprecated`
 *      whose RTM row is NOT marked `deprecated` → error per ID.
 *      Deprecate-don't-delete must propagate downstream.
 *   3. Gate wiring (Senai checks-gates port, light) — reports that the
 *      sequence-hardening pieces are loaded (stage gate map, tool_call
 *      stage folders) and flags a stale run lock. Report-only; never
 *      mutates.
 */

import { readFileSync } from "node:fs";
import { resolveDocArtifact } from "../../core/paths.js";
import { STAGE_FOLDERS } from "../../core/constants.js";
import { computeStaleSet, loadFreshnessManifest } from "../../core/freshness.js";
import { extractIdRows, readSectionBody } from "../../core/psrs.js";
import { readLockInfo } from "../../io/run-lock.js";
import { STAGE_GATE, STAGE_KEYS, STAGE_REGISTRY } from "../../stages/registry.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** PRD sections whose rows carry a Status column. */
const STATUS_SECTIONS: ReadonlyArray<{ heading: string; prefixes: string[] }> = [
	{ heading: "User Stories", prefixes: ["US-"] },
	{ heading: "Success Metrics", prefixes: ["SM-"] },
	{ heading: "Functional Requirements", prefixes: ["FR-"] },
	{ heading: "Non-Functional Requirements", prefixes: ["NFR-"] },
];

/** Deprecated IDs in the PRD (rows whose Status cell is `deprecated`). */
function deprecatedPrdIds(prsContent: string): string[] {
	const out: string[] = [];
	for (const section of STATUS_SECTIONS) {
		const body = readSectionBody(prsContent, section.heading);
		for (const row of extractIdRows(body, section.prefixes)) {
			if (row.rest.some((cell) => cell.toLowerCase() === "deprecated")) {
				out.push(row.id);
			}
		}
	}
	return out.sort();
}

export function checkStaleDownstreamSection(cwd: string, projectName: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "Stale-downstream check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "Stale downstream artifacts", items };
	}

	// 1. Hash-based staleness from the shared stale set (B4/A3). Legacy
	//    no-stamp items are the freshness section's job (warning, D7) —
	//    this section reports genuine input drift as errors.
	const stale = computeStaleSet(cwd).filter((item) => item.reason !== "no-stamp");
	for (const item of stale) {
		const upstreamSpec = Object.values(STAGE_REGISTRY).find(
			(candidate) => candidate.workingCopyArtifact.toLowerCase() === item.artifact,
		);
		const command =
			item.artifact === "brainstorm" ? "/velpari-brainstorm" : upstreamSpec ? `/velpari-${upstreamSpec.key}` : null;
		items.push({
			status: "error",
			message:
				`${item.key} is stale (${item.reason}): inputs changed since publish ` +
				`(${item.changedInputs.join(", ")}).` +
				(command ? ` Re-run ${command} (update mode) to sync.` : ""),
			details: [`artifact: ${item.path}`],
			suggestion: suggestionFor("stale-downstream"),
		});
	}

	// 2. Deprecated PRD ids still live in the RTM.
	const prd = resolveDocArtifact("PRD", projectName, cwd);
	const rtm = resolveDocArtifact("RTM", projectName, cwd);
	let deprecatedChecked = 0;
	if (prd && rtm) {
		const prdContent = readFileSync(prd.path, "utf8");
		const rtmLines = readFileSync(rtm.path, "utf8").split("\n");
		const deprecated = deprecatedPrdIds(prdContent);
		deprecatedChecked = deprecated.length;
		for (const id of deprecated) {
			const liveRow = rtmLines.find(
				(line) => line.trim().startsWith("|") && line.includes(id) && !line.toLowerCase().includes("deprecated"),
			);
			if (liveRow) {
				items.push({
					status: "error",
					message:
						`${id} is deprecated in the PRD but its RTM row is not marked deprecated. ` +
						`Deprecate-don't-delete must propagate downstream.`,
					details: [`RTM row: ${liveRow.trim()}`],
					suggestion: suggestionFor("rtm-deprecated-ref"),
				});
			}
		}
	}

	const errorCount = items.filter((i) => i.status === "error").length;
	if (errorCount === 0) {
		const trackedCount = Object.keys(loadFreshnessManifest(cwd).artifacts).length;
		items.push({
			status: "ok",
			message:
				trackedCount === 0 && deprecatedChecked === 0
					? "No stale artifacts; nothing to compare yet."
					: `All tracked artifact(s) in sync; ${deprecatedChecked} deprecated id(s) correctly propagated.`,
		});
	}

	return { title: "Stale downstream artifacts", items };
}

/**
 * Gate-wiring audit: confirms the sequence-hardening pieces are loaded
 * and flags a stale run lock. Report-only; never mutates.
 */
export function checkGateWiringSection(cwd: string): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	const gateKeys = STAGE_KEYS.filter((k) => (STAGE_GATE[k] ?? []).length > 0);
	items.push({
		status: gateKeys.length === STAGE_KEYS.length ? "ok" : "error",
		message: `Stage gate: ${gateKeys.length}/${STAGE_KEYS.length} stage commands gated.`,
	});

	const folderCount = Object.keys(STAGE_FOLDERS).length;
	items.push({
		status: folderCount > 0 ? "ok" : "error",
		message: `tool_call stage guard: ${folderCount} in-progress stage(s) locked to their run folder.`,
	});

	const holder = readLockInfo(cwd);
	if (!holder) {
		items.push({ status: "ok", message: "Run lock: free." });
	} else {
		const heartbeatAge = Date.now() - Date.parse(holder.heartbeatAt);
		const pidAlive = (() => {
			try {
				process.kill(holder.pid, 0);
				return true;
			} catch {
				return false;
			}
		})();
		if (pidAlive && heartbeatAge <= 60_000) {
			items.push({
				status: "info",
				message: `Run lock: held by pid=${holder.pid} (${holder.command}) — a state mutation is in flight.`,
			});
		} else {
			items.push({
				status: "warning",
				message: `Run lock: STALE (pid=${holder.pid}, command=${holder.command}). It is auto-stolen on the next state mutation.`,
				suggestion: suggestionFor("stale-run-lock"),
			});
		}
	}

	return { title: "Sequence hardening", items };
}
