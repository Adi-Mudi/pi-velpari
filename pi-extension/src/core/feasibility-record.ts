/**
 * Feasibility decision record (B3 — D9; the one code-generated sidecar).
 *
 * Every other sidecar is LLM-authored and validated at publish; this one
 * is serialized BY CODE from `state.feasibilitySession` at publish time,
 * BEFORE `clearFeasibilitySession` destroys the session. The record is
 * the durable trace of the feasibility v2 decisions (build-vs-reuse
 * verdict, selected language, spike evidence) that would otherwise
 * evaporate when the session is cleared.
 *
 * Path: `Doc/feasibility/feasibility-decision_<project>.yaml`, recorded
 * in the feasibility-study artifact's own freshness `extraPaths` (D5).
 *
 * Layer 0 — domain primitive. Imports L0 only.
 */

import { join } from "node:path";
import type { FeasibilitySession } from "./state.js";
import type { SpikeResult } from "./spike.js";
import { readYamlFile, writeYamlFile } from "./yaml-data.js";

interface FeasibilityDecisionRecord {
	project: string;
	/** Build-vs-reuse verdict from the reuse scan. */
	verdict: "reuse" | "partial" | "build";
	/** Final language choice — from clone (reuse path), config, or selection. */
	selectedLanguage: string;
	/** Who/what picked selectedLanguage. */
	selectedBy: "clone" | "config" | "auto" | "user";
	/** Candidate languages offered for spikes (build path only). */
	languageCandidates: string[];
	/** Validated spike results, one per candidate language. */
	spikeResults: SpikeResult[];
	/** Chat-summary rows of the reuse scan. */
	reuseSummary: string[];
	/** ISO timestamp of the publish that recorded the decision. */
	recordedAt: string;
}

/** Absolute path of the decision record for a project. */
export function feasibilityRecordPath(cwd: string, projectName: string): string {
	return join(cwd, "Doc", "feasibility", `feasibility-decision_${projectName}.yaml`);
}

/**
 * Map a settled session to the durable record (D9 fields). The session
 * gate guarantees `decision` + `selectedLanguage` before this runs.
 */
function buildFeasibilityRecord(
	session: FeasibilitySession,
	projectName: string,
	recordedAt: string,
): FeasibilityDecisionRecord {
	return {
		project: projectName,
		verdict: session.decision ?? "build",
		selectedLanguage: session.selectedLanguage ?? "",
		selectedBy: session.selectedBy ?? "user",
		languageCandidates: session.languageCandidates ?? [],
		spikeResults: session.spikeResults ?? [],
		reuseSummary: session.reuseSummary ?? [],
		recordedAt,
	};
}

/** Serialize the session to the record path. Returns the absolute path. */
export function writeFeasibilityRecord(
	cwd: string,
	projectName: string,
	session: FeasibilitySession,
	recordedAt: string,
): string {
	const path = feasibilityRecordPath(cwd, projectName);
	writeYamlFile(path, buildFeasibilityRecord(session, projectName, recordedAt));
	return path;
}

/** Loose reader for the doctor check and /velpari-show-feasibility. */
export function loadFeasibilityRecord(cwd: string, projectName: string): FeasibilityDecisionRecord | null {
	const data = readYamlFile(feasibilityRecordPath(cwd, projectName));
	if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
	return data as FeasibilityDecisionRecord;
}
