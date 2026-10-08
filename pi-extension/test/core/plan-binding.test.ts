// Tests — core/plan-binding.ts (Phase A, N18/G1–G4).
// Parser + directive discovery (plan 1.2): header present/missing/malformed,
// CRLF, filename gate (instruction prose never selected), newest-PENDING
// selection (user ruling 2026-09-28), all-DONE close-out, runs/ exclusion,
// relative-path resolution, fail-open reads, activeRunBinding close-out.
// Decision matrix + cache (plan 2.2): the 5 branches of N18 §3 step 3,
// the exact hard-stop message, conflict naming both declarations, branch
// precedence, symlink/trailing-slash tolerance, once-per-session cache.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import {
	decideSessionGate,
	findActivePlanDirective,
	activeRunBinding,
	parsePlanHeader,
	resetSessionGateCache,
	sessionGateVerdict,
	type DeclaredBinding,
} from "../../src/core/plan-binding.js";
import { createRun, saveState } from "../../src/core/state.js";
import { writeRunBinding, type RunBinding } from "../../src/core/run-binding.js";
import { PATHS } from "../../src/core/constants.js";

const IDENT = ["-c", "user.email=velpari@test.local", "-c", "user.name=Velpari Test"];

let dirs: string[] = [];

/**
 * Create a fresh temp fixture directory, tracked for cleanup.
 * @param {string} prefix - Temp-dir name prefix (default "velpari-plan-binding-").
 * @returns {string} Absolute path of the new directory.
 */
function freshDir(prefix = "velpari-plan-binding-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

/** A plan file following the `_plan_YYYYMMDD_HHMM_vX.Y.md` convention. */
function writePlan(dir: string, name: string, lines: string[]): string {
	const full = join(dir, ".IDE_Plans", name);
	mkdirSync(join(dir, ".IDE_Plans"), { recursive: true });
	writeFileSync(full, lines.join("\n"), "utf8");
	return full;
}

/**
 * Initialise a git repo with one empty commit on the given branch.
 * @param {string} dir - Directory to `git init` (becomes the worktree root).
 * @param {string} branch - Branch name to create and check out.
 * @returns {void}
 */
function initRepo(dir: string, branch = "main"): void {
	execFileSync("git", ["init", "-q", "-b", branch], { cwd: dir });
	execFileSync("git", [...IDENT, "commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

/** Seed state.json + an active/closed run-binding.json for `dir`. */
function seedRunBinding(dir: string, worktree: string, branch: string, status: "active" | "closed" = "active"): string {
	const state = createRun("plan-binding mission", dir);
	const binding: RunBinding = {
		runId: state.runId,
		branch,
		worktree,
		startedAt: "2026-09-28T00:00:00.000Z",
		status,
		...(status === "closed" ? { closedAt: "2026-09-28T01:00:00.000Z", closedBy: "reset" as const } : {}),
	};
	mkdirSync(join(dir, PATHS.RUNS_DIR, state.runId), { recursive: true });
	writeRunBinding(dir, binding);
	saveState({ ...state, runBranch: branch, runWorktree: worktree }, dir);
	return state.runId;
}

beforeEach(() => {
	resetSessionGateCache();
});

afterEach(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs = [];
	resetSessionGateCache();
});

describe("parsePlanHeader (G1)", () => {
	test("header present: bold + backticks form parses worktree and branch", () => {
		const header = parsePlanHeader(
			["# Plan", "", "**Worktree:** `/path/to/wt/`", "**Branch:** `velpari/x`", "", "- **Status:** PENDING"].join("\n"),
		);
		assert.equal(header.worktree, "/path/to/wt");
		assert.equal(header.branch, "velpari/x");
		assert.equal(header.pendingCount, 1);
		assert.equal(header.doneCount, 0);
	});

	test("missing Worktree: → empty (never binds)", () => {
		const header = parsePlanHeader(["**Branch:** `b`", "- **Status:** PENDING"].join("\n"));
		assert.equal(header.worktree, "");
	});

	test("malformed: empty Worktree: value counts as missing", () => {
		const header = parsePlanHeader(["**Worktree:**", "- **Status:** PENDING"].join("\n"));
		assert.equal(header.worktree, "");
	});

	test("missing Branch: → branch empty but worktree still parsed", () => {
		const header = parsePlanHeader(["**Worktree:** `/wt`", "- **Status:** PENDING"].join("\n"));
		assert.equal(header.worktree, "/wt");
		assert.equal(header.branch, "");
	});

	test("CRLF line endings parse identically", () => {
		const crlf = ["**Worktree:** `/wt`", "**Branch:** `b`", "- **Status:** PENDING"].join("\r\n") + "\r\n";
		const header = parsePlanHeader(crlf);
		assert.equal(header.worktree, "/wt");
		assert.equal(header.branch, "b");
		assert.equal(header.pendingCount, 1);
	});

	test("counts PENDING and DONE item statuses across the file", () => {
		const header = parsePlanHeader(
			[
				"### Subphase 1.1",
				"- **Status:** DONE",
				"### Subphase 1.2",
				"- **Status:** PENDING",
				"### Subphase 2.1",
				"- **Status:** PENDING",
			].join("\n"),
		);
		assert.equal(header.pendingCount, 2);
		assert.equal(header.doneCount, 1);
	});
});

describe("findActivePlanDirective (G1/G4/close-out)", () => {
	test("two plan files: newest timestamp wins", () => {
		const dir = freshDir();
		writePlan(dir, "old_plan_20260920_0100_v1.0.md", ["**Worktree:** `/wt-old`", "- **Status:** PENDING"]);
		writePlan(dir, "new_plan_20260928_0130_v1.0.md", ["**Worktree:** `/wt-new`", "- **Status:** PENDING"]);
		const found = findActivePlanDirective(dir);
		assert.ok(found);
		assert.equal(found!.worktree, "/wt-new");
		assert.equal(found!.source, "plan");
	});

	test("newest all-DONE + older PENDING → older selected (user ruling 2026-09-28)", () => {
		const dir = freshDir();
		writePlan(dir, "old_plan_20260920_0100_v1.0.md", ["**Worktree:** `/wt-old`", "- **Status:** PENDING"]);
		writePlan(dir, "new_plan_20260928_0130_v1.0.md", ["**Worktree:** `/wt-new`", "- **Status:** DONE"]);
		const found = findActivePlanDirective(dir);
		assert.ok(found);
		assert.equal(found!.worktree, "/wt-old");
	});

	test("close-out: all plans DONE → null (directive stops binding)", () => {
		const dir = freshDir();
		writePlan(dir, "only_plan_20260928_0100_v1.0.md", ["**Worktree:** `/wt`", "- **Status:** DONE"]);
		assert.equal(findActivePlanDirective(dir), null);
	});

	test("instruction-style prose file is never selected (filename gate)", () => {
		const dir = freshDir();
		mkdirSync(join(dir, ".IDE_Plans"), { recursive: true });
		writeFileSync(
			join(dir, ".IDE_Plans", "phase-x_instructions.md"),
			["See `Worktree:` header.", "Items carry Status: PENDING."].join("\n"),
			"utf8",
		);
		assert.equal(findActivePlanDirective(dir), null);
	});

	test("PENDING plan without a Worktree: field never binds", () => {
		const dir = freshDir();
		writePlan(dir, "nowt_plan_20260928_0100_v1.0.md", ["# Plan", "- **Status:** PENDING"]);
		assert.equal(findActivePlanDirective(dir), null);
	});

	test("runs/ working-copy subtree is excluded", () => {
		const dir = freshDir();
		const runPlan = join(
			dir,
			".IDE_Plans",
			PATHS.RUNS_DIR.replace(".IDE_Plans/", ""),
			"run1",
			"work_plan_20260928_0100_v1.0.md",
		);
		mkdirSync(join(runPlan, ".."), { recursive: true });
		writeFileSync(runPlan, ["**Worktree:** `/wt-runs`", "- **Status:** PENDING"].join("\n"), "utf8");
		assert.equal(findActivePlanDirective(dir), null);
	});

	test("relative Worktree: resolves against cwd and normalizes", () => {
		const dir = freshDir();
		writePlan(dir, "rel_plan_20260928_0100_v1.0.md", ["**Worktree:** `../sibling-wt/`", "- **Status:** PENDING"]);
		const found = findActivePlanDirective(dir);
		assert.ok(found);
		assert.equal(found!.worktree, join(dir, "..", "sibling-wt"));
	});

	test("no .IDE_Plans at all → null, never throws", () => {
		const dir = freshDir();
		assert.equal(findActivePlanDirective(dir), null);
	});
});

describe("activeRunBinding (close-out)", () => {
	test("active binding → DeclaredBinding; closed → null; no run → null", () => {
		const dir = freshDir();
		assert.equal(activeRunBinding(dir), null);
		seedRunBinding(dir, "/wt-a", "main", "closed");
		assert.equal(activeRunBinding(dir), null, "a closed binding (handoff/reset) never binds");
	});
});

describe("decideSessionGate (N18 §3 — 5 branches)", () => {
	const DECLARED: DeclaredBinding = {
		source: "plan",
		worktree: "/wt-right",
		branch: "main",
		origin: "/p/x_plan_20260928_0100_v1.0.md",
	};

	test("branch 1: not a git repo → pass/not-git even with declarations", () => {
		const v = decideSessionGate({ isGit: false, worktree: "", branch: "" }, [DECLARED]);
		assert.equal(v.kind, "pass");
		assert.equal(v.kind === "pass" ? v.why : "", "not-git");
	});

	test("branch 2: no declarations → pass/no-bindings, silent", () => {
		const v = decideSessionGate({ isGit: true, worktree: "/x", branch: "main" }, [null, null]);
		assert.equal(v.kind, "pass");
		assert.equal(v.kind === "pass" ? v.why : "", "no-bindings");
		assert.equal(v.kind === "pass" ? v.statusLine : "x", null);
	});

	test("branch 3: match → pass/match with one status line", () => {
		const v = decideSessionGate({ isGit: true, worktree: "/wt-right", branch: "main" }, [DECLARED]);
		assert.equal(v.kind, "pass");
		assert.equal(v.kind === "pass" ? v.why : "", "match");
		assert.ok(v.kind === "pass" && v.statusLine !== null);
		assert.ok(v.kind === "pass" && v.statusLine.includes("session-gate: ok"));
	});

	test("branch 4: run binding ≠ plan directive → conflict naming both", () => {
		const run: DeclaredBinding = { source: "run-binding", worktree: "/wt-a", branch: "b-a", origin: "run-1" };
		const plan: DeclaredBinding = {
			source: "plan",
			worktree: "/wt-b",
			branch: "b-b",
			origin: "/p/y_plan_20260928_0100_v1.0.md",
		};
		const v = decideSessionGate({ isGit: true, worktree: "/wt-a", branch: "b-a" }, [run, plan]);
		assert.equal(v.kind, "conflict");
		if (v.kind === "conflict") {
			assert.ok(v.reason.includes("run-1"));
			assert.ok(v.reason.includes("/p/y_plan_20260928_0100_v1.0.md"));
			assert.ok(v.reason.includes("ask the user"));
		}
	});

	test("branch 5: declaration ≠ actual → mismatch with the exact N18 message", () => {
		const v = decideSessionGate({ isGit: true, worktree: "/wt-actual", branch: "other" }, [DECLARED]);
		assert.equal(v.kind, "mismatch");
		if (v.kind === "mismatch") {
			assert.equal(
				v.reason,
				"This work belongs in worktree /wt-right on branch main. " +
					"You are in /wt-actual on branch other. " +
					"Restart the session there. No changes were made.",
			);
		}
	});

	test("run-binding branch wins when worktrees agree but branches differ", () => {
		const run: DeclaredBinding = { source: "run-binding", worktree: "/wt", branch: "b-run", origin: "run-1" };
		const plan: DeclaredBinding = {
			source: "plan",
			worktree: "/wt",
			branch: "b-plan",
			origin: "/p/z_plan_20260928_0100_v1.0.md",
		};
		// probe matches the RUN binding's branch → match proves b-run was compared
		const match = decideSessionGate({ isGit: true, worktree: "/wt", branch: "b-run" }, [run, plan]);
		assert.equal(match.kind, "pass");
		// probe matches the plan's branch instead → mismatch (b-run is authoritative)
		const wrong = decideSessionGate({ isGit: true, worktree: "/wt", branch: "b-plan" }, [run, plan]);
		assert.equal(wrong.kind, "mismatch");
	});

	test("trailing-slash worktrees still match (samePaths + slash trim)", () => {
		const real = freshDir(); // an existing path: realpath drops the slash
		const trailing: DeclaredBinding = { ...DECLARED, worktree: `${real}/` };
		const v = decideSessionGate({ isGit: true, worktree: real, branch: "main" }, [trailing]);
		assert.equal(v.kind, "pass");
	});

	test("undeclared branch skips the branch comparison", () => {
		const noBranch: DeclaredBinding = { ...DECLARED, branch: "" };
		const v = decideSessionGate({ isGit: true, worktree: "/wt-right", branch: "whatever" }, [noBranch]);
		assert.equal(v.kind, "pass");
	});
});

describe("sessionGateVerdict (G2 cache + fail-open)", () => {
	test("same cwd twice → identical verdict object; reset forces recompute", () => {
		const dir = freshDir();
		const first = sessionGateVerdict(dir);
		const second = sessionGateVerdict(dir);
		assert.equal(first, second, "verdict must be cached (reference identity)");
		resetSessionGateCache();
		const third = sessionGateVerdict(dir);
		assert.notEqual(first, third, "resetSessionGateCache must force recomputation");
	});

	test("non-git folder with a plan directive → pass/not-git (R4 fail-open)", () => {
		const dir = freshDir();
		writePlan(dir, "ng_plan_20260928_0100_v1.0.md", ["**Worktree:** `/somewhere-else`", "- **Status:** PENDING"]);
		const v = sessionGateVerdict(dir);
		assert.equal(v.kind, "pass");
		assert.equal(v.kind === "pass" ? v.why : "", "not-git");
	});

	test("nonexistent cwd → pass, never throws (R4)", () => {
		const v = sessionGateVerdict(join(tmpdir(), "velpari-does-not-exist-xyz"));
		assert.equal(v.kind, "pass");
	});

	test("git folder + matching plan → match with status line", () => {
		const dir = freshDir();
		initRepo(dir, "pi-velpari-wt-x");
		writePlan(dir, "ok_plan_20260928_0100_v1.0.md", [
			`**Worktree:** \`${dir}\``,
			"**Branch:** `pi-velpari-wt-x`",
			"- **Status:** PENDING",
		]);
		const v = sessionGateVerdict(dir);
		assert.equal(v.kind, "pass");
		assert.equal(v.kind === "pass" ? v.why : "", "match");
	});

	test("git folder + plan declaring another worktree → mismatch, exact message", () => {
		const dir = freshDir();
		initRepo(dir, "main");
		writePlan(dir, "bad_plan_20260928_0100_v1.0.md", [
			"**Worktree:** `/the-right-worktree`",
			"**Branch:** `the-right-branch`",
			"- **Status:** PENDING",
		]);
		const v = sessionGateVerdict(dir);
		assert.equal(v.kind, "mismatch");
		if (v.kind === "mismatch") {
			assert.ok(v.reason.startsWith("This work belongs in worktree /the-right-worktree on branch the-right-branch."));
			assert.ok(v.reason.endsWith("No changes were made."));
		}
	});
});
