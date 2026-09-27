/**
 * Guided merge-back for parallel development lines (Phase 6 — N12/G-4).
 *
 * N12's five steps, in order: (1) git merge of the parallel line's
 * branch → (2) store merge verified per `skills/db-store-merge-runbook.md`
 * → (3) full doctor audit → (4) staleness recompute → (5) downstream
 * consumers flagged per F14. Deliberate + confirmed — NEVER automatic.
 *
 * Two entry points:
 *   - `planMergeBack` — the dry-run. Strictly read-only: conflict
 *     preview via `git merge-tree --write-tree` (never touches the work
 *     tree or HEAD), doctor in embedded mode, freshness recompute. It
 *     writes nothing and refuses nothing.
 *   - `executeMergeBack` — refuses without `{confirmed: true}`, re-plans,
 *     runs the five steps, appends one chained audit row per step per
 *     store (`F17/N15`, actor `velpari-merge-back`), and finishes with
 *     an EXPLICIT-PATH commit of the store DBs (decision D4, v1.1:
 *     `velpari(merge-back): <branch> — audit trail` — same policy as
 *     Phase 2's `commitProtectionChange` / Phase 4's prune: no
 *     uncommitted deliberate DB mutations, never bundled into the merge
 *     commit). A step-1 conflict aborts BEFORE any audit row (opening a
 *     store DB that may itself be an unmerged file would corrupt it) and
 *     leaves git's conflict state alone — no automatic abort, no
 *     automatic resolution.
 *
 * L1 (ops) → L0 (core, io) + same-layer L1 (`doctor`, `ops/protection`)
 * — legal direction. Never imports `ui/` — the confirmation prompt lives
 * in L3 (`commands/merge-back.ts`).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { runDoctor } from "../doctor/index.js";
import { computeStaleSet, type StaleItem } from "../core/freshness.js";
import { loadFilesConfig, validateFilesConfig } from "../core/config.js";
import { getEffectiveProjectNames } from "../core/projectnames.js";
import { buildStoreDbPath } from "../core/paths.js";
import { openStoreDb, closeStoreDb } from "../io/db.js";
import { appendAuditEntry, verifyExportChecksum, type ArtifactKind } from "../io/store.js";
import { commitProtectionChange } from "./protection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One step of the N12 flow (shared by plan + execute results). */
export interface MergeBackStep {
	step: 1 | 2 | 3 | 4 | 5;
	title: string;
	status: "ok" | "warn" | "error" | "skipped" | "pending";
	message: string;
	details?: string[];
}

/** Dry-run result — produced by read-only operations only. */
export interface MergeBackPlan {
	branch: string;
	branchSha: string | null;
	mergeBase: string | null;
	alreadyMerged: boolean;
	dirty: boolean;
	oursFiles: string[];
	theirsFiles: string[];
	overlap: string[];
	storeOverlap: string[];
	conflicts: string[];
	/** false when git is too old for `merge-tree --write-tree` (git < 2.38). */
	conflictsKnown: boolean;
	doctorErrors: number;
	doctorWarnings: number;
	staleCount: number;
	staleItems: string[];
	steps: MergeBackStep[];
	blocked: string[];
}

/** Execute result. `auditCommit` is the explicit store commit (D4). */
export interface MergeBackResult {
	ok: boolean;
	steps: MergeBackStep[];
	auditEntries: number;
	mergeCommit: string | null;
	auditCommit: string | null;
	/** Git problems from the audit commit — reported, never fatal (design rule 7). */
	commitWarnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** N12 step order — titles shown in dry-run, execute, and the command. */
const STEP_TITLES = [
	"git merge",
	"store merge (runbook)",
	"doctor audit",
	"staleness recompute",
	"downstream flagged (F14)",
] as const;

/** Audit actor for every row this flow writes. */
const ACTOR = "velpari-merge-back";

/** Step title by 1-based step number (never undefined). */
function stepTitle(step: number): string {
	return STEP_TITLES[step - 1] ?? "merge-back step";
}

// ---------------------------------------------------------------------------
// Small helpers (all never-throwing)
// ---------------------------------------------------------------------------

interface GitResult {
	ok: boolean;
	out: string;
	err: string;
	code: number;
}

/** Run one git command. Never throws; non-zero exit is `ok: false`. */
function git(cwd: string, args: string[]): GitResult {
	try {
		const r = spawnSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
		if (r.error) {
			return { ok: false, out: "", err: r.error.message, code: -1 };
		}
		return {
			ok: r.status === 0,
			out: (r.stdout ?? "").replace(/\n+$/, ""),
			err: (r.stderr ?? "").trim(),
			code: r.status ?? -1,
		};
	} catch (err) {
		return { ok: false, out: "", err: err instanceof Error ? err.message : String(err), code: -1 };
	}
}

/** true when `ancestor` is an ancestor of `rev` (exit 0 only). */
function isAncestor(cwd: string, ancestor: string, rev: string): boolean {
	return git(cwd, ["merge-base", "--is-ancestor", ancestor, rev]).ok;
}

/** Changed paths between two revs (two-dot diff — mergeBase is exact). */
function diffNames(cwd: string, from: string, to: string): string[] {
	const r = git(cwd, ["diff", "--name-only", from, to]);
	if (!r.ok) return [];
	return r.out
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

/**
 * Conflict preview WITHOUT touching the work tree (dry-run core).
 * `git merge-tree --write-tree --name-only <ours> <theirs>`:
 *   exit 0 → clean (stdout = tree oid); exit 1 → conflicted paths after
 *   the oid line, up to the first blank line; anything else → unknown
 *   (git too old / unsupported) → conflictsKnown: false.
 */
function mergeTreePreview(cwd: string, theirs: string): { conflicts: string[]; known: boolean } {
	const r = git(cwd, ["merge-tree", "--write-tree", "--name-only", "HEAD", theirs]);
	if (r.ok) return { conflicts: [], known: true };
	if (r.code === 1) {
		const lines = r.out.split("\n");
		const conflicts: string[] = [];
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (line.trim() === "") break;
			conflicts.push(line.trim());
		}
		return { conflicts, known: true };
	}
	return { conflicts: [], known: false };
}

/** Paths git currently considers unmerged (post-failed-merge state). */
function conflictedPaths(cwd: string): string[] {
	const r = git(cwd, ["status", "--porcelain"]);
	if (!r.ok) return [];
	return r.out
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => /^(UU|AA|DD|AU|UA|DU|UD)/.test(l))
		.map((l) => l.slice(3).trim().replace(/^"|"$/g, ""));
}

/** Effective projectNames → store DB targets (safe, empty on any problem). */
function effectiveProjects(cwd: string): Array<{ projectName: string; dbPath: string }> {
	try {
		const cfg = loadFilesConfig(cwd);
		if (!validateFilesConfig(cfg)) return [];
		return getEffectiveProjectNames(cfg).map((projectName) => ({
			projectName,
			dbPath: buildStoreDbPath(projectName, cwd),
		}));
	} catch {
		return [];
	}
}

/** Short HEAD sha (null when git fails). */
function shortHead(cwd: string): string | null {
	const r = git(cwd, ["rev-parse", "--short", "HEAD"]);
	return r.ok && r.out ? r.out : null;
}

/** Checked-out branch name (null outside a repo / detached HEAD sentinel "HEAD"). */
export function currentBranch(cwd: string): string | null {
	const r = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	return r.ok && r.out && r.out !== "HEAD" ? r.out : null;
}

// ---------------------------------------------------------------------------
// planMergeBack — READ-ONLY dry run
// ---------------------------------------------------------------------------

/** Build the planned step list from the observed state. */
function planSteps(plan: Omit<MergeBackPlan, "steps">): MergeBackStep[] {
	const steps: MergeBackStep[] = [];
	if (plan.blocked.length > 0) {
		for (let i = 1; i <= 5; i++) {
			steps.push({
				step: i as 1 | 2 | 3 | 4 | 5,
				title: stepTitle(i),
				status: "skipped",
				message: `blocked — ${plan.blocked[0]}`,
				details: plan.blocked,
			});
		}
		return steps;
	}

	// 1 — git merge (preview)
	if (plan.alreadyMerged) {
		steps.push({
			step: 1,
			title: STEP_TITLES[0],
			status: "ok",
			message: `already merged (${plan.branchSha?.slice(0, 7) ?? "?"}) — a re-run completes steps 2–5 only`,
		});
	} else if (plan.conflicts.length > 0) {
		steps.push({
			step: 1,
			title: STEP_TITLES[0],
			status: "error",
			message: `would CONFLICT in ${plan.conflicts.length} file(s) — resolve per runbook, then re-run`,
			details: plan.conflicts.slice(0, 20),
		});
	} else if (!plan.conflictsKnown) {
		steps.push({
			step: 1,
			title: STEP_TITLES[0],
			status: "warn",
			message: "conflict preview unavailable (git < 2.38?) — execute will discover conflicts live",
		});
	} else {
		steps.push({
			step: 1,
			title: STEP_TITLES[0],
			status: "ok",
			message: `clean — ${plan.overlap.length} file(s) overlap with HEAD`,
		});
	}

	// 2 — store merge preview (overlap signal only; checksums run post-merge)
	if (plan.storeOverlap.length > 0) {
		steps.push({
			step: 2,
			title: STEP_TITLES[1],
			status: "warn",
			message: `${plan.storeOverlap.length} store file(s) overlap — verify per skills/db-store-merge-runbook.md`,
			details: plan.storeOverlap.slice(0, 20),
		});
	} else {
		steps.push({
			step: 2,
			title: STEP_TITLES[1],
			status: "ok",
			message: "no Doc/store overlap — post-merge checksum verification will confirm",
		});
	}

	// 3 — doctor (current state as preview)
	steps.push({
		step: 3,
		title: STEP_TITLES[2],
		status: plan.doctorErrors > 0 ? "error" : plan.doctorWarnings > 0 ? "warn" : "ok",
		message:
			plan.doctorErrors > 0
				? `current doctor report has ${plan.doctorErrors} error(s) — execute re-audits post-merge`
				: plan.doctorWarnings > 0
					? `current doctor report: 0 errors, ${plan.doctorWarnings} warning(s)`
					: "current doctor report: 0 errors, 0 warnings",
	});

	// 4 — staleness preview
	steps.push({
		step: 4,
		title: STEP_TITLES[3],
		status: "ok",
		message: `current stale set: ${plan.staleCount} consumer(s)`,
	});

	// 5 — downstream flag preview
	steps.push({
		step: 5,
		title: STEP_TITLES[4],
		status: "ok",
		message:
			plan.staleCount > 0
				? `${plan.staleCount} consumer(s) will be flagged stale per F14`
				: "no consumers stale — nothing to flag",
		details: plan.staleItems.slice(0, 20),
	});

	return steps;
}

/**
 * Dry-run the merge-back. READ-ONLY: git plumbing previews only
 * (`merge-tree` never touches index/work tree/HEAD), doctor runs in
 * embedded mode (no stamps), freshness is re-read. Never throws.
 */
export function planMergeBack(cwd: string, branch: string): MergeBackPlan {
	const blocked: string[] = [];

	const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
	if (!inside.ok || inside.out.trim() !== "true") {
		blocked.push("not a git repository");
	}

	if (git(cwd, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).ok) {
		blocked.push("a merge is already in progress — finish it or `git merge --abort` first");
	}

	let dirty = false;
	if (blocked.length === 0) {
		const st = git(cwd, ["status", "--porcelain"]);
		dirty = st.ok && st.out.trim().length > 0;
		if (dirty) {
			blocked.push("working tree not clean — commit or stash first (Velpari never merges over uncommitted work)");
		}
	}

	let branchSha: string | null = null;
	if (blocked.length === 0) {
		const rev = git(cwd, ["rev-parse", "--verify", `${branch}^{commit}`]);
		if (!rev.ok) {
			blocked.push(`branch not found: ${branch}`);
		} else {
			branchSha = rev.out.trim();
		}
	}

	const alreadyMerged = branchSha !== null && isAncestor(cwd, branch, "HEAD");

	const mb = branchSha ? git(cwd, ["merge-base", branch, "HEAD"]) : null;
	const mergeBase = mb?.ok && mb.out ? mb.out.trim() : null;

	const oursFiles = mergeBase ? diffNames(cwd, mergeBase, "HEAD") : [];
	const theirsFiles = mergeBase ? diffNames(cwd, mergeBase, branch) : [];
	const theirsSet = new Set(theirsFiles);
	const overlap = oursFiles.filter((f) => theirsSet.has(f));
	const storeOverlap = overlap.filter((f) => f.startsWith("Doc/store/"));

	let conflicts: string[] = [];
	let conflictsKnown = true;
	if (branchSha && !alreadyMerged) {
		const preview = mergeTreePreview(cwd, branch);
		conflicts = preview.conflicts;
		conflictsKnown = preview.known;
	}

	let doctorErrors = 0;
	let doctorWarnings = 0;
	let stale: StaleItem[] = [];
	// Blocked plans are all-skipped — the preview counts are never shown, so
	// skip the (expensive) doctor run + stale recompute entirely. Counts stay
	// 0 = "not evaluated". Unblocked plans run both per plan §6.7.1.
	if (blocked.length === 0) {
		try {
			const report = runDoctor(cwd, { embedded: true });
			doctorErrors = report.summary.error;
			doctorWarnings = report.summary.warning;
		} catch {
			/* doctor must not break the dry-run — counts stay 0 */
		}
		try {
			stale = computeStaleSet(cwd);
		} catch {
			stale = [];
		}
	}

	const base: Omit<MergeBackPlan, "steps"> = {
		branch,
		branchSha,
		mergeBase,
		alreadyMerged,
		dirty,
		oursFiles,
		theirsFiles,
		overlap,
		storeOverlap,
		conflicts,
		conflictsKnown,
		doctorErrors,
		doctorWarnings,
		staleCount: stale.length,
		staleItems: stale.map((s) => `${s.key} stale (${s.reason})`),
		blocked,
	};

	return { ...base, steps: planSteps(base) };
}

// ---------------------------------------------------------------------------
// executeMergeBack — the only writer (confirmed)
// ---------------------------------------------------------------------------

/**
 * Execute the merge-back. Refuses when `confirmed` is not true — N12 is
 * explicit: never automatic. Never throws; every failure lands in the
 * returned step list.
 */
export function executeMergeBack(cwd: string, branch: string, opts: { confirmed: boolean }): MergeBackResult {
	if (!opts.confirmed) {
		return {
			ok: false,
			steps: [
				{
					step: 1,
					title: STEP_TITLES[0],
					status: "error",
					message: "refused — confirmation required (N12: deliberate + confirmed, never automatic)",
				},
			],
			auditEntries: 0,
			mergeCommit: null,
			auditCommit: null,
			commitWarnings: [],
		};
	}

	const plan = planMergeBack(cwd, branch);
	if (plan.blocked.length > 0) {
		return {
			ok: false,
			steps: plan.steps,
			auditEntries: 0,
			mergeCommit: null,
			auditCommit: null,
			commitWarnings: [],
		};
	}

	const steps: MergeBackStep[] = [];
	const push = (
		step: 1 | 2 | 3 | 4 | 5,
		status: MergeBackStep["status"],
		message: string,
		details?: string[],
	): void => {
		steps.push({ step, title: stepTitle(step), status, message, details });
	};

	// ---- Step 1: git merge ------------------------------------------------
	// The result is RECORDED (not pushed) after the store connections open
	// below — appendAuditEntry needs a live connection, and connections are
	// deliberately opened only after the merge finished (D4: opening a store
	// that may itself be an unmerged file is unsafe; the conflict path
	// returns before any connection exists, so it writes no audit rows).
	let mergeCommit: string | null = null;
	let step1Message = "";
	let step1Details: string[] | undefined;
	if (plan.alreadyMerged) {
		step1Message = `already merged (${plan.branchSha?.slice(0, 7) ?? "?"}) — completing steps 2–5`;
	} else {
		const merge = git(cwd, ["merge", "--no-ff", "--no-edit", branch]);
		if (!merge.ok) {
			const conflicts = conflictedPaths(cwd);
			push(1, "error", `merge FAILED for ${branch} — conflict left for you to resolve (no auto-abort)`, [
				...(conflicts.length > 0 ? conflicts.slice(0, 20) : [merge.err || "merge failed"]),
				"resolve per skills/db-store-merge-runbook.md (store) or standard git, then `git add` + `git commit`",
				"or `git merge --abort`, then re-run `/velpari-merge-back " + branch + "` to complete steps 2–5",
			]);
			for (let i = 2; i <= 5; i++) {
				push(i as 2 | 3 | 4 | 5, "skipped", "skipped — step 1 failed");
			}
			return {
				ok: false,
				steps,
				auditEntries: 0,
				mergeCommit: null,
				auditCommit: null,
				commitWarnings: [],
			};
		}
		mergeCommit = shortHead(cwd);
		step1Message = `merged ${branch} (${mergeCommit ?? "ok"})`;
		step1Details = merge.out ? merge.out.split("\n").slice(0, 5) : undefined;
	}

	// ---- Audit plumbing: one chained row per step per store ---------------
	const stores = effectiveProjects(cwd).filter(({ dbPath }) => existsSync(dbPath));
	let auditEntries = 0;
	const auditPaths = new Set<string>();
	// One connection per store for the whole execute (step 2 reads it too);
	// opened BEFORE step 2 so a corrupt DB is reported there, closed before
	// the audit commit so the checkpoint lands in the committed bytes.
	const conns: Array<{ projectName: string; dbPath: string; db: ReturnType<typeof openStoreDb> }> = [];
	for (const s of stores) {
		try {
			conns.push({ ...s, db: openStoreDb(s.dbPath) });
		} catch {
			/* unreadable store is reported by step 2's empty verification */
		}
	}
	/**
	 * Close every open store connection (checkpoint + close), best-effort per connection.
	 * @returns {void}
	 */
	const closeAll = (): void => {
		for (const c of conns) {
			try {
				closeStoreDb(c.db);
			} catch {
				/* closing is best-effort */
			}
		}
	};
	const record = (
		step: 1 | 2 | 3 | 4 | 5,
		status: MergeBackStep["status"],
		message: string,
		details?: string[],
	): void => {
		push(step, status, message, details);
		for (const { projectName, dbPath, db } of conns) {
			try {
				appendAuditEntry(db, {
					actor: ACTOR,
					action: "merge-back",
					reason: `step ${step}: ${stepTitle(step)}`,
					detail: { step, branch, status, message, mergeCommit, projectName },
				});
				auditPaths.add(dbPath);
				auditEntries++;
			} catch {
				/* a failed append lowers auditEntries — reported honestly */
			}
		}
	};

	// ---- Step 1 recorded (first row: steps[] order = step 1 first) --------
	record(1, "ok", step1Message, step1Details);

	// ---- Step 2: store merge verification (runbook § 3) --------------------
	try {
		if (conns.length === 0) {
			record(2, "ok", "pre-store project — no store to verify");
		} else {
			const mismatches: string[] = [];
			let verified = 0;
			for (const { projectName, db } of conns) {
				const rows = db
					.prepare("SELECT DISTINCT run_id, kind FROM artifacts WHERE status = 'published'")
					.all() as Array<{ run_id: string; kind: string }>;
				for (const row of rows) {
					try {
						const res = verifyExportChecksum(db, row.run_id, row.kind as ArtifactKind);
						verified++;
						if (!res.ok) {
							mismatches.push(`${projectName}/${row.kind}@${row.run_id} — checksum mismatch (hand-merge damage?)`);
						}
					} catch (err) {
						mismatches.push(
							`${projectName}/${row.kind}@${row.run_id} — ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				}
			}
			if (mismatches.length > 0) {
				record(2, "error", "store verification FAILED — rebuild per skills/db-store-merge-runbook.md", mismatches);
			} else {
				record(
					2,
					"ok",
					verified > 0
						? `store YAML↔row checksums verified (${verified} published artifact(s))`
						: "no published artifacts — nothing to checksum-verify",
				);
			}
		}
	} catch (err) {
		record(2, "error", `store verification threw: ${err instanceof Error ? err.message : String(err)}`);
	}

	// ---- Step 3: doctor audit (post-merge, embedded = no writes) ----------
	let doctorErrors = 0;
	try {
		const report = runDoctor(cwd, { embedded: true });
		doctorErrors = report.summary.error;
		const w = report.summary.warning;
		if (doctorErrors > 0) {
			const msgs = report.sections
				.flatMap((s) => s.items.filter((i) => i.status === "error").map((i) => `${s.title}: ${i.message}`))
				.slice(0, 10);
			record(3, "error", `doctor audit: ${doctorErrors} error(s), ${w} warning(s)`, msgs);
		} else if (w > 0) {
			record(3, "warn", `doctor audit: 0 errors, ${w} warning(s)`);
		} else {
			record(3, "ok", "doctor audit: 0 errors, 0 warnings");
		}
	} catch (err) {
		record(3, "error", `doctor audit threw: ${err instanceof Error ? err.message : String(err)}`);
	}

	// ---- Step 4: staleness recompute --------------------------------------
	let stale: StaleItem[] = [];
	try {
		stale = computeStaleSet(cwd);
		record(4, "ok", `staleness recomputed — ${stale.length} stale consumer(s)`);
	} catch (err) {
		record(4, "error", `staleness recompute threw: ${err instanceof Error ? err.message : String(err)}`);
	}

	// ---- Step 5: downstream flagged per F14 -------------------------------
	if (stale.length > 0) {
		record(
			5,
			"ok",
			`${stale.length} consumer(s) flagged stale per F14 — the next stage start confirms before update mode`,
			stale.map((s) => `${s.key} (${s.reason}${s.changedInputs.length > 0 ? `: ${s.changedInputs.join(", ")}` : ""})`),
		);
	} else {
		record(5, "ok", "no consumers stale — nothing to flag");
	}

	// Checkpoint every store BEFORE the explicit-path commit (D4): the
	// WAL must be folded into the DB bytes git will record.
	closeAll();

	// ---- D4 (v1.1): explicit-path audit commit ----------------------------
	let auditCommit: string | null = null;
	const commitWarnings: string[] = [];
	if (auditEntries > 0 && auditPaths.size > 0) {
		const paths = [...auditPaths];
		const message = `velpari(merge-back): ${branch} — audit trail`;
		const warnings = commitProtectionChange({
			cwd,
			projectName: stores[0]?.projectName ?? "velpari",
			paths,
			message,
		});
		if (warnings.length > 0) {
			commitWarnings.push(...warnings);
		} else {
			const st = git(cwd, ["status", "--porcelain", "--", ...paths]);
			if (st.ok && st.out.trim().length === 0) {
				auditCommit = shortHead(cwd);
			} else {
				commitWarnings.push(
					"audit rows may remain uncommitted — check `git status` and retry the explicit-path commit",
				);
			}
		}
	}

	// I11.2: `ok` requires EVERY recorded step to be clean (step 1's
	// explicit check is subsumed — a conflict at step 1 also short-circuits
	// steps 2–5) AND a clean doctor audit. A step-4/5 failure must no longer
	// print "merge-back complete".
	const ok = steps.every((s) => s.status !== "error") && doctorErrors === 0;
	return { ok, steps, auditEntries, mergeCommit, auditCommit, commitWarnings };
}
