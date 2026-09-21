/**
 * Development-order data sidecar (B3 — YAML sidecars; D8 DAG).
 *
 * The development-order artifact's source of truth is a YAML document
 * (`development-order_<project>.yaml`) living next to the markdown in
 * both the working copy and the published grouped layout. The publish
 * branch validates it and RE-RENDERS the published markdown from it.
 *
 * D8 schema: `steps[]` of `{ id, module, afs[], dependsOn[] }`.
 * `dependsOn` references step ids; validation resolves every reference
 * and proves the graph is acyclic (DFS, three-color) — a cyclic build
 * order is a hard error, never publishable. A topological order check
 * confirms the listed order already satisfies the dependencies.
 *
 * Layer 0 — domain primitive. Imports L0 only.
 */

import { existsSync } from "node:fs";
import { compareVersions, readYamlFile } from "./yaml-data.js";

export interface DevOrderStep {
	/** Step id, e.g. "DO-1". */
	id: string;
	/** Module this step delivers (e.g. "M-3 (database-schema)"). */
	module: string;
	/** Atomic functions this step delivers (Layer-2 ID coverage). */
	afs: string[];
	/** Step ids that must land before this one. [] for foundations. */
	dependsOn: string[];
	/** Optional free-text rationale (rendered in the Final Order table). */
	rationale?: string;
}

export interface DevOrderData {
	project: string;
	/** Semver-ish version; bump rules match the living-documents rules. */
	version: string;
	steps: DevOrderStep[];
	/** Revision entries, newest last. Rendered as the Change Log section. */
	changeLog?: string[];
}

interface DevOrderValidation {
	ok: boolean;
	issues: string[];
}

const STEP_ID_PATTERN = /^DO-\d+$/;
const AF_ID_PATTERN = /^AF-\d+$/;

// ---------------------------------------------------------------------------
// Sidecar resolution
// ---------------------------------------------------------------------------

/** Sidecar path next to a development-order markdown path (`.yaml` only). */
function devOrderSidecarPath(mdPath: string): string {
	return mdPath.replace(/\.md$/, ".yaml");
}

/** Resolve the existing sidecar for a dev-order markdown path, or null. */
export function resolveDevOrderSidecar(mdPath: string): string | null {
	const path = devOrderSidecarPath(mdPath);
	return existsSync(path) ? path : null;
}

/**
 * Loose AF-ref extraction (D7): the union of every step's `afs` when a
 * sidecar exists and parses, null otherwise (caller falls back to
 * markdown scraping). Never throws.
 */
export function extractDevOrderAfRefsFromSidecar(mdPath: string): string[] | null {
	const resolved = resolveDevOrderSidecar(mdPath);
	if (!resolved) return null;
	const data = readYamlFile(resolved);
	if (typeof data !== "object" || data === null) return null;
	const steps = (data as Record<string, unknown>).steps;
	if (!Array.isArray(steps)) return null;
	const refs: string[] = [];
	for (const step of steps) {
		if (typeof step !== "object" || step === null) continue;
		const afs = (step as Record<string, unknown>).afs;
		if (Array.isArray(afs)) {
			for (const id of afs) {
				if (typeof id === "string" && AF_ID_PATTERN.test(id)) refs.push(id);
			}
		}
	}
	return refs.length > 0 ? refs : null;
}

// ---------------------------------------------------------------------------
// Validation (schema + DAG)
// ---------------------------------------------------------------------------

/**
 * Detect cycles in the dependsOn graph via three-color DFS.
 * Returns the first cycle found as a list of step ids (start repeated
 * at the end), or null when the graph is acyclic.
 */
export function findDependencyCycle(steps: readonly DevOrderStep[]): string[] | null {
	const deps = new Map(steps.map((s) => [s.id, s.dependsOn]));
	const WHITE = 0, GRAY = 1, BLACK = 2;
	const color = new Map<string, number>(steps.map((s) => [s.id, WHITE]));
	const stack: string[] = [];

	const visit = (id: string): string[] | null => {
		color.set(id, GRAY);
		stack.push(id);
		for (const dep of deps.get(id) ?? []) {
			if (!deps.has(dep)) continue; // unknown dep — reported separately
			const c = color.get(dep);
			if (c === GRAY) {
				const start = stack.indexOf(dep);
				return [...stack.slice(start), dep];
			}
			if (c === WHITE) {
				const cycle = visit(dep);
				if (cycle) return cycle;
			}
		}
		stack.pop();
		color.set(id, BLACK);
		return null;
	};

	for (const step of steps) {
		if (color.get(step.id) === WHITE) {
			const cycle = visit(step.id);
			if (cycle) return cycle;
		}
	}
	return null;
}

/** Validate the sidecar shape + the dependsOn DAG. Pure — no I/O. */
export function validateDevOrderData(value: unknown): DevOrderValidation {
	const issues: string[] = [];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, issues: ["development-order sidecar must be an object."] };
	}
	const data = value as Record<string, unknown>;
	if (typeof data.project !== "string" || data.project.trim() === "") {
		issues.push("project: missing or not a string.");
	}
	if (typeof data.version !== "string" || data.version.trim() === "") {
		issues.push("version: missing or not a string.");
	}
	if (!Array.isArray(data.steps)) {
		issues.push("steps: missing or not an array.");
		return { ok: false, issues };
	}

	const seen = new Set<string>();
	const steps: DevOrderStep[] = [];
	for (let i = 0; i < data.steps.length; i++) {
		const step = data.steps[i] as Record<string, unknown>;
		const at = `steps[${i}]`;
		if (typeof step !== "object" || step === null) {
			issues.push(`${at}: not an object.`);
			continue;
		}
		if (typeof step.id !== "string" || !STEP_ID_PATTERN.test(step.id)) {
			issues.push(`${at}.id: must match DO-<n>, got "${String(step.id)}".`);
		} else if (seen.has(step.id)) {
			issues.push(`${at}.id: duplicate id "${step.id}".`);
		} else {
			seen.add(step.id);
		}
		if (typeof step.module !== "string" || step.module.trim() === "") {
			issues.push(`${at}.module: missing or empty.`);
		}
		if (!Array.isArray(step.afs) || step.afs.some((a) => typeof a !== "string" || !AF_ID_PATTERN.test(a))) {
			issues.push(`${at}.afs: must be an array of AF-<n> ids (use [] when none — every AF must appear in exactly one step overall).`);
		}
		if (!Array.isArray(step.dependsOn) || step.dependsOn.some((d) => typeof d !== "string")) {
			issues.push(`${at}.dependsOn: must be an array of step ids (use [] for a foundation step).`);
		}
		if (step.rationale !== undefined && typeof step.rationale !== "string") {
			issues.push(`${at}.rationale: must be a string when present.`);
		}
		if (typeof step.id === "string" && STEP_ID_PATTERN.test(step.id)
			&& Array.isArray(step.dependsOn) && step.dependsOn.every((d) => typeof d === "string")) {
			steps.push({
				id: step.id,
				module: typeof step.module === "string" ? step.module : "",
				afs: Array.isArray(step.afs) ? (step.afs as string[]) : [],
				dependsOn: step.dependsOn as string[],
				...(typeof step.rationale === "string" ? { rationale: step.rationale } : {}),
			});
		}
	}

	// dependsOn resolution: every referenced id must exist.
	const ids = new Set(steps.map((s) => s.id));
	for (const step of steps) {
		for (const dep of step.dependsOn) {
			if (!ids.has(dep)) {
				issues.push(`steps.${step.id}.dependsOn: unknown step "${dep}" — dependsOn references step ids declared in this file.`);
			}
		}
	}

	// Acyclicity (a cyclic build order is never publishable).
	const cycle = findDependencyCycle(steps);
	if (cycle) {
		issues.push(`dependency cycle detected: ${cycle.join(" → ")}. Reorder or split the steps so the graph is acyclic.`);
	}

	// Topological sanity: the listed order must already satisfy the DAG
	// (a step may only appear after every step it depends on).
	const position = new Map(steps.map((s, i) => [s.id, i]));
	for (const step of steps) {
		for (const dep of step.dependsOn) {
			if (ids.has(dep) && position.get(dep)! >= position.get(step.id)!) {
				issues.push(`order violation: step "${step.id}" is listed before "${dep}" which it depends on — list dependencies first.`);
			}
		}
	}

	if (data.changeLog !== undefined && (!Array.isArray(data.changeLog) || data.changeLog.some((e) => typeof e !== "string"))) {
		issues.push("changeLog: must be an array of strings when present.");
	}
	return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Revision rules (living documents)
// ---------------------------------------------------------------------------

/**
 * Living-documents revision rules applied to dev-order data:
 *  1. Append-only step IDs — every baseline step must still be present.
 *  2. Version must strictly increase.
 */
export function diffDevOrderData(baseline: DevOrderData, updated: DevOrderData): DevOrderValidation {
	const issues: string[] = [];
	const updatedIds = new Set(updated.steps.map((s) => s.id));
	for (const step of baseline.steps) {
		if (!updatedIds.has(step.id)) {
			issues.push(
				`append-only violation: baseline step "${step.id}" is missing from the revision. ` +
					`Keep it (mark it superseded in its rationale) instead of deleting.`,
			);
		}
	}
	if (compareVersions(updated.version, baseline.version) <= 0) {
		issues.push(
			`version must strictly increase (baseline ${baseline.version} → revision ${updated.version}).`,
		);
	}
	return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render the published markdown from the data. The `## Recommended
 * Execution Plan` section carries the mandatory `AFs: AF-N, …` line per
 * step (Layer-2 ID coverage scrapes it). Includes a minimal
 * frontmatter; approve stamps the rest.
 */
export function renderDevOrderMarkdown(data: DevOrderData): string {
	const lines: string[] = [
		"---",
		`artifact: development-order`,
		`project: ${data.project}`,
		`version: ${data.version}`,
		"---",
		"",
		`# Development Order — ${data.project}`,
		"",
		"## Final Order",
		"",
		"| Rank | Module | Depends on | Rationale |",
		"|---|---|---|---|",
		...data.steps.map((s, i) =>
			`| ${i + 1} | ${s.module} | ${s.dependsOn.length > 0 ? s.dependsOn.join(", ") : "—"} | ${s.rationale ?? "—"} |`),
		"",
		"## Recommended Execution Plan",
		"",
		...data.steps.flatMap((s, i) => [
			`${i + 1}. **${s.id}:** ${s.module}`,
			`   AFs: ${s.afs.length > 0 ? s.afs.join(", ") : "(none)"}`,
		]),
		"",
	];

	if (data.changeLog && data.changeLog.length > 0) {
		lines.push("## Change Log", "", ...data.changeLog.map((e) => `- ${e}`), "");
	}
	return lines.join("\n");
}
