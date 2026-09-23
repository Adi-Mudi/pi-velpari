/**
 * Language spikes (feasibility v2, Phase 3).
 *
 * A spike is the XP practice of building the smallest possible program
 * to answer "can language X handle this project's core function?" One
 * feasibility-spike agent per candidate language builds + runs the core
 * function inside the run's spike workspace
 * (<runDir>/feasibility/spikes/<language>/, gitignored) and writes a
 * SpikeResult JSON. This module validates those results and ranks them.
 *
 * Gating (plan D6): spikes are MANDATORY when the reuse scan decided
 * "build" AND no framework is configured in files.json. When a framework
 * is set, feasibility-tech validates that stack instead — no spikes.
 * When the reuse scan decided "reuse", the clone dictates the stack —
 * no spikes either.
 */

export interface SpikeResult {
	language: string;
	coreFunction: string;
	/** The code compiles / parses / its dependencies install. */
	buildOk: boolean;
	/** The program ran and produced the expected behavior. */
	runOk: boolean;
	notes: string;
	/** Path (relative to the spike workspace) of code + run log. */
	evidencePath: string;
	timestamp?: string;
}

/** Structural validation of a spike-agent result. Empty = valid. */
export function validateSpikeResult(result: unknown): string[] {
	const problems: string[] = [];
	if (typeof result !== "object" || result === null) return ["spike result is not an object"];
	const r = result as Partial<SpikeResult>;
	if (typeof r.language !== "string" || !r.language.trim()) problems.push("language missing");
	if (typeof r.coreFunction !== "string" || !r.coreFunction.trim()) problems.push("coreFunction missing");
	if (typeof r.buildOk !== "boolean") problems.push("buildOk must be boolean");
	if (typeof r.runOk !== "boolean") problems.push("runOk must be boolean");
	if (typeof r.notes !== "string") problems.push("notes missing");
	if (typeof r.evidencePath !== "string" || !r.evidencePath.trim()) problems.push("evidencePath missing");
	return problems;
}

/**
 * Rank spike results: passing spikes (buildOk && runOk) first, then
 * build-only, then failures; alphabetical inside a tier for determinism.
 */
export function compareSpikes(results: readonly SpikeResult[]): SpikeResult[] {
	const tier = (r: SpikeResult): number => (r.buildOk && r.runOk ? 0 : r.buildOk ? 1 : 2);
	return [...results].sort((a, b) => tier(a) - tier(b) || a.language.localeCompare(b.language));
}

/** Spikes needed? Only on the build-from-scratch path with no configured framework. */
export function needsSpikes(decision: "reuse" | "partial" | "build", framework: string | undefined): boolean {
	return decision === "build" && !(framework && framework.trim());
}
