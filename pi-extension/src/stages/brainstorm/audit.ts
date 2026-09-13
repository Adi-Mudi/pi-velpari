/**
 * Brainstorm audit log (Phase 4 of the lifecycle v2 upgrade).
 *
 * Captures every dispatch / inline-read / skip decision the parent LLM
 * makes during a brainstorm. The audit log is the single source of truth
 * for what happened — written to
 * `.IDE_Plans/velpari/runs/<run-id>/brainstorm/brainstorm-dispatch.md`.
 *
 * Design (senai audit.ts port):
 *   - Pure functions: createAuditSession, appendDecision, summarizeDecisions,
 *     buildSummary, renderDecision, renderAuditLog.
 *   - I/O lives in writeAuditLog + readAuditLog; writes are atomic.
 *   - The session lives in memory; written to disk at finalize (the approve
 *     handler call site arrives in Phase 5 — this module + tests only).
 *
 * Velpari adaptations: the session keys on the run id (velpari has no
 * separate brainstormRunId — brainstorm is a real stage in the chained
 * machine), and coverage counts the 7 velpari notes sections
 * (countNotesSections) instead of senai's mission-brief sections.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRunDir } from "../../core/paths.js";
import { atomicWriteFile } from "../../io/atomic-write.js";
import { REQUIRED_NOTES_SECTIONS, sectionBody } from "./notes.js";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** Marker written on line 1 of brainstorm-dispatch.md so doctor + tests
 *  recognize the file even when contents are minimal. */
export const AUDIT_LOG_MARKER = "<!-- pi-velpari brainstorm-dispatch -->";

/** Decisions a parent LLM can make on each turn. */
export type DecisionKind = "inline" | "dispatched" | "skipped" | "side-channel";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** One recorded decision — what the parent did on a given turn. */
export interface DispatchDecision {
	/** 1-based turn number within the brainstorm. */
	turn: number;
	/** ISO timestamp the decision was logged. */
	timestamp: string;
	/** Snippet of the user's input that triggered this decision. */
	userInput: string;
	/** What the parent chose to do. */
	decision: DecisionKind;
	/** Scout id when decision === "dispatched" or "side-channel". */
	agent?: string;
	/** Human-readable reason for the decision. */
	reason: string;
	/** Approximate tokens used by this turn (optional). */
	tokens?: number;
	/** Wall-clock time spent on the turn (optional). */
	elapsedMs?: number;
	/** Task description (for dispatched/side-channel only). */
	task?: string;
	/** Expected output hint (for dispatched only). */
	expectedOutput?: string;
}

/** In-memory audit session — accumulates decisions before finalize. */
export interface AuditSession {
	/** The velpari run id (brainstorm is a stage of the run). */
	runId: string;
	seed: string;
	startedAt: string;
	/** Mutable array of decisions in turn order. */
	decisions: DispatchDecision[];
}

/** Summary stats computed at finalize. */
export interface AuditSummary {
	totalDispatches: number;
	dispatchesByAgent: Record<string, number>;
	inlineReads: number;
	skipped: number;
	sideChannel: number;
	wallClockMs: number;
	notesSectionsFilled: number;
	notesSectionsTotal: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Pure functions
// ─────────────────────────────────────────────────────────────────────────

/** Create a new audit session. Pure — no file I/O. */
export function createAuditSession(runId: string, seed: string): AuditSession {
	return {
		runId,
		seed,
		startedAt: new Date().toISOString(),
		decisions: [],
	};
}

/** Append a decision to the session. Mutates the session in place.
 *  Returns the session for fluent chaining. */
export function appendDecision(
	session: AuditSession,
	decision: DispatchDecision,
): AuditSession {
	session.decisions.push(decision);
	return session;
}

/** Count decisions by kind. Pure. */
export function summarizeDecisions(decisions: readonly DispatchDecision[]): {
	totalDispatches: number;
	dispatchesByAgent: Record<string, number>;
	inlineReads: number;
	skipped: number;
	sideChannel: number;
} {
	let totalDispatches = 0;
	let inlineReads = 0;
	let skipped = 0;
	let sideChannel = 0;
	const dispatchesByAgent: Record<string, number> = {};
	for (const d of decisions) {
		if (d.decision === "dispatched") {
			totalDispatches++;
			if (d.agent) {
				dispatchesByAgent[d.agent] = (dispatchesByAgent[d.agent] ?? 0) + 1;
			}
		} else if (d.decision === "inline") {
			inlineReads++;
		} else if (d.decision === "skipped") {
			skipped++;
		} else if (d.decision === "side-channel") {
			sideChannel++;
		}
	}
	return { totalDispatches, dispatchesByAgent, inlineReads, skipped, sideChannel };
}

/** Build the full audit summary for a session. Combines decision counts
 *  with caller-supplied wall-clock + notes-coverage numbers. */
export function buildSummary(
	session: AuditSession,
	extras: {
		wallClockMs: number;
		notesSectionsFilled: number;
		notesSectionsTotal: number;
	},
): AuditSummary {
	return {
		...summarizeDecisions(session.decisions),
		wallClockMs: extras.wallClockMs,
		notesSectionsFilled: extras.notesSectionsFilled,
		notesSectionsTotal: extras.notesSectionsTotal,
	};
}

/** Render a single decision as a markdown block. Pure. */
export function renderDecision(d: DispatchDecision): string {
	const lines: string[] = [];
	const stamp = new Date(d.timestamp).toISOString().slice(11, 16); // HH:MM
	lines.push(`### Turn ${d.turn} — ${stamp}`);
	lines.push("");
	lines.push(`- User: ${d.userInput || "(no user input recorded)"}`);
	lines.push(`- Decision: ${d.decision}${d.agent ? ` ${d.agent}` : ""}`);
	lines.push(`- Reason: ${d.reason}`);
	if (d.task) {
		lines.push(`- Task: ${d.task}`);
	}
	if (d.expectedOutput) {
		lines.push(`- Expected output: ${d.expectedOutput}`);
	}
	if (d.tokens !== undefined) {
		lines.push(`- Tokens: ~${d.tokens}`);
	}
	if (d.elapsedMs !== undefined) {
		lines.push(`- Elapsed: ~${d.elapsedMs}ms`);
	}
	return lines.join("\n");
}

/** Render the full audit log as a markdown string. Pure. */
export function renderAuditLog(session: AuditSession, summary: AuditSummary): string {
	const lines: string[] = [];
	lines.push(AUDIT_LOG_MARKER);
	lines.push("");
	lines.push("# Brainstorm Dispatch Log");
	lines.push("");
	lines.push(`- Run: ${session.runId}`);
	lines.push(`- Started: ${session.startedAt}`);
	lines.push(`- Seed: "${session.seed}"`);
	lines.push("");
	lines.push("## Decisions");
	lines.push("");
	if (session.decisions.length === 0) {
		lines.push("_(no scout dispatches — the parent answered all questions inline.)_");
		lines.push("");
	} else {
		for (const d of session.decisions) {
			lines.push(renderDecision(d));
			lines.push("");
		}
	}
	lines.push("## Summary");
	lines.push("");
	lines.push(`- Total dispatches: ${summary.totalDispatches}`);
	const agentsList = Object.entries(summary.dispatchesByAgent)
		.map(([a, n]) => `${a} x${n}`)
		.join(", ");
	if (agentsList) lines.push(`- Dispatches by agent: ${agentsList}`);
	lines.push(`- Inline reads: ${summary.inlineReads}`);
	lines.push(`- Skipped: ${summary.skipped}`);
	lines.push(`- Side-channel: ${summary.sideChannel}`);
	lines.push(`- Wall-clock total: ~${summary.wallClockMs}ms`);
	lines.push(
		`- Notes sections filled: ${summary.notesSectionsFilled} / ${summary.notesSectionsTotal}`,
	);
	return lines.join("\n") + "\n";
}

/** Compute notes coverage (filled vs total sections) by scanning a
 *  brainstorm-notes document against the 7 required sections. Pure. */
export function countNotesSections(notes: string): { filled: number; total: number } {
	let filled = 0;
	for (const name of REQUIRED_NOTES_SECTIONS) {
		const body = sectionBody(notes, name);
		if (body === undefined || body.length === 0) continue;
		const nonEmpty = body
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && l !== "_TBD_");
		if (nonEmpty.length > 0) filled++;
	}
	return { filled, total: REQUIRED_NOTES_SECTIONS.length };
}

// ─────────────────────────────────────────────────────────────────────────
// I/O helpers
// ─────────────────────────────────────────────────────────────────────────

/** Absolute path of the audit log for a run. */
export function auditLogPath(runId: string, cwd: string): string {
	return join(buildRunDir(runId, cwd), "brainstorm", "brainstorm-dispatch.md");
}

/** Write the audit log atomically to the run's brainstorm folder.
 *  Returns the absolute path of the file written. */
export function writeAuditLog(
	cwd: string,
	session: AuditSession,
	summary: AuditSummary,
): string {
	const filePath = auditLogPath(session.runId, cwd);
	atomicWriteFile(filePath, renderAuditLog(session, summary), "utf8");
	return filePath;
}

/** Read an existing audit log from disk. Returns null if the file does
 *  not exist. Parses the marker + metadata lines into an AuditSession-like
 *  shape (does not reconstruct decisions — just metadata). */
export function readAuditLog(cwd: string, runId: string): {
	runId: string;
	startedAt: string;
	seed: string;
	content: string;
} | null {
	const filePath = auditLogPath(runId, cwd);
	if (!existsSync(filePath)) return null;
	const raw = readFileSync(filePath, "utf8");
	if (!raw.startsWith(AUDIT_LOG_MARKER)) return null;
	const startedMatch = raw.match(/^- Started: (.+)$/m);
	const seedMatch = raw.match(/^- Seed: "(.*)"$/m);
	return {
		runId,
		startedAt: startedMatch?.[1] ?? "",
		seed: seedMatch?.[1] ?? "",
		content: raw,
	};
}
