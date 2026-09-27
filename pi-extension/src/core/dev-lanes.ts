/**
 * core/dev-lanes.ts — execution-lane algorithm for Stage 9 (Layer 0; N16, Phase 7).
 *
 * The development-order stage upgrades from a linear implementation list to
 * EXECUTION LANES: a dynamic parallel/series workstream layout derived from
 * the project's own `step_dep` graph. The layout is computed HERE, by code —
 * never by the LLM. Scouts only propose; this module verifies and finalizes.
 *
 * Deterministic pipeline (instruction doc, "Lane algorithm spec"):
 *
 *   1. build + validate the DAG  — cycle ⇒ named path, dangling dep ⇒ error,
 *                                  self-edge ⇒ error (the LLM never "fixes"
 *                                  a cycle silently).
 *   2. topological levels        — level 0 = no deps, else 1 + max(preds).
 *                                  Levels ARE the series boundaries; same
 *                                  level = parallel candidates.
 *   3. greedy lane assignment    — levels in order, steps sorted by id;
 *                                  first lane whose LAST step is a direct
 *                                  predecessor, else first lane free at this
 *                                  level, else open a new lane. Cap merging
 *                                  (files.json `velpari.maxLanes`, default 4)
 *                                  folds the smallest lanes into their most
 *                                  connected neighbour without ever
 *                                  reordering steps inside a lane.
 *   4. emit the lane map         — per lane { laneId, steps, worktree, branch,
 *                                  status } with worktree === branch (the
 *                                  N5/N6 name-match rule), plus the
 *                                  integration plan (merge order from the
 *                                  first series boundary where another lane's
 *                                  step needs this lane) and the recorded
 *                                  cross-lane integration points.
 *
 * Layer 0 — pure domain primitive. Imports nothing from `src/`.
 */

/** Lane lifecycle state. Publish always stamps "active"; transitions beyond
 *  that (complete → parked → merged) are Senai-side execution facts. */
export type LaneStatus = "active" | "complete" | "parked" | "merged";

/** The 4-state domain set — mirrors `LaneStatus` + the `dev_lane` DDL CHECK. */
export const LANE_STATUSES: readonly string[] = [
	"active",
	"complete",
	"parked",
	"merged",
] satisfies readonly LaneStatus[];

/** One `dev_step` as the algorithm needs it (id + optional module for naming). */
export interface LaneStepInput {
	/** Step id, e.g. "DO-1". */
	readonly stepId: string;
	/** Step module (used to slugify the lane's worktree/branch name). */
	readonly module?: string;
}

/** One `step_dep` edge: `dependsOnStepId` must finish before `stepId` starts. */
export interface LaneDepInput {
	/** The dependent step. */
	readonly stepId: string;
	/** The prerequisite step. */
	readonly dependsOnStepId: string;
}

/** One row of the `dev_lane` table / payload row-set (the scout proposal). */
export interface LaneProposal {
	laneId: string;
	stepId: string;
	position: number;
	worktree: string;
	branch: string;
	status?: LaneStatus;
}

/** A cross-lane dependency with its recorded integration boundary. */
export interface LaneXdep {
	stepId: string;
	dependsOnStepId: string;
	/** Topological level of `stepId` — the series boundary where the two lanes integrate. */
	boundaryLevel: number;
}

/** One execution lane: steps in topological order + its git mapping. */
export interface Lane {
	laneId: string;
	steps: string[];
	/** Worktree folder relative to the repo parent — identical to `branch`. */
	worktree: string;
	/** Branch name — identical to `worktree` (name-match rule). */
	branch: string;
	status: LaneStatus;
}

/** One entry of the integration plan (lane merge order). */
export interface IntegrationEntry {
	laneId: string;
	/** First series boundary where a downstream step in another lane needs this lane. */
	mergeLevel: number;
	/** 1-based merge order (mergeLevel ascending, ties by laneId). */
	order: number;
}

/** The full lane map handed to the renderer, store and handoff payload. */
export interface LanePlan {
	lanes: Lane[];
	/** stepId → topological level. */
	level: Record<string, number>;
	/** Steps per level (levelSizes[N] = steps at level N) — the series boundaries. */
	levelSizes: number[];
	/** Emergent shape derived from levelSizes (>1 = parallel, 1 = series). */
	shape: ("parallel" | "series")[];
	/** Every cross-lane dependency edge with its recorded boundary level. */
	xdeps: LaneXdep[];
	/** Lane merge order + gates. */
	integration: IntegrationEntry[];
}

/** Machine-readable lane problem codes (payload errors + doctor findings). */
export type LaneProblemCode =
	| "cycle"
	| "dangling-dep"
	| "self-edge"
	| "duplicate-step-id"
	| "unknown-step"
	| "step-missing-from-lane"
	| "step-in-two-lanes"
	| "lane-topology"
	| "lane-cap"
	| "name-mismatch"
	| "duplicate-lane-id"
	| "bad-lane-id"
	| "bad-boundary";

/** One validation failure. `message` is always safe to show the developer. */
export interface LaneProblem {
	code: LaneProblemCode;
	message: string;
	/** Supporting ids (cycle path, missing steps, …). */
	detail?: string[];
}

/** Result of `computeLanes` — either a complete plan or the problems that blocked it. */
export type LaneResult = { ok: true; plan: LanePlan } | { ok: false; problems: LaneProblem[] };

/** Publish-gate view of the finalized lane data (`ops/approve.ts` → `doctor/gate.ts`). */
export interface DevLanesGateData {
	/** `dev_step` rows. */
	steps: LaneStepInput[];
	/** `step_dep` edges. */
	deps: LaneDepInput[];
	/** Finalized `dev_lane` rows (scout proposal or the canonical map). */
	proposal: LaneProposal[];
	/** Cross-lane integration points passed to `verifyLaneProposal`. */
	xdeps: LaneXdep[];
}

/** Default lane cap (files.json `velpari.maxLanes`). */
export const DEFAULT_MAX_LANES = 4;

/**
 * Lock rules emitted verbatim by the renderer and carried into the handoff
 * payload. They encode the rollout lessons: parked lanes re-gate before they
 * merge (lesson 1), the merge order is explicit and machine-checked (lesson
 * 2), and files no lane owns merge only at an integration boundary (lesson 3).
 */
export const LANE_LOCK_RULES: readonly string[] = [
	"A lane is locked for edit once its merge starts; it unlocks when the merge commit lands on the integration branch.",
	"A lane whose steps complete before its series boundary enters `parked` (locked for edit) and must re-verify — rebuild + tests + doctor audit — against the current integration branch before it may merge.",
	"Every merge is gated by tests green + a doctor audit; a lane never merges ahead of its integration order.",
	"Files outside every lane's declared ownership merge only at an integration boundary, never inside a lane.",
	"A level-(N+1) step cannot start until every level-N lane it depends on has merged; a feeding lane with an open dependency stays blocked.",
];

/** Merge gates attached to every integration-plan row. */
export const LANE_MERGE_GATES: readonly string[] = ["tests green", "doctor audit"];

// ---------------------------------------------------------------------------
// Naming (N5/N6 name-match rule)
// ---------------------------------------------------------------------------

const LANE_ID_PATTERN = /^lane-(\d+)$/;
const SAFE_NAME_CHARS = /^[A-Za-z0-9._/-]+$/;

/** Lowercase, non-alphanumerics collapse to "-", trim "-". Empty ⇒ "step". */
export function slugify(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug === "" ? "step" : slug;
}

/**
 * Build the shared lane name: `<projectSlug>/lane-<n>-<slug>` — used as BOTH
 * the worktree folder (relative to the repo parent) and the branch, which is
 * the name-match rule.
 */
export function buildLaneName(projectSlug: string, laneNumber: number, slug: string): string {
	return `${projectSlug}/lane-${laneNumber}-${slug}`;
}

// ---------------------------------------------------------------------------
// Graph analysis (shared by computeLanes + verifyLaneProposal)
// ---------------------------------------------------------------------------

interface GraphAnalysis {
	problems: LaneProblem[];
	/** Sorted unique step ids. */
	nodes: string[];
	/** stepId → prerequisite step ids. */
	preds: Map<string, string[]>;
	/** stepId → dependent step ids. */
	children: Map<string, string[]>;
	/** stepId → topological level (0 when no deps). */
	level: Record<string, number>;
	/** Steps per level, index = level. */
	levelSizes: number[];
}

/** Build + validate the DAG and compute levels. O(V+E). */
function analyze(steps: readonly LaneStepInput[], deps: readonly LaneDepInput[]): GraphAnalysis {
	const problems: LaneProblem[] = [];
	const seen = new Set<string>();
	const nodes: string[] = [];
	for (const step of steps) {
		if (seen.has(step.stepId)) {
			problems.push({ code: "duplicate-step-id", message: `duplicate step id "${step.stepId}"` });
			continue;
		}
		seen.add(step.stepId);
		nodes.push(step.stepId);
	}
	nodes.sort();

	const preds = new Map<string, string[]>();
	const children = new Map<string, string[]>();
	for (const id of nodes) {
		preds.set(id, []);
		children.set(id, []);
	}

	for (const dep of deps) {
		if (dep.stepId === dep.dependsOnStepId) {
			problems.push({ code: "self-edge", message: `step "${dep.stepId}" depends on itself` });
			continue;
		}
		if (!seen.has(dep.stepId) || !seen.has(dep.dependsOnStepId)) {
			const missing = !seen.has(dep.stepId) ? dep.stepId : dep.dependsOnStepId;
			problems.push({
				code: "dangling-dep",
				message: `dependency references unknown step "${missing}"`,
				detail: [dep.stepId, dep.dependsOnStepId],
			});
			continue;
		}
		preds.get(dep.stepId)?.push(dep.dependsOnStepId);
		children.get(dep.dependsOnStepId)?.push(dep.stepId);
	}
	for (const list of preds.values()) list.sort();
	for (const list of children.values()) list.sort();

	// Kahn — cycle detection with a named path.
	const indegree = new Map<string, number>();
	const queue: string[] = [];
	for (const id of nodes) {
		const deg = preds.get(id)?.length ?? 0;
		indegree.set(id, deg);
		if (deg === 0) queue.push(id);
	}
	const level: Record<string, number> = {};
	for (const id of nodes) level[id] = 0;
	const order: string[] = [];
	for (let qi = 0; qi < queue.length; qi++) {
		const id = queue[qi] as string;
		order.push(id);
		for (const child of children.get(id) ?? []) {
			level[child] = Math.max(level[child] ?? 0, (level[id] ?? 0) + 1);
			const deg = (indegree.get(child) ?? 1) - 1;
			indegree.set(child, deg);
			if (deg === 0) queue.push(child);
		}
	}
	if (order.length < nodes.length) {
		const inCycle = nodes.filter((id) => (indegree.get(id) ?? 0) > 0);
		const path = findCyclePath(inCycle, children, preds);
		problems.push({
			code: "cycle",
			message: `dependency cycle: ${path.join(" -> ")}`,
			detail: path,
		});
		return { problems, nodes, preds, children, level, levelSizes: [] };
	}

	const maxLevel = nodes.reduce((max, id) => Math.max(max, level[id] ?? 0), 0);
	const levelSizes: number[] = Array.from({ length: maxLevel + 1 }, () => 0);
	for (const id of nodes) {
		const lv = level[id] ?? 0;
		levelSizes[lv] = (levelSizes[lv] ?? 0) + 1;
	}

	return { problems, nodes, preds, children, level, levelSizes };
}

/** Depth-first walk inside the unprocessed set → one cycle as a closed path. */
function findCyclePath(
	seeds: readonly string[],
	children: Map<string, string[]>,
	preds: Map<string, string[]>,
): string[] {
	const remaining = new Set(seeds);
	const start = seeds[0] ?? "?";
	const path: string[] = [];
	const onPath = new Set<string>();
	let cycle: string[] | null = null;

	const visit = (id: string): boolean => {
		path.push(id);
		onPath.add(id);
		for (const child of children.get(id) ?? []) {
			if (!remaining.has(child)) continue;
			if (onPath.has(child)) {
				const from = path.indexOf(child);
				cycle = [...path.slice(from), child];
				return true;
			}
			if (visit(child)) return true;
		}
		path.pop();
		onPath.delete(id);
		return false;
	};

	if (!visit(start)) {
		// Defensive: walk predecessors instead (the cycle is guaranteed to
		// exist among `seeds`, but the forward walk can stop at a sink).
		const back: string[] = [];
		let id = start;
		while (remaining.has(id) && !back.includes(id)) {
			back.push(id);
			id = preds.get(id)?.[0] ?? id;
			if (back.includes(id)) break;
		}
		const from = back.indexOf(id);
		cycle = from >= 0 ? [...back.slice(from), id] : [...back, back[0] ?? "?"];
	}
	return cycle ?? [start, start];
}

// ---------------------------------------------------------------------------
// Lane assignment
// ---------------------------------------------------------------------------

function assignLanes(analysis: GraphAnalysis): Array<{ laneId: string; steps: string[] }> {
	const { nodes, preds, level } = analysis;
	const byLevel = new Map<number, string[]>();
	for (const id of nodes) {
		const lv = level[id] ?? 0;
		const bucket = byLevel.get(lv) ?? [];
		bucket.push(id);
		byLevel.set(lv, bucket);
	}

	const lanes: Array<{ laneId: string; steps: string[] }> = [];
	const maxLevel = analysis.levelSizes.length - 1;
	for (let lv = 0; lv <= maxLevel; lv++) {
		const levelSteps = (byLevel.get(lv) ?? []).slice().sort();
		const usedAtLevel = new Set<number>();
		for (const stepId of levelSteps) {
			// (a) dependency handoff stays in-lane where possible
			let idx = lanes.findIndex((lane) => {
				const last = lane.steps[lane.steps.length - 1];
				return last !== undefined && (preds.get(stepId) ?? []).includes(last);
			});
			// (b) first lane free at this level
			if (idx < 0) idx = lanes.findIndex((_, i) => !usedAtLevel.has(i));
			// (c) open a new lane
			if (idx < 0) {
				lanes.push({ laneId: `lane-${lanes.length + 1}`, steps: [] });
				idx = lanes.length - 1;
			}
			lanes[idx]?.steps.push(stepId);
			usedAtLevel.add(idx);
		}
	}
	return lanes;
}

/** Cap merge: smallest lane (fewest steps, tie ⇒ lexicographically first laneId)
 *  folds into its most-connected neighbour (most crossing dep edges, tie ⇒
 *  lexicographically first laneId). Steps keep relative order (stable merge
 *  by level). Lane ids are renumbered afterwards. */
function mergeToCap(
	lanes: Array<{ laneId: string; steps: string[] }>,
	analysis: GraphAnalysis,
	maxLanes: number,
): Array<{ laneId: string; steps: string[] }> {
	const working = lanes.map((lane) => ({ laneId: lane.laneId, steps: [...lane.steps] }));
	const laneOf = new Map<string, number>();
	const refresh = (): void => {
		laneOf.clear();
		working.forEach((lane, i) => {
			for (const s of lane.steps) laneOf.set(s, i);
		});
	};
	refresh();

	const crossingEdges = (a: number, b: number): number => {
		const laneA = working[a];
		const laneB = working[b];
		if (!laneA || !laneB) return 0;
		let count = 0;
		const touch = (i: number, j: number): void => {
			const lane = working[i];
			if (!lane) return;
			for (const step of lane.steps) {
				for (const pred of analysis.preds.get(step) ?? []) {
					if (laneOf.get(pred) === j) count++;
				}
				for (const child of analysis.children.get(step) ?? []) {
					if (laneOf.get(child) === j) count++;
				}
			}
		};
		touch(a, b);
		touch(b, a);
		return count;
	};

	while (working.length > maxLanes) {
		let victim = 0;
		for (let i = 1; i < working.length; i++) {
			const cur = working[i];
			const best = working[victim];
			if (!cur || !best) continue;
			if (
				cur.steps.length < best.steps.length ||
				(cur.steps.length === best.steps.length && cur.laneId < best.laneId)
			) {
				victim = i;
			}
		}
		let target = -1;
		let bestScore = -1;
		for (let i = 0; i < working.length; i++) {
			if (i === victim) continue;
			const score = crossingEdges(victim, i);
			const cur = working[i];
			const best = working[target];
			if (
				score > bestScore ||
				(score === bestScore && cur !== undefined && best !== undefined && cur.laneId < best.laneId)
			) {
				target = i;
				bestScore = score;
			}
		}
		if (target < 0) break; // single lane cannot merge further
		const victimSteps = working[victim]?.steps ?? [];
		const targetLane = working[target];
		if (!targetLane) break;
		const combined = [...targetLane.steps, ...victimSteps];
		combined.sort((x, y) => (analysis.level[x] ?? 0) - (analysis.level[y] ?? 0));
		targetLane.steps = combined;
		working.splice(victim, 1);
		refresh();
	}

	// Renumber to lane-1..lane-N (stable by original creation order).
	return working;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the canonical lane map for a project's step graph.
 *
 * Never throws: an invalid graph (cycle, dangling dep, self-edge, duplicate
 * id) returns `{ ok:false, problems }` with the cycle path named — publish
 * hard-blocks on those, and the LLM never repairs them silently.
 *
 * @param steps - `dev_step` rows for the run.
 * @param deps - `step_dep` edges (`dependsOnStepId` finishes first).
 * @param opts - `maxLanes` (default 4), `projectSlug` (lane name prefix),
 *               `slugs` (stepId → preferred lane slug for the lane it opens).
 * @returns The lane plan, or the problems that blocked it.
 */
export function computeLanes(
	steps: readonly LaneStepInput[],
	deps: readonly LaneDepInput[],
	opts?: { maxLanes?: number; projectSlug?: string; slugs?: Record<string, string> },
): LaneResult {
	const analysis = analyze(steps, deps);
	if (analysis.problems.length > 0) return { ok: false, problems: analysis.problems };
	if (analysis.nodes.length === 0) {
		return { ok: false, problems: [{ code: "unknown-step", message: "no steps to lane" }] };
	}

	const maxLanes = Math.max(1, opts?.maxLanes ?? DEFAULT_MAX_LANES);
	let lanes = assignLanes(analysis);
	if (lanes.length > maxLanes) lanes = mergeToCap(lanes, analysis, maxLanes);

	const projectSlug = slugify(opts?.projectSlug?.trim() || "project");
	const moduleOf = new Map<string, string>();
	for (const step of steps) if (step.module !== undefined) moduleOf.set(step.stepId, step.module);

	const planLanes: Lane[] = lanes.map((lane, index) => {
		const first = lane.steps[0] ?? lane.laneId;
		const slug = opts?.slugs?.[first] ?? slugify(moduleOf.get(first) ?? first);
		const name = buildLaneName(projectSlug, index + 1, slug);
		return { laneId: `lane-${index + 1}`, steps: lane.steps, worktree: name, branch: name, status: "active" };
	});

	return { ok: true, plan: finalizePlan(planLanes, analysis) };
}

/** Derive xdeps, shape and integration order for a finalized lane list. */
function finalizePlan(lanes: Lane[], analysis: GraphAnalysis): LanePlan {
	const laneIndex = new Map<string, number>();
	lanes.forEach((lane, i) => {
		for (const s of lane.steps) laneIndex.set(s, i);
	});

	const xdeps: LaneXdep[] = [];
	for (const id of analysis.nodes) {
		for (const pred of analysis.preds.get(id) ?? []) {
			const here = laneIndex.get(id);
			const there = laneIndex.get(pred);
			if (here !== undefined && there !== undefined && here !== there) {
				xdeps.push({ stepId: id, dependsOnStepId: pred, boundaryLevel: analysis.level[id] ?? 0 });
			}
		}
	}
	xdeps.sort((a, b) =>
		a.stepId === b.stepId ? a.dependsOnStepId.localeCompare(b.dependsOnStepId) : a.stepId.localeCompare(b.stepId),
	);

	const integration: Array<{ laneId: string; mergeLevel: number; order: number }> = lanes.map((lane) => {
		const outgoing = xdeps.filter((x) => lane.steps.includes(x.dependsOnStepId) && !lane.steps.includes(x.stepId));
		const ownMax = lane.steps.reduce((max, s) => Math.max(max, analysis.level[s] ?? 0), 0);
		const mergeLevel = outgoing.length > 0 ? Math.min(...outgoing.map((x) => x.boundaryLevel)) : ownMax + 1;
		return { laneId: lane.laneId, mergeLevel, order: 0 };
	});
	integration.sort((a, b) =>
		a.mergeLevel === b.mergeLevel ? a.laneId.localeCompare(b.laneId) : a.mergeLevel - b.mergeLevel,
	);
	integration.forEach((entry, i) => {
		entry.order = i + 1;
	});

	const shape: Array<"parallel" | "series"> = analysis.levelSizes.map((size) => (size > 1 ? "parallel" : "series"));

	return {
		lanes,
		level: analysis.level,
		levelSizes: analysis.levelSizes,
		shape,
		xdeps,
		integration,
	};
}

/**
 * Validate a scout/LLM lane proposal against the graph. Returns every
 * problem found (empty array = the proposal is adoptable as-is).
 *
 * Checks: graph validity first (cycle/dangling/self-edge — the proposal can
 * never launder a bad graph), then coverage (every step in exactly one
 * lane), per-lane dependency order, the lane cap, worktree/branch
 * name-match + charset + uniqueness, and recorded cross-lane boundaries.
 *
 * @param proposal - Proposed `dev_lane` rows (may be empty → full coverage failure).
 * @param steps - `dev_step` rows for the run.
 * @param deps - `step_dep` edges.
 * @param opts - `maxLanes`, `projectSlug`, `xdeps` (recorded integration points to verify).
 * @returns Problems; empty when the proposal may be adopted.
 */
export function verifyLaneProposal(
	proposal: readonly LaneProposal[],
	steps: readonly LaneStepInput[],
	deps: readonly LaneDepInput[],
	opts?: { maxLanes?: number; projectSlug?: string; xdeps?: readonly LaneXdep[] },
): LaneProblem[] {
	const analysis = analyze(steps, deps);
	if (analysis.problems.length > 0) return analysis.problems;

	const problems: LaneProblem[] = [];
	const maxLanes = Math.max(1, opts?.maxLanes ?? DEFAULT_MAX_LANES);
	const projectSlug = slugify(opts?.projectSlug?.trim() || "project");

	// Group rows per lane; detect duplicate steps and metadata drift.
	const laneRows = new Map<string, LaneProposal[]>();
	const stepCount = new Map<string, number>();
	for (const row of proposal) {
		const rows = laneRows.get(row.laneId) ?? [];
		rows.push(row);
		laneRows.set(row.laneId, rows);
		stepCount.set(row.stepId, (stepCount.get(row.stepId) ?? 0) + 1);
	}

	const laneIds = [...laneRows.keys()].sort();
	if (laneIds.length > maxLanes) {
		problems.push({
			code: "lane-cap",
			message: `proposal opens ${laneIds.length} lanes but maxLanes is ${maxLanes}`,
			detail: laneIds,
		});
	}
	for (const id of laneIds) {
		if (!LANE_ID_PATTERN.test(id)) {
			problems.push({ code: "bad-lane-id", message: `invalid lane id "${id}" (expected lane-<n>)` });
		}
	}

	// Coverage: every step in exactly one lane.
	const missing = analysis.nodes.filter((id) => (stepCount.get(id) ?? 0) === 0);
	if (missing.length > 0) {
		problems.push({
			code: "step-missing-from-lane",
			message: `${missing.length} step(s) not assigned to any lane`,
			detail: missing,
		});
	}
	for (const [id, count] of [...stepCount.entries()].sort()) {
		if (count > 1) {
			problems.push({ code: "step-in-two-lanes", message: `step "${id}" appears in ${count} lanes` });
		}
	}
	const known = new Set(analysis.nodes);
	for (const id of [...stepCount.keys()].sort()) {
		if (!known.has(id)) {
			problems.push({ code: "unknown-step", message: `proposal carries unknown step "${id}"` });
		}
	}

	// Per-lane metadata consistency + name-match + topology.
	const namesSeen = new Map<string, string>();
	for (const laneId of laneIds) {
		const rows = (laneRows.get(laneId) ?? []).slice().sort((a, b) => a.position - b.position);
		const head = rows[0];
		if (!head) continue;

		const metaKey = `${head.worktree}|${head.branch}`;
		for (const row of rows) {
			if (`${row.worktree}|${row.branch}` !== metaKey) {
				problems.push({
					code: "duplicate-lane-id",
					message: `lane "${laneId}" has inconsistent worktree/branch across its rows`,
				});
				break;
			}
			if (row.worktree !== row.branch) {
				problems.push({
					code: "name-mismatch",
					message: `lane "${laneId}" worktree "${row.worktree}" does not match branch "${row.branch}" (name-match rule)`,
				});
				break;
			}
			if (!SAFE_NAME_CHARS.test(row.worktree) || row.worktree.includes("..")) {
				problems.push({
					code: "name-mismatch",
					message: `lane "${laneId}" name "${row.worktree}" contains unsafe characters`,
				});
				break;
			}
			const expectedPrefix = `${projectSlug}/lane-`;
			if (!row.worktree.startsWith(expectedPrefix)) {
				problems.push({
					code: "name-mismatch",
					message: `lane "${laneId}" name "${row.worktree}" must start with "${expectedPrefix}"`,
				});
				break;
			}
			const match = LANE_ID_PATTERN.exec(laneId);
			const nameLane = /^(\d+)-/.exec(row.worktree.slice(expectedPrefix.length));
			if (match && nameLane && match[1] !== nameLane[1]) {
				problems.push({
					code: "name-mismatch",
					message: `lane "${laneId}" name "${row.worktree}" carries a different lane number`,
				});
				break;
			}
		}
		const prior = namesSeen.get(head.worktree);
		if (prior !== undefined && prior !== laneId) {
			problems.push({
				code: "duplicate-lane-id",
				message: `name "${head.worktree}" is used by both "${prior}" and "${laneId}"`,
			});
		}
		namesSeen.set(head.worktree, laneId);

		// positions must be unique per lane and respect dependencies in-lane
		const positions = new Map<string, number>();
		for (const row of rows) {
			if (positions.has(row.stepId)) {
				problems.push({
					code: "lane-topology",
					message: `lane "${laneId}" lists step "${row.stepId}" twice`,
				});
			}
			positions.set(row.stepId, row.position);
		}
		for (const row of rows) {
			for (const pred of analysis.preds.get(row.stepId) ?? []) {
				const predPos = positions.get(pred);
				if (predPos !== undefined && predPos >= row.position) {
					problems.push({
						code: "lane-topology",
						message: `lane "${laneId}" orders "${row.stepId}" (position ${row.position}) before its dependency "${pred}" (position ${predPos})`,
					});
				}
			}
		}
	}

	// Recorded integration points (when supplied): must be real cross-lane
	// edges with the computed boundary level.
	if (opts?.xdeps) {
		const laneOf = new Map<string, string>();
		for (const laneId of laneIds) for (const row of laneRows.get(laneId) ?? []) laneOf.set(row.stepId, laneId);
		for (const x of opts.xdeps) {
			const edge = deps.find((d) => d.stepId === x.stepId && d.dependsOnStepId === x.dependsOnStepId);
			if (!edge) {
				problems.push({
					code: "bad-boundary",
					message: `integration point ${x.stepId} -> ${x.dependsOnStepId} is not a step dependency`,
				});
				continue;
			}
			if (laneOf.get(x.stepId) !== undefined && laneOf.get(x.stepId) === laneOf.get(x.dependsOnStepId)) {
				problems.push({
					code: "bad-boundary",
					message: `integration point ${x.stepId} -> ${x.dependsOnStepId} is not a cross-lane dependency`,
				});
				continue;
			}
			const expected = analysis.level[x.stepId] ?? 0;
			if (x.boundaryLevel !== expected) {
				problems.push({
					code: "bad-boundary",
					message: `integration point ${x.stepId} -> ${x.dependsOnStepId} records boundary ${x.boundaryLevel}, computed level is ${expected}`,
				});
			}
		}
	}

	return problems;
}

/**
 * Derive the renderable lane view from STORE/PAYLOAD ROWS (Phase 7 / 7.5).
 *
 * The renderer, `/velpari-export` and the handoff payload never re-plan: the
 * `dev_lane` rows are the authority — this helper only re-derives what the
 * rows imply (topological levels, lane order, integration merge order, shape)
 * so the published view, the YAML export and `architect-inputs.json` all
 * agree with the store. Lanes are grouped from flat rows, sorted by
 * `position` inside each lane and ordered `lane-<n>` numerically.
 *
 * @param laneRows - `dev_lane` rows (any input order).
 * @param steps - `dev_step` rows as algorithm inputs.
 * @param deps - `step_dep` edges as algorithm inputs.
 * @returns The lane plan, or `null` when the rows cannot form a graph
 *   (cycle / dangling dep / no steps / no lanes) — callers omit lane output
 *   rather than render invented data (the doctor reports the violation).
 */
export function laneViewFromRows(
	laneRows: readonly LaneProposal[],
	steps: readonly LaneStepInput[],
	deps: readonly LaneDepInput[],
): LanePlan | null {
	const analysis = analyze(steps, deps);
	if (analysis.problems.length > 0 || analysis.nodes.length === 0) return null;
	const byLane = new Map<string, LaneProposal[]>();
	for (const row of laneRows) {
		const list = byLane.get(row.laneId) ?? [];
		list.push(row);
		byLane.set(row.laneId, list);
	}
	const lanes: Lane[] = [...byLane.entries()]
		.sort(([a], [b]) => {
			const numA = /^lane-(\d+)$/.exec(a);
			const numB = /^lane-(\d+)$/.exec(b);
			if (numA && numB && numA[1] !== numB[1]) return Number(numA[1]) - Number(numB[1]);
			return a.localeCompare(b);
		})
		.map(([laneId, rows]) => {
			const ordered = [...rows].sort((a, b) => a.position - b.position);
			const head = ordered[0];
			return {
				laneId,
				steps: ordered.map((r) => r.stepId),
				worktree: head?.worktree ?? "",
				branch: head?.branch ?? "",
				status: head?.status ?? "active",
			};
		});
	if (lanes.length === 0) return null;
	return finalizePlan(lanes, analysis);
}
