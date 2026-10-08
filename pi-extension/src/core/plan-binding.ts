/**
 * core/plan-binding.ts — plan-header worktree directives + session gate
 * (Layer 0; Phase A, N18/G1–G4).
 *
 * Two declared-binding sources for "which worktree/branch does this work
 * belong to?":
 *
 *   1. the live Velpari run binding (`run-binding.json`, Phase 5/N5) —
 *      active records only (handoff/reset close them → close-out);
 *   2. the active plan directive — the newest `*_plan_YYYYMMDD_HHMM_vX.Y.md`
 *      under `<cwd>/.IDE_Plans` (excluding the `runs/` subtree) that parses a
 *      non-empty `Worktree:` header AND still has ≥1 `Status: PENDING` item
 *      ("newest PENDING plan wins" — user ruling 2026-09-28; an all-DONE plan
 *      is never selected, which is also the step-5 close-out rule).
 *
 * The filename gate matters: instruction/discussion docs mention "Worktree:"
 * in prose, so only the plan naming convention counts as a directive (anchor #6
 * in the plan).
 *
 * The session gate (`sessionGateVerdict`) resolves the folder's actual
 * git state once per session (cached — G2) and applies the five-branch
 * decision matrix (N18 §3): not-git → pass; no bindings → pass; match →
 * pass + one status line; two declarations with different worktrees →
 * conflict (STOP + ask the user); any declaration ≠ actual → HARD STOP
 * with the exact N18 message.
 *
 * Fail-open everywhere (R4): a non-git folder, an unreadable/malformed
 * plan, a missing binding or any thrown error yields a PASS verdict —
 * only a POSITIVE, fully-resolved mismatch or conflict ever blocks.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { loadState } from "./state.js";
import { readRunBinding } from "./run-binding.js";
import { detectWorktree, realpathOrSelf, samePaths } from "./worktree.js";

/** Where a declared worktree/branch pair came from. */
export type BindingSource = "run-binding" | "plan";

/** One declared worktree/branch pair, tagged with where it came from. */
export interface DeclaredBinding {
	/** Which source declared it. */
	source: BindingSource;
	/** Absolute, realpath-normalized worktree path ("" = not declared). */
	worktree: string;
	/** Branch name ("" = not declared). */
	branch: string;
	/** Run id, or the plan file's absolute path (for messages). */
	origin: string;
}

/** Parsed header + item statuses of one plan document. */
export interface PlanHeader {
	/** Absolute-ish `Worktree:` value ("" when missing/malformed). */
	worktree: string;
	/** `Branch:` value ("" when missing/malformed). */
	branch: string;
	/** Count of `Status: PENDING` item lines. */
	pendingCount: number;
	/** Count of `Status: DONE` item lines. */
	doneCount: number;
}

/**
 * Parse a plan document's `Worktree:` / `Branch:` header fields and count
 * PENDING/DONE item statuses. Tolerates CRLF, bold markers (`**Worktree:**`),
 * backticks/quotes and trailing slashes; an empty value counts as missing.
 * Never throws.
 * @param {string} content - Raw plan markdown.
 * @returns {PlanHeader} Parsed fields ("" / 0 when absent).
 */
export function parsePlanHeader(content: string): PlanHeader {
	const header: PlanHeader = { worktree: "", branch: "", pendingCount: 0, doneCount: 0 };
	const lines = content.split(/\r?\n/);
	/**
	 * First non-empty value of one header field (`Worktree:` / `Branch:`), cleaned of quotes/backticks/trailing slashes.
	 * @param {string} name - Field name to match (e.g. "Worktree").
	 * @returns {string} The cleaned value, or "" when missing/malformed.
	 */
	const field = (name: string): string => {
		const re = new RegExp(`^\\s*\\**${name}:\\**\\s*(.*)$`);
		for (const line of lines) {
			const match = re.exec(line);
			if (!match) continue;
			const value = (match[1] ?? "")
				.trim()
				.replace(/^[`'"]+/, "")
				.replace(/[`'"]+$/, "")
				.trim()
				.replace(/\/+$/, "")
				.trim();
			if (value !== "") return value;
		}
		return "";
	};
	header.worktree = field("Worktree");
	header.branch = field("Branch");
	for (const line of lines) {
		if (/\**Status:\**\s*PENDING\b/.test(line)) header.pendingCount += 1;
		else if (/\**Status:\**\s*DONE\b/.test(line)) header.doneCount += 1;
	}
	return header;
}

/** Plan filename convention: `<task>_plan_YYYYMMDD_HHMM_vX.Y.md`. */
const PLAN_FILE_RE = /_plan_(\d{8}_\d{4})_v\d+\.\d+\.md$/;

/** True when a path is a plan file whose name carries a parseable timestamp. */
function isTimestampedPlan(path: string): boolean {
	return PLAN_FILE_RE.test(path.replace(/\\/g, "/"));
}

/** Sort key of a plan file: its filename timestamp, mtime fallback (0). */
function planTimestamp(path: string): number {
	const match = PLAN_FILE_RE.exec(path.replace(/\\/g, "/"));
	if (match?.[1]) {
		const stamp = Number.parseInt(match[1].replace("_", ""), 10);
		if (Number.isFinite(stamp)) return stamp;
	}
	try {
		return Math.trunc(statSync(path).mtimeMs / 1000);
	} catch {
		return 0;
	}
}

/** Every plan file under `.IDE_Plans` (recursive; the `runs/` subtree excluded). */
function listPlanFiles(cwd: string): string[] {
	const root = join(cwd, ".IDE_Plans");
	const found: string[] = [];
	/**
	 * Depth-first scan of one `.IDE_Plans` subtree for timestamped plan files (never throws — unreadable dirs are skipped).
	 * @param {string} dir - Directory to scan recursively.
	 * @returns {void} Appends matches into the enclosing `found` array.
	 */
	const walk = (dir: string): void => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			if (entry === "velpari" && full === join(root, "velpari")) continue; // runs/ working copies
			let isDir = false;
			try {
				isDir = statSync(full).isDirectory();
			} catch {
				continue;
			}
			if (isDir) walk(full);
			else if (isTimestampedPlan(entry)) found.push(full);
		}
	};
	walk(root);
	return found;
}

/**
 * The active plan directive: the NEWEST plan file that both parses a
 * non-empty `Worktree:` header and still has ≥1 PENDING item (newest
 * PENDING plan wins — older PENDING plans only bind when the newer ones
 * are all DONE). Relative `Worktree:` paths resolve against `cwd`.
 * Never throws (fail-open → null).
 * @param {string} cwd - Project root (the session folder).
 * @returns {DeclaredBinding | null} The directive, or null when none.
 */
export function findActivePlanDirective(cwd: string): DeclaredBinding | null {
	try {
		const candidates = listPlanFiles(cwd)
			.map((path) => ({ path, header: parsePlanHeader(readFileSync(path, "utf8")) }))
			.filter((c) => c.header.worktree !== "" && c.header.pendingCount >= 1)
			.sort((a, b) => planTimestamp(b.path) - planTimestamp(a.path));
		const top = candidates[0];
		if (!top) return null;
		return {
			source: "plan",
			worktree: realpathOrSelf(resolve(cwd, top.header.worktree)),
			branch: top.header.branch,
			origin: top.path,
		};
	} catch {
		return null;
	}
}

/**
 * The live run binding for this folder (close-out applied): the current
 * run's `run-binding.json` counts only while `status === "active"` —
 * handoff/reset closes it and the directive stops binding new sessions.
 * Never throws (fail-open → null).
 * @param {string} cwd - Project root.
 * @returns {DeclaredBinding | null} The binding, or null when none/closed.
 */
export function activeRunBinding(cwd: string): DeclaredBinding | null {
	try {
		const state = loadState(cwd);
		if (!state.runId) return null;
		const binding = readRunBinding(cwd, state.runId);
		if (!binding || binding.status !== "active") return null;
		return {
			source: "run-binding",
			worktree: realpathOrSelf(binding.worktree),
			branch: binding.branch,
			origin: binding.runId,
		};
	} catch {
		return null;
	}
}

/** The session gate's verdict over one folder (N18 §3 decision matrix). */
export type SessionGateVerdict =
	/** Allowed. `statusLine` is non-null only for the match branch. */
	| { kind: "pass"; why: "not-git" | "no-bindings" | "match"; statusLine: string | null }
	/** Two declarations disagree → STOP + ask the user which line. */
	| { kind: "conflict"; runBinding: DeclaredBinding; planDirective: DeclaredBinding; reason: string }
	/** A declaration ≠ actual → HARD STOP (exact N18 message). */
	| { kind: "mismatch"; declared: DeclaredBinding; actualWorktree: string; actualBranch: string; reason: string };

/** The exact N18 hard-stop message (single source — hook + guard share it). */
function mismatchReason(declared: DeclaredBinding, actualWorktree: string, actualBranch: string): string {
	return (
		`This work belongs in worktree ${declared.worktree} on branch ${declared.branch || "(unspecified)"}. ` +
		`You are in ${actualWorktree} on branch ${actualBranch || "(unspecified)"}. ` +
		`Restart the session there. No changes were made.`
	);
}

/** The conflict message: both declarations named, user decides (G4). */
function conflictReason(runBinding: DeclaredBinding, planDirective: DeclaredBinding): string {
	return (
		`Two active declarations disagree: run binding "${runBinding.origin}" → ${runBinding.worktree}` +
		`${runBinding.branch ? ` @ ${runBinding.branch}` : ""}, ` +
		`plan directive ${planDirective.origin} → ${planDirective.worktree}` +
		`${planDirective.branch ? ` @ ${planDirective.branch}` : ""}. ` +
		`STOP — ask the user which worktree/line to follow before any edit.`
	);
}

/** Normalized comparison form: realpathOrSelf keeps a trailing slash on nonexistent paths. */
function trimSlash(p: string): string {
	return p.replace(/\/+$/, "");
}

/**
 * Pure decision over an already-resolved probe + declarations (the five
 * branches of N18 §3 step 3, plus the step-1 not-git fail-open).
 * @param {{ isGit: boolean; worktree: string; branch: string }} probe - Actual folder state.
 * @param {(DeclaredBinding | null)[]} declarations - Run binding + plan directive (nulls dropped).
 * @returns {SessionGateVerdict} The verdict (never throws).
 */
export function decideSessionGate(
	probe: { isGit: boolean; worktree: string; branch: string },
	declarations: (DeclaredBinding | null)[],
): SessionGateVerdict {
	if (!probe.isGit) return { kind: "pass", why: "not-git", statusLine: null };
	const present = declarations.filter((d): d is DeclaredBinding => d !== null);
	if (present.length === 0) return { kind: "pass", why: "no-bindings", statusLine: null };

	const runBinding = present.find((d) => d.source === "run-binding") ?? null;
	const planDirective = present.find((d) => d.source === "plan") ?? null;

	// Two active declarations with DIFFERENT worktrees → conflict (G4).
	if (runBinding && planDirective && runBinding.worktree !== "" && planDirective.worktree !== "") {
		if (!samePaths(runBinding.worktree, planDirective.worktree)) {
			return { kind: "conflict", runBinding, planDirective, reason: conflictReason(runBinding, planDirective) };
		}
	}

	// One effective declaration: worktrees agree → the live run binding's
	// branch wins for the branch field; otherwise the single source is itself.
	const declared =
		runBinding && planDirective
			? {
					source: runBinding.source,
					worktree: runBinding.worktree || planDirective.worktree,
					branch: runBinding.branch || planDirective.branch,
					origin: runBinding.origin,
				}
			: (runBinding ?? planDirective)!;

	const worktreeOk = declared.worktree === "" || samePaths(trimSlash(declared.worktree), trimSlash(probe.worktree));
	const branchOk = declared.branch === "" || declared.branch === probe.branch;
	if (worktreeOk && branchOk) {
		return {
			kind: "pass",
			why: "match",
			statusLine:
				`session-gate: ok — ${declared.source} ${declared.worktree || "(worktree undeclared)"}` +
				`${declared.branch ? ` @ ${declared.branch}` : ""} matches this session`,
		};
	}
	return {
		kind: "mismatch",
		declared,
		actualWorktree: probe.worktree,
		actualBranch: probe.branch,
		reason: mismatchReason(declared, probe.worktree, probe.branch),
	};
}

/**
 * The folder's cached session verdict — `detectWorktree` runs at most ONCE
 * per session per cwd (G2). Fail-open: any probe/load error yields
 * pass/no-bindings, never a block.
 * @param {string} cwd - Session folder.
 * @returns {SessionGateVerdict} The (cached) verdict.
 */
export function sessionGateVerdict(cwd: string): SessionGateVerdict {
	const cached = verdictCache.get(cwd);
	if (cached) return cached;
	let verdict: SessionGateVerdict;
	try {
		const info = detectWorktree(cwd, { skipWorktrees: true, skipUpstream: true });
		verdict = decideSessionGate({ isGit: info.isGit, worktree: info.worktree, branch: info.branch }, [
			activeRunBinding(cwd),
			findActivePlanDirective(cwd),
		]);
	} catch {
		verdict = { kind: "pass", why: "no-bindings", statusLine: null };
	}
	verdictCache.set(cwd, verdict);
	return verdict;
}

/** Per-session verdict cache (module scope — one session, one cwd). */
const verdictCache = new Map<string, SessionGateVerdict>();

/**
 * Clear the session verdict cache (tests only — forces recomputation so
 * the once-per-session contract is observable).
 * @returns {void}
 */
export function resetSessionGateCache(): void {
	verdictCache.clear();
}

/** Re-exported for callers that only need the plan file's display name. */
export { basename as planFileLabel };
