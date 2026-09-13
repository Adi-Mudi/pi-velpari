/**
 * Stale-downstream + deprecated-reference + gate-wiring checks.
 *
 * Living-documents safety net (the brainstorm-first update flow is the
 * mechanism; doctor only reports drift):
 *
 *   1. Stale downstream — adjacent published pairs
 *      (PRD → RTM → feasibility → design → pseudocode → test-plan):
 *      when the upstream artifact's mtime is NEWER than the downstream
 *      one's, the upstream was revised after the downstream was
 *      published → error naming the stage to re-run (update mode).
 *   2. Deprecated reference — a PRD requirement row marked `deprecated`
 *      whose RTM row is NOT marked `deprecated` → error per ID.
 *      Deprecate-don't-delete must propagate downstream.
 *   3. Gate wiring (Senai checks-gates port, light) — reports that the
 *      sequence-hardening pieces are loaded (stage gate map, tool_call
 *      stage folders) and flags a stale run lock. Report-only; never
 *      mutates.
 */

import { readFileSync, statSync } from "node:fs";
import { resolveDocArtifact } from "../../core/paths.js";
import { STAGE_FOLDERS } from "../../core/constants.js";
import { extractIdRows, readSectionBody } from "../../core/psrs.js";
import { readLockInfo } from "../../io/run-lock.js";
import { STAGE_GATE, STAGE_KEYS } from "../../stages/registry.js";
import type { DiagnosticItem, DiagnosticSection } from "../_types.js";
import { suggestionFor } from "./fix-suggestions.js";

/** Adjacent published pairs + the command that republishes the downstream. */
const DOWNSTREAM_PAIRS: ReadonlyArray<{
	upstream: string;
	downstream: string;
	command: string;
}> = [
	{ upstream: "PRD", downstream: "RTM", command: "/velpari-rtm" },
	{ upstream: "RTM", downstream: "feasibility-study", command: "/velpari-feasibility" },
	{ upstream: "feasibility-study", downstream: "design", command: "/velpari-architecture-generator" },
	{ upstream: "design", downstream: "pseudocode", command: "/velpari-pseudocode" },
	{ upstream: "pseudocode", downstream: "test-plan", command: "/velpari-testplan" },
];

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

export function checkStaleDownstreamSection(
	cwd: string,
	projectName: string,
): DiagnosticSection {
	const items: DiagnosticItem[] = [];

	if (!projectName) {
		items.push({
			status: "info",
			message: "Stale-downstream check skipped — project name missing.",
			suggestion: suggestionFor("project-name-missing"),
		});
		return { title: "Stale downstream artifacts", items };
	}

	// 1. Adjacent-pair freshness.
	let checkedPairs = 0;
	for (const pair of DOWNSTREAM_PAIRS) {
		const upstream = resolveDocArtifact(pair.upstream, projectName, cwd);
		const downstream = resolveDocArtifact(pair.downstream, projectName, cwd);
		if (!upstream || !downstream) continue; // missing artifacts are reported elsewhere
		checkedPairs++;
		const upstreamMtime = statSync(upstream.path).mtimeMs;
		const downstreamMtime = statSync(downstream.path).mtimeMs;
		if (upstreamMtime > downstreamMtime) {
			items.push({
				status: "error",
				message:
					`${pair.downstream} is stale: ${pair.upstream} was revised after ` +
					`${pair.downstream} was published. Re-run ${pair.command} (update mode) to sync.`,
				details: [
					`upstream:   ${upstream.path}`,
					`downstream: ${downstream.path}`,
				],
				suggestion: suggestionFor("stale-downstream"),
			});
		}
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
				(line) =>
					line.trim().startsWith("|") &&
					line.includes(id) &&
					!line.toLowerCase().includes("deprecated"),
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
		items.push({
			status: "ok",
			message:
				checkedPairs === 0 && deprecatedChecked === 0
					? "No published artifact pairs to compare yet."
					: `All ${checkedPairs} published pair(s) in sync; ${deprecatedChecked} deprecated id(s) correctly propagated.`,
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
