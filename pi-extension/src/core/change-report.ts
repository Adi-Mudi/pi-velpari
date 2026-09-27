/**
 * core/change-report.ts — the F14 change report (Layer 0; Phase 5).
 *
 * F14 in one sentence: auto-detect the changed inputs, auto-flag the consumers,
 * auto-generate a report of WHAT moved, then stop and confirm with the
 * developer. The first two are shipped (`core/freshness.ts:computeStaleSet`);
 * this module is the third — a deterministic markdown artifact of record — and
 * it supplies the one-line `detail` that the stage gate, the publish gate and
 * `/velpari-status` print.
 *
 * The N8 split decides the wording and the demand:
 *   * foreign-run → "STOP … create a separate worktree: <git worktree add …>"
 *   * own-run     → "review, then confirm to continue in update mode"
 *
 * The report is written into the run folder (`<runDir>/change-report.md`) — a
 * working area, never `Doc/` — so the developer can read the detail outside the
 * chat, and the block message can simply name the path.
 *
 * Layer 0: imports L0 only (freshness, paths, config, run-binding, upstream,
 * worktree, io atomic-write). Fully fail-soft: every probe that fails simply
 * contributes nothing.
 */

import { join } from "node:path";
import { atomicWriteFile } from "../io/atomic-write.js";
import { loadFilesConfig } from "./config.js";
import { computeStaleSet, type StaleItem } from "./freshness.js";
import { buildRunDir } from "./paths.js";
import { foreignLinesInWorktree, readRunBinding, type RunBinding } from "./run-binding.js";
import type { RunState } from "./state.js";
import { ARTIFACT_TO_KIND, artifactKindForItem, classifyMove, type UpstreamMove } from "./upstream.js";
import { detectWorktree, worktreeAddHint } from "./worktree.js";

/** One finding — one stale artifact, classified. */
export interface ChangeReportEntry {
	/** Lowercase artifact name from the stale set (`prd`, `design`, …). */
	artifact: string;
	/** Store kind when the artifact is store-backed, else null. */
	kind: string | null;
	/** Why it is in the stale set. */
	reason: StaleItem["reason"];
	/** The offending input identities (`prd:TestApp`, …). */
	changedInputs: string[];
	/** Publisher facts, when the artifact is store-backed and published. */
	move: UpstreamMove | null;
	/** The N8 verdict — "unknown" when no published revision could be read. */
	classification: "own-run" | "foreign-run" | "unknown";
	/** Pre-rendered one-line action (printed by the gates and /velpari-status). */
	detail: string;
}

/** The worktree half of the report. */
export interface ChangeReportWorktree {
	/** Worktree the run is bound to (null = never stamped). */
	bound: string | null;
	/** Worktree we are actually running in ("" when not a git repo). */
	current: string;
	/** Branch the run is bound to. */
	boundBranch: string | null;
	/** Branch we are actually on. */
	currentBranch: string;
	/** true when bound and current disagree. */
	mismatch: boolean;
	/** Upstream ref, when the branch has one. */
	upstream: string | null;
	/** Commits the upstream has that we do not (N14 advise). */
	behind: number;
}

/** The whole report (structured facts + rendered text). */
export interface ChangeReport {
	runId: string;
	/** Stage label the caller passed (informational). */
	stage: string;
	generatedAt: string;
	worktree: ChangeReportWorktree;
	/** Live foreign run lines in this working folder (N5). */
	foreignLines: RunBinding[];
	/** One entry per stale artifact (empty ⇒ nothing moved). */
	entries: ChangeReportEntry[];
	/** Rendered markdown. */
	text: string;
}

/** Options for {@link buildChangeReport}. */
export interface BuildChangeReportOptions {
	/** Stage label recorded in the report (never affects filtering). */
	stage?: string;
	/** Filter: keep only these store kinds / lowercase artifact names. */
	kinds?: readonly string[];
}

/** One stale item's A/B classification. */
export interface StaleClassification {
	/** The moved input's facts (null for file-only inputs). */
	move: UpstreamMove | null;
	/** N8 verdict. */
	classification: ChangeReportEntry["classification"];
}

/**
 * Classify ONE stale item as own-run / foreign-run / unknown (N8). The verdict
 * comes from the item's CHANGED INPUTS — the artifact another run published is
 * the input (e.g. the PRD), never the stale consumer itself.
 *
 * Shared by the change report and `stages/transition-lock.ts`, so the gate
 * message and the report can never disagree.
 *
 * @param {string} cwd - Project root.
 * @param {string} projectName - Project whose store to read ("" = no store).
 * @param {string} runId - The run asking.
 * @param {StaleItem} item - One entry of the freshness stale set.
 * @returns {StaleClassification} The moved input (if any) + the verdict.
 */
export function classifyStaleItem(
	cwd: string,
	projectName: string,
	runId: string,
	item: StaleItem,
): StaleClassification {
	const inputKinds = Array.from(
		new Set(
			item.changedInputs
				.map((inputId) => inputId.split(":")[0] ?? "")
				.map((artifact) => ARTIFACT_TO_KIND[artifact.toLowerCase()])
				.filter((kind): kind is NonNullable<typeof kind> => Boolean(kind)),
		),
	);
	const moves =
		projectName === ""
			? []
			: inputKinds
					.map((kind) => classifyMove(cwd, projectName, runId, kind))
					.filter((move): move is NonNullable<typeof move> => move !== null);
	const move = moves.find((candidate) => candidate.move === "foreign-run") ?? moves[0] ?? null;
	// File-only inputs (brainstorm notes) can only ever be own-run (design note
	// 9); store-backed inputs with no readable revision stay "unknown".
	const classification: ChangeReportEntry["classification"] =
		move !== null ? move.move : inputKinds.length === 0 ? "own-run" : "unknown";
	return { move, classification };
}

/**
 * Render one entry's action line (the string every gate prints). The move
 * describes the CHANGED INPUT's artifact (e.g. the PRD that moved) — that is
 * the artifact another run published, not the stale consumer itself.
 */
function entryDetail(
	move: UpstreamMove | null,
	hintLabel: string,
): { detail: string; classification: ChangeReportEntry["classification"] } {
	if (move && move.move === "foreign-run") {
		return {
			classification: "foreign-run",
			detail:
				`STOP — foreign run ${move.publishedHead.runId} published ${move.kind} ` +
				`rev ${move.publishedHead.revisionNumber} (commit ${move.storeLastCommit ?? "n/a"})` +
				`${move.myRevisionNumber === null ? "" : `; your line is at rev ${move.myRevisionNumber}`}. ` +
				`Re-read / rebase / re-confirm, and continue a parallel line in a separate worktree: ${worktreeAddHint(hintLabel)}`,
		};
	}
	if (move) {
		return {
			classification: "own-run",
			detail:
				`your own flow moved ${move.kind} to rev ${move.publishedHead.revisionNumber} ` +
				`(commit ${move.storeLastCommit ?? "n/a"}) — review, then confirm to continue in update mode ` +
				`(or /velpari-reconfirm when the change has no impact on this artifact).`,
		};
	}
	return {
		classification: "unknown",
		detail:
			`an upstream input moved but no published revision could be read from the project store — ` +
			`republish the stage, or /velpari-reconfirm when the change has no impact.`,
	};
}

/** The report filename inside the run folder. */
export const CHANGE_REPORT_FILE = "change-report.md";

/** Absolute path of a run's change report. */
export function changeReportPath(cwd: string, runId: string): string {
	return join(buildRunDir(runId, cwd), CHANGE_REPORT_FILE);
}

/**
 * Build the change report for the current run. Reads, never writes.
 * @param {string} cwd - Project root.
 * @param {RunState} state - Current run state.
 * @param {BuildChangeReportOptions} [opts] - Stage label + kind filter.
 * @returns {ChangeReport} Structured facts + rendered markdown.
 */
export function buildChangeReport(cwd: string, state: RunState, opts?: BuildChangeReportOptions): ChangeReport {
	const projectName = (() => {
		try {
			return loadFilesConfig(cwd).projectName ?? "";
		} catch {
			return "";
		}
	})();

	let stale: StaleItem[] = [];
	try {
		stale = computeStaleSet(cwd);
	} catch {
		stale = [];
	}
	const filter = opts?.kinds && opts.kinds.length > 0 ? new Set(opts.kinds) : null;
	if (filter) {
		stale = stale.filter(
			(item) => filter.has(item.artifact) || (artifactKindForItem(item) && filter.has(artifactKindForItem(item)!)),
		);
	}

	const entries: ChangeReportEntry[] = stale.map((item) => {
		// One shared classifier (N8) — the verdict is about the CHANGED INPUT
		// (e.g. the PRD the RTM consumed), never the stale consumer itself.
		const { move, classification } = classifyStaleItem(cwd, projectName, state.runId, item);
		const { detail } = entryDetail(move, projectName || state.runId);
		return {
			artifact: item.artifact,
			kind: artifactKindForItem(item),
			reason: item.reason,
			changedInputs: item.changedInputs,
			move,
			classification,
			detail,
		};
	});

	const info = detectWorktree(cwd);
	const binding = readRunBinding(cwd, state.runId);
	const mismatch =
		binding !== null &&
		info.isGit &&
		((binding.worktree !== "" && info.worktree !== "" && binding.worktree !== info.worktree) ||
			(binding.branch !== "" && info.branch !== "" && binding.branch !== info.branch));

	const report: ChangeReport = {
		runId: state.runId,
		stage: opts?.stage ?? state.currentStage,
		generatedAt: new Date().toISOString(),
		worktree: {
			bound: binding ? binding.worktree : (state.runWorktree ?? null),
			current: info.worktree,
			boundBranch: binding ? binding.branch : (state.runBranch ?? null),
			currentBranch: info.branch,
			mismatch,
			upstream: info.upstream,
			behind: info.behind,
		},
		foreignLines: foreignLinesInWorktree(cwd, state.runId, { worktree: info.worktree }),
		entries,
		text: "",
	};
	report.text = renderChangeReport(report);
	return report;
}

/**
 * Render the report as markdown (stable ordering — only `generatedAt` varies).
 * @param {ChangeReport} report - Report to render.
 * @returns {string} Markdown text.
 */
export function renderChangeReport(report: ChangeReport): string {
	const lines: string[] = [
		`# Change report — run ${report.runId}`,
		"",
		`Stage: ${report.stage}`,
		`Generated: ${report.generatedAt}`,
		"",
		"## Worktree",
		"",
		`- bound: ${report.worktree.bound ?? "(not stamped)"}${report.worktree.boundBranch ? ` @ ${report.worktree.boundBranch}` : ""}`,
		`- current: ${report.worktree.current || "(not a git worktree)"}${report.worktree.currentBranch ? ` @ ${report.worktree.currentBranch}` : ""}`,
		`- verdict: ${report.worktree.mismatch ? "MISMATCH — run bound to another worktree/branch (N6)" : "ok"}`,
	];
	if (report.worktree.behind > 0) {
		lines.push(
			`- behind-upstream: ${report.worktree.behind} commit(s) behind ${report.worktree.upstream ?? "upstream"} — run git fetch / git pull, then re-run`,
		);
	}

	lines.push("", "## Foreign run lines in this folder (N5)");
	if (report.foreignLines.length === 0) {
		lines.push("", "- none");
	} else {
		lines.push("");
		for (const line of report.foreignLines) {
			lines.push(`- run ${line.runId} @ ${line.branch} — ${worktreeAddHint(line.runId)}`);
		}
	}

	lines.push("", "## Changed inputs (F14)");
	if (report.entries.length === 0) {
		lines.push("", "No upstream movement — nothing to confirm.");
	}
	for (const entry of report.entries) {
		lines.push(
			"",
			`### ${entry.artifact} (${entry.classification})`,
			"",
			`- reason: ${entry.reason}`,
			`- changed inputs: ${entry.changedInputs.join(", ") || "(none listed)"}`,
		);
		if (entry.move) {
			lines.push(
				`- published revision: ${entry.move.publishedHead.revisionNumber} by run ${entry.move.publishedHead.runId} at ${entry.move.publishedHead.publishedAt}`,
				`- commit: ${entry.move.storeLastCommit ?? "n/a"}`,
				`- your line is at: ${entry.move.myRevisionNumber === null ? "never published this kind" : `rev ${entry.move.myRevisionNumber}`}`,
			);
		}
		lines.push(`- action: ${entry.detail}`);
	}

	lines.push(
		"",
		"## Notes",
		"",
		"- Detection is local-only: a teammate's unpushed work is invisible until it is pushed and fetched (N14, cross-machine limitation).",
		"- The commit shown is the last commit touching the project store DB on this branch (the store does not record a publish commit).",
	);
	return `${lines.join("\n")}\n`;
}

/**
 * Write the report into the run folder (atomic). Returns the path so callers can
 * name it in a block message.
 * @param {string} cwd - Project root.
 * @param {ChangeReport} report - Report to persist.
 * @returns {string} Absolute path of the written file.
 */
export function writeChangeReport(cwd: string, report: ChangeReport): string {
	const target = changeReportPath(cwd, report.runId);
	try {
		atomicWriteFile(target, report.text, "utf8");
	} catch {
		// Fail-soft: a report that cannot be written must never block a gate;
		// the caller still has the in-memory `text`.
	}
	return target;
}
