/**
 * core/dev-lanes.ts tests (N16 — Stage 9 execution lanes, Phase 7).
 *
 * Covers: DAG build + cycle detection with a NAMED path, level computation
 * (worked example + edge cases), deterministic lane assignment, the lane cap
 * merge, the N5/N6 name-match rule, proposal verification (coverage,
 * topology, boundaries), and a light O(V+E) performance sanity.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	buildLaneName,
	computeLanes,
	DEFAULT_MAX_LANES,
	LANE_LOCK_RULES,
	slugify,
	verifyLaneProposal,
	type LaneDepInput,
	type LaneProposal,
	type LaneStepInput,
} from "../../src/core/dev-lanes.js";

function step(stepId: string, module?: string): LaneStepInput {
	return module === undefined ? { stepId } : { stepId, module };
}

function dep(stepId: string, dependsOnStepId: string): LaneDepInput {
	return { stepId, dependsOnStepId };
}

function proposalOf(result: ReturnType<typeof computeLanes>): LaneProposal[] {
	if (!result.ok) assert.fail(`expected ok plan, got problems: ${JSON.stringify(result.problems)}`);
	return result.plan.lanes.flatMap((lane) =>
		lane.steps.map((stepId, position) => ({
			laneId: lane.laneId,
			stepId,
			position,
			worktree: lane.worktree,
			branch: lane.branch,
			status: lane.status,
		})),
	);
}

describe("computeLanes — DAG validation", () => {
	it("names the cycle path when a cycle exists", () => {
		const steps = [step("DO-1"), step("DO-2"), step("DO-3")];
		const deps = [dep("DO-2", "DO-1"), dep("DO-3", "DO-2"), dep("DO-1", "DO-3")];
		const result = computeLanes(steps, deps);
		assert.equal(result.ok, false);
		if (result.ok) return;
		const cycle = result.problems.find((p) => p.code === "cycle");
		assert.ok(cycle, "cycle problem expected");
		assert.match(cycle.message, /dependency cycle: DO-/);
		assert.ok((cycle.detail ?? []).length >= 3, "cycle path named in detail");
		// closed path: first === last
		const detail = cycle.detail ?? [];
		assert.equal(detail[0], detail[detail.length - 1]);
	});

	it("rejects a dangling dependency", () => {
		const result = computeLanes([step("DO-1")], [dep("DO-1", "DO-99")]);
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.problems[0]?.code, "dangling-dep");
		assert.match(result.problems[0]?.message ?? "", /DO-99/);
	});

	it("rejects a self-edge", () => {
		const result = computeLanes([step("DO-1")], [dep("DO-1", "DO-1")]);
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.problems[0]?.code, "self-edge");
	});

	it("rejects duplicate step ids", () => {
		const result = computeLanes([step("DO-1"), step("DO-1")], []);
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.problems[0]?.code, "duplicate-step-id");
	});
});

describe("computeLanes — worked example (parallel → series → parallel → series)", () => {
	// Graph: A,B independent → C deps A+B → D,E independent both dep C → F deps D+E
	const steps = [step("A"), step("B"), step("C"), step("D"), step("E"), step("F")];
	const deps = [dep("C", "A"), dep("C", "B"), dep("D", "C"), dep("E", "C"), dep("F", "D"), dep("F", "E")];

	it("emerges the expected shape from the graph, not a template", () => {
		const result = computeLanes(steps, deps, { projectSlug: "TestApp" });
		assert.equal(result.ok, true);
		if (!result.ok) return;

		assert.deepEqual(result.plan.levelSizes, [2, 1, 2, 1]);
		assert.deepEqual(result.plan.shape, ["parallel", "series", "parallel", "series"]);
		assert.equal(result.plan.lanes.length, 2);
		assert.deepEqual(
			result.plan.lanes.map((l) => [l.laneId, l.steps]),
			[
				["lane-1", ["A", "C", "D", "F"]],
				["lane-2", ["B", "E"]],
			],
		);
		// levels
		assert.deepEqual(result.plan.level, { A: 0, B: 0, C: 1, D: 2, E: 2, F: 3 });
	});

	it("maps both lanes to matching worktree + branch (name-match rule)", () => {
		const result = computeLanes(steps, deps, { projectSlug: "TestApp" });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		for (const lane of result.plan.lanes) {
			assert.equal(lane.worktree, lane.branch, "worktree === branch");
			assert.match(lane.worktree, /^testapp\/lane-\d+-[a-z0-9-]+$/);
		}
		assert.equal(result.plan.lanes[0]?.worktree, "testapp/lane-1-a");
		assert.equal(result.plan.lanes[1]?.worktree, "testapp/lane-2-b");
		for (const lane of result.plan.lanes) assert.equal(lane.status, "active");
	});

	it("records cross-lane integration points at the computed boundary level", () => {
		const result = computeLanes(steps, deps, { projectSlug: "TestApp" });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.plan.xdeps, [
			{ stepId: "C", dependsOnStepId: "B", boundaryLevel: 1 },
			{ stepId: "E", dependsOnStepId: "C", boundaryLevel: 2 },
			{ stepId: "F", dependsOnStepId: "E", boundaryLevel: 3 },
		]);
		// lane-2 feeds lane-1's C at level 1 → merges first; lane-1 feeds E at level 2
		assert.deepEqual(
			result.plan.integration.map((i) => [i.laneId, i.mergeLevel, i.order]),
			[
				["lane-2", 1, 1],
				["lane-1", 2, 2],
			],
		);
	});
});

describe("computeLanes — level edge cases", () => {
	it("single step → one lane, series", () => {
		const result = computeLanes([step("DO-1")], [], { projectSlug: "P" });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.plan.shape, ["series"]);
		assert.equal(result.plan.lanes.length, 1);
		assert.deepEqual(result.plan.lanes[0]?.steps, ["DO-1"]);
		assert.deepEqual(result.plan.integration, [{ laneId: "lane-1", mergeLevel: 1, order: 1 }]);
	});

	it("pure chain → one lane, all-series, no cross-lane edges", () => {
		const steps = [step("A"), step("B"), step("C"), step("D")];
		const deps = [dep("B", "A"), dep("C", "B"), dep("D", "C")];
		const result = computeLanes(steps, deps, { projectSlug: "P" });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.plan.shape, ["series", "series", "series", "series"]);
		assert.equal(result.plan.lanes.length, 1);
		assert.deepEqual(result.plan.lanes[0]?.steps, ["A", "B", "C", "D"]);
		assert.deepEqual(result.plan.xdeps, []);
	});

	it("all-independent steps spread across lanes then merge down to maxLanes", () => {
		const steps = ["A", "B", "C", "D", "E", "F"].map((id) => step(id));
		const result = computeLanes(steps, [], { projectSlug: "P" });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(DEFAULT_MAX_LANES, 4);
		assert.equal(result.plan.lanes.length, 4);
		const all = result.plan.lanes.flatMap((l) => l.steps).sort();
		assert.deepEqual(all, ["A", "B", "C", "D", "E", "F"]);
		assert.deepEqual(result.plan.shape, ["parallel"]);
	});
});

describe("computeLanes — determinism", () => {
	const steps = [step("A"), step("B"), step("C"), step("D"), step("E"), step("F")];
	const deps = [dep("C", "A"), dep("C", "B"), dep("D", "C"), dep("E", "C"), dep("F", "D"), dep("F", "E")];

	it("same input → same output, twice", () => {
		const one = computeLanes(steps, deps, { projectSlug: "TestApp" });
		const two = computeLanes(steps, deps, { projectSlug: "TestApp" });
		assert.deepEqual(one, two);
	});

	it("shuffled input order → same output", () => {
		const base = computeLanes(steps, deps, { projectSlug: "TestApp" });
		const shuffled = computeLanes([...steps].reverse(), [...deps].reverse(), { projectSlug: "TestApp" });
		assert.deepEqual(base, shuffled);
	});
});

describe("computeLanes — lane cap merging", () => {
	it("merges 8 lanes down to maxLanes=4 deterministically, keeping every step", () => {
		const steps = ["A", "B", "C", "D", "E", "F", "G", "H"].map((id) => step(id));
		const result = computeLanes(steps, [], { projectSlug: "P", maxLanes: 4 });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.plan.lanes.length, 4);
		const all = result.plan.lanes.flatMap((l) => l.steps);
		assert.equal(all.length, 8, "no step lost in a merge");
		assert.deepEqual([...all].sort(), ["A", "B", "C", "D", "E", "F", "G", "H"]);
		// lane ids stay contiguous after the merge
		assert.deepEqual(
			result.plan.lanes.map((l) => l.laneId),
			["lane-1", "lane-2", "lane-3", "lane-4"],
		);
		// merged lanes keep matching worktree/branch with the NEW lane number
		for (const [i, lane] of result.plan.lanes.entries()) {
			assert.equal(lane.worktree, lane.branch);
			assert.match(lane.worktree, new RegExp(`^p/lane-${i + 1}-`));
		}
		// determinism under the cap
		const again = computeLanes([...steps].reverse(), [], { projectSlug: "P", maxLanes: 4 });
		assert.deepEqual(result, again);
	});

	it("honours maxLanes=2", () => {
		const steps = ["A", "B", "C", "D"].map((id) => step(id));
		const result = computeLanes(steps, [], { projectSlug: "P", maxLanes: 2 });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.plan.lanes.length, 2);
	});

	it("prefers the module as the lane slug", () => {
		const steps = [step("DO-1", "M-3 (database-schema)"), step("DO-2", "M-1 (auth service)")];
		const result = computeLanes(steps, [], { projectSlug: "TestApp" });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.plan.lanes[0]?.worktree, "testapp/lane-1-m-3-database-schema");
		assert.equal(result.plan.lanes[1]?.worktree, "testapp/lane-2-m-1-auth-service");
	});
});

describe("verifyLaneProposal", () => {
	const steps = [step("A"), step("B"), step("C"), step("D"), step("E"), step("F")];
	const deps = [dep("C", "A"), dep("C", "B"), dep("D", "C"), dep("E", "C"), dep("F", "D"), dep("F", "E")];
	const opts = { projectSlug: "TestApp", maxLanes: 4 };

	const canonical = (): { proposal: LaneProposal[]; xdeps: ReturnType<typeof computeLanes> } => {
		const result = computeLanes(steps, deps, opts);
		assert.equal(result.ok, true);
		return { proposal: proposalOf(result), xdeps: result };
	};

	it("accepts the canonical proposal (empty problem list)", () => {
		const { proposal, xdeps } = canonical();
		if (!xdeps.ok) return assert.fail("canonical plan missing");
		assert.deepEqual(verifyLaneProposal(proposal, steps, deps, { ...opts, xdeps: xdeps.plan.xdeps }), []);
	});

	it("flags a step assigned to two lanes", () => {
		const { proposal } = canonical();
		const tampered = [...proposal, { ...(proposal[0] as LaneProposal), laneId: "lane-2" }];
		const problems = verifyLaneProposal(tampered, steps, deps, opts);
		assert.ok(problems.some((p) => p.code === "step-in-two-lanes"));
	});

	it("flags a step assigned to no lane", () => {
		const { proposal } = canonical();
		const problems = verifyLaneProposal(
			proposal.filter((r) => r.stepId !== "F"),
			steps,
			deps,
			opts,
		);
		const problem = problems.find((p) => p.code === "step-missing-from-lane");
		assert.ok(problem);
		assert.deepEqual(problem.detail, ["F"]);
	});

	it("flags an in-lane order that violates a dependency", () => {
		const { proposal } = canonical();
		// swap A and C inside lane-1 (C depends on A)
		const tampered = proposal.map((row) => {
			if (row.laneId !== "lane-1") return row;
			if (row.stepId === "A") return { ...row, position: 1 };
			if (row.stepId === "C") return { ...row, position: 0 };
			return row;
		});
		const problems = verifyLaneProposal(tampered, steps, deps, opts);
		assert.ok(problems.some((p) => p.code === "lane-topology"));
	});

	it("flags a proposal over the lane cap", () => {
		const independent = ["A", "B", "C", "D", "E"].map((id) => step(id));
		// a hand-built LLM proposal (computeLanes itself would have merged to the cap)
		const proposal: LaneProposal[] = independent.map((s, i) => {
			const laneId = `lane-${i + 1}`;
			const name = `testapp/lane-${i + 1}-${s.stepId.toLowerCase()}`;
			return { laneId, stepId: s.stepId, position: 0, worktree: name, branch: name, status: "active" };
		});
		const problems = verifyLaneProposal(proposal, independent, [], opts);
		assert.ok(problems.some((p) => p.code === "lane-cap"));
	});

	it("flags worktree/branch name mismatch", () => {
		const { proposal } = canonical();
		const tampered = proposal.map((row) =>
			row.laneId === "lane-1" ? { ...row, branch: "testapp/lane-1-other" } : row,
		);
		const problems = verifyLaneProposal(tampered, steps, deps, opts);
		assert.ok(problems.some((p) => p.code === "name-mismatch"));
	});

	it("flags a name under the wrong project prefix", () => {
		const { proposal } = canonical();
		const tampered = proposal.map((row) =>
			row.laneId === "lane-2" ? { ...row, worktree: "other/lane-2-b", branch: "other/lane-2-b" } : row,
		);
		const problems = verifyLaneProposal(tampered, steps, deps, opts);
		assert.ok(problems.some((p) => p.code === "name-mismatch"));
	});

	it("flags a recorded boundary that disagrees with the computed level", () => {
		const { proposal, xdeps } = canonical();
		if (!xdeps.ok) return assert.fail("canonical plan missing");
		const wrong = xdeps.plan.xdeps.map((x) => (x.stepId === "E" ? { ...x, boundaryLevel: 0 } : x));
		const problems = verifyLaneProposal(proposal, steps, deps, { ...opts, xdeps: wrong });
		assert.ok(problems.some((p) => p.code === "bad-boundary"));
		assert.match(problems.find((p) => p.code === "bad-boundary")?.message ?? "", /computed level is 2/);
	});

	it("surfaces a cycle in the graph before looking at the proposal", () => {
		const cyclicDeps = [dep("C", "A"), dep("A", "C")];
		const problems = verifyLaneProposal([], steps, cyclicDeps, opts);
		assert.ok(problems.some((p) => p.code === "cycle"));
	});

	it("flags an unknown step carried by the proposal", () => {
		const { proposal } = canonical();
		const tampered = [...proposal, { ...(proposal[0] as LaneProposal), stepId: "DO-99" }];
		const problems = verifyLaneProposal(tampered, steps, deps, opts);
		assert.ok(problems.some((p) => p.code === "unknown-step"));
	});
});

describe("helpers", () => {
	it("slugify collapses separators and never returns empty", () => {
		assert.equal(slugify("M-3 (database-schema)"), "m-3-database-schema");
		assert.equal(slugify("TestApp"), "testapp");
		assert.equal(slugify("  ---  "), "step");
	});

	it("buildLaneName keeps folder == branch (name-match rule)", () => {
		assert.equal(buildLaneName("proj", 2, "core"), "proj/lane-2-core");
	});

	it("publishes the lock rules the renderer + handoff emit", () => {
		assert.ok(LANE_LOCK_RULES.length >= 4);
		assert.ok(LANE_LOCK_RULES.some((r) => r.includes("parked")));
		assert.ok(LANE_LOCK_RULES.some((r) => r.includes("locked for edit")));
	});
});

describe("performance sanity (light)", () => {
	it("computes a synthetic 500-step graph well under 2s", () => {
		// 10 layers x 50 steps; each step depends on 2 deterministic predecessors.
		const steps: LaneStepInput[] = [];
		const deps: LaneDepInput[] = [];
		for (let layer = 0; layer < 10; layer++) {
			for (let i = 0; i < 50; i++) {
				const id = `S-${layer}-${i}`;
				steps.push(step(id));
				if (layer > 0) {
					deps.push(dep(id, `S-${layer - 1}-${(i * 7) % 50}`));
					deps.push(dep(id, `S-${layer - 1}-${(i * 13 + 1) % 50}`));
				}
			}
		}
		const started = Date.now();
		const result = computeLanes(steps, deps, { projectSlug: "Perf", maxLanes: 8 });
		const elapsed = Date.now() - started;
		assert.equal(result.ok, true);
		assert.ok(elapsed < 2000, `500-step compute took ${elapsed}ms`);
	});
});
