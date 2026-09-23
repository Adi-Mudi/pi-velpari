/**
 * Reuse scan (feasibility v2, Phase 2).
 *
 * Deterministic build-vs-reuse scoring. The reuse scout searches the
 * community for existing implementations and writes one checklist JSON
 * per candidate repo; this module turns those checklists into numbers
 * and a verdict. Match percentages are computed from a core-function
 * checklist — never from an AI's impression.
 *
 * Scoring (plan D1): each PRD core function is covered(1) / partial(0.5)
 * / missing(0) in the candidate repo. matchPct = score / total * 100.
 *
 * Health gate (plan D2): the license must be present and non-restrictive,
 * and the repo must have had a commit within STALE_MONTHS. A high match
 * with a bad license or a dead repo is a trap — it is health-blocked,
 * never a reuse candidate.
 *
 * Thresholds (plan D3): >= REUSE_THRESHOLD with health ok → reuse;
 * >= PARTIAL_THRESHOLD (or high match but health-blocked) → partial;
 * otherwise → build from scratch.
 */

export const REUSE_THRESHOLD = 70;
export const PARTIAL_THRESHOLD = 30;
const STALE_MONTHS = 18;

/** Licenses that block reuse without legal review (lowercase substrings). */
const RESTRICTIVE_LICENSES = ["gpl", "agpl", "lgpl", "sspl", "cc-by-nc", "proprietary"];

type CoverageValue = 0 | 0.5 | 1;

export interface CoreFunction {
	/** Stable id, typically a PRD FR id (e.g. "FR-12"). */
	id: string;
	title: string;
}

export interface ReuseCandidate {
	/** Short repo name, e.g. "owner/repo". */
	name: string;
	repoUrl: string;
	/** SPDX id or license name as found in the repo ("" = unknown). */
	license: string;
	/** ISO date of the latest commit on the default branch. */
	lastCommit: string;
	stars?: number;
	/** Core-function id → coverage in this repo. */
	coverage: Record<string, CoverageValue>;
	/** Where the scout saw the evidence (file path, docs URL, …). */
	evidence?: string;
}

type CandidateStatus = "reuse-candidate" | "health-blocked" | "partial" | "low";
type ReuseVerdict = "reuse" | "partial" | "build";

interface ScoredCandidate {
	candidate: ReuseCandidate;
	matchPct: number;
	healthOk: boolean;
	healthReasons: string[];
	status: CandidateStatus;
}

/** matchPct = (sum of coverage values / number of core functions) * 100, rounded. */
export function matchPct(candidate: ReuseCandidate, coreFunctions: readonly CoreFunction[]): number {
	if (coreFunctions.length === 0) return 0;
	let score = 0;
	for (const fn of coreFunctions) score += candidate.coverage[fn.id] ?? 0;
	return Math.round((score / coreFunctions.length) * 100);
}

function monthsBetween(a: Date, b: Date): number {
	return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

/** Health gate: usable license + fresh repo. Reasons explain each failure. */
export function checkHealth(candidate: ReuseCandidate, now: Date = new Date()): { ok: boolean; reasons: string[] } {
	const reasons: string[] = [];
	const license = candidate.license.trim().toLowerCase();
	if (!license || license === "unknown") {
		reasons.push("license unknown");
	} else if (RESTRICTIVE_LICENSES.some((r) => license.includes(r))) {
		reasons.push(`restrictive license (${candidate.license})`);
	}
	const commit = new Date(candidate.lastCommit);
	if (Number.isNaN(commit.getTime())) {
		reasons.push("last commit date missing/invalid");
	} else if (monthsBetween(commit, now) > STALE_MONTHS) {
		reasons.push(`repo stale (last commit ${candidate.lastCommit})`);
	}
	return { ok: reasons.length === 0, reasons };
}

export function scoreCandidate(
	candidate: ReuseCandidate,
	coreFunctions: readonly CoreFunction[],
	now: Date = new Date(),
): ScoredCandidate {
	const pct = matchPct(candidate, coreFunctions);
	const health = checkHealth(candidate, now);
	let status: CandidateStatus = "low";
	if (pct >= REUSE_THRESHOLD) status = health.ok ? "reuse-candidate" : "health-blocked";
	else if (pct >= PARTIAL_THRESHOLD) status = "partial";
	return { candidate, matchPct: pct, healthOk: health.ok, healthReasons: health.reasons, status };
}

/**
 * Overall verdict across all candidates: reuse if any reuse-candidate,
 * else partial if anything matched above PARTIAL_THRESHOLD or was
 * health-blocked, else build from scratch.
 */
export function verdictFor(
	candidates: readonly ReuseCandidate[],
	coreFunctions: readonly CoreFunction[],
	now: Date = new Date(),
): { verdict: ReuseVerdict; scored: ScoredCandidate[] } {
	const scored = candidates.map((c) => scoreCandidate(c, coreFunctions, now)).sort((a, b) => b.matchPct - a.matchPct);
	const verdict: ReuseVerdict = scored.some((s) => s.status === "reuse-candidate")
		? "reuse"
		: scored.some((s) => s.status === "partial" || s.status === "health-blocked")
			? "partial"
			: "build";
	return { verdict, scored };
}

/**
 * Structural validation of a scout-written candidate checklist.
 * Returns a list of problems; empty = valid.
 */
export function validateReuseCandidate(candidate: unknown, coreFunctions: readonly CoreFunction[]): string[] {
	const problems: string[] = [];
	if (typeof candidate !== "object" || candidate === null) return ["candidate is not an object"];
	const c = candidate as Partial<ReuseCandidate>;
	if (typeof c.name !== "string" || !c.name.trim()) problems.push("name missing");
	if (typeof c.repoUrl !== "string" || !/^https?:\/\//.test(c.repoUrl)) problems.push("repoUrl missing or not http(s)");
	if (typeof c.license !== "string") problems.push("license missing");
	if (typeof c.lastCommit !== "string" || Number.isNaN(new Date(c.lastCommit).getTime()))
		problems.push("lastCommit missing or invalid");
	if (typeof c.coverage !== "object" || c.coverage === null) {
		problems.push("coverage map missing");
		return problems;
	}
	for (const fn of coreFunctions) {
		const v = c.coverage[fn.id];
		if (v !== 0 && v !== 0.5 && v !== 1)
			problems.push(`coverage[${fn.id}] must be 0, 0.5, or 1 (got ${JSON.stringify(v)})`);
	}
	for (const key of Object.keys(c.coverage)) {
		if (!coreFunctions.some((fn) => fn.id === key)) problems.push(`coverage has unknown core-function id "${key}"`);
	}
	return problems;
}

/** Short chat-facing summary table (plan: summary in chat, JSON on disk). */
export function renderReuseSummary(scored: readonly ScoredCandidate[]): string {
	if (scored.length === 0) return "Reuse scan: no candidates found.";
	const lines = [
		"| Repo | Match | License | Status |",
		"|---|---|---|---|",
		...scored.map((s) => {
			const note = s.healthOk ? s.status : `${s.status} (${s.healthReasons.join("; ")})`;
			return `| ${s.candidate.name} | ${s.matchPct}% | ${s.candidate.license || "unknown"} | ${note} |`;
		}),
	];
	return lines.join("\n");
}
