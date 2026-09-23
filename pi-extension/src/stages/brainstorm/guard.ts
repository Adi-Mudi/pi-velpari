/**
 * Brainstorm guard layer (Phase 2 of the lifecycle v2 upgrade).
 *
 * Pure functions returning { ok, reason?, details? } for the brainstorm
 * checkpoints. Every guard is side-effect-free — callers wire them in at
 * the right place and surface the reason to the user.
 *
 * Guards:
 *   1. guardSeedInput          — refuse /velpari-brainstorm with empty seed.
 *   2. guardNotesContent       — refuse approve while brainstorm-notes.md has
 *                                missing/empty/_TBD_ required sections.
 *   3. guardArtifactPath       — refuse artifact paths escaping the run dir.
 *   4. guardDispatchCount      — refuse dispatch beyond the per-brainstorm cap.
 *   5. guardApproveReadiness   — hard-lock approve until understanding is
 *                                confirmed and every question is terminal.
 *   5b. guardStageForBrainstorm — refuse re-running /velpari-brainstorm while
 *                                a brainstorm session is already open (nested
 *                                open). Any other stage may open a brainstorm
 *                                (brainstorm-anytime).
 *   6. guardBrainstormMutation — hard-block edit/write outside the run's
 *                                brainstorm folder while a brainstorm is open.
 *
 * Velpari adaptations from senai's guard.ts: no mission types, no explore
 * decide door, no draft marker. The mutation lock lifts when the stage
 * advances past "brainstorming" (chained machine equivalent of senai's
 * finalized-brief check).
 */

import { resolve, relative, isAbsolute, sep } from "node:path";
import { buildRunDir } from "../../core/paths.js";
import type { RunState } from "../../core/state.js";
import { NOTES_CONTENT_PLACEHOLDER, REQUIRED_NOTES_SECTIONS, sectionBody } from "./notes.js";

/** Result type returned by every guard. `ok: true` means proceed;
 *  `ok: false` means block, with a human-readable reason. */
interface GuardResult {
	ok: boolean;
	reason?: string;
	/** Optional structured details — used by tests + doctor to surface specifics. */
	details?: string[];
}

/** Max subagent dispatches allowed per brainstorm. Keeps token spend bounded. */
export const VELPARI_BRAINSTORM_DISPATCH_CAP = 3;

/** ──────────────────────────────────────────────────────────────────────
 *  1. Seed input guard
 *  ────────────────────────────────────────────────────────────────────── */

/** Refuse empty seed input at /velpari-brainstorm entry.
 *
 *  The parent LLM needs at least one signal (topic, insight, goal, question)
 *  to anchor the Q&A. Without a seed the parent would guess the user's
 *  intent — exactly the failure mode brainstorm is supposed to prevent.
 *
 *  Whitespace-only counts as empty. */
export function guardSeedInput(mission: string): GuardResult {
	const trimmed = (mission ?? "").trim();
	if (trimmed.length === 0) {
		return {
			ok: false,
			reason:
				`Provide a seed topic so the parent LLM can anchor the brainstorm.\n` +
				`Usage: /velpari-brainstorm "<topic or insight>"\n` +
				`Example: /velpari-brainstorm "todo CLI app with sync"`,
		};
	}
	return { ok: true };
}

/** ──────────────────────────────────────────────────────────────────────
 *  2. Notes content guard
 *  ────────────────────────────────────────────────────────────────────── */

/** Refuse to approve a brainstorm whose notes still have missing, empty, or
 *  `_TBD_` sections. Hard reject — the user must fill the gaps before
 *  /velpari-approve-brainstorm succeeds. */
export function guardNotesContent(raw: string): GuardResult {
	const unfilled: string[] = [];
	for (const name of REQUIRED_NOTES_SECTIONS) {
		const body = sectionBody(raw, name);
		if (body === undefined) {
			unfilled.push(`${name} (missing)`);
		} else if (body.length === 0) {
			unfilled.push(`${name} (empty)`);
		} else if (body.includes(NOTES_CONTENT_PLACEHOLDER)) {
			unfilled.push(`${name} (${NOTES_CONTENT_PLACEHOLDER} placeholder)`);
		}
	}
	if (unfilled.length > 0) {
		return {
			ok: false,
			reason:
				`Brainstorm notes are not ready to approve. Fill these sections first:\n` +
				unfilled.map((s) => `  - ${s}`).join("\n") +
				`\n\nRe-run /velpari-approve-brainstorm after the notes are complete.`,
			details: unfilled,
		};
	}
	return { ok: true };
}

/** ──────────────────────────────────────────────────────────────────────
 *  3. Artifact path guard
 *  ────────────────────────────────────────────────────────────────────── */

/** Refuse artifact paths that escape the run dir. The path must resolve to
 *  a descendant of `runDir`. Path traversal (`..`) is rejected explicitly;
 *  NUL bytes are rejected outright. */
export function guardArtifactPath(artifactPath: string, runDir: string): GuardResult {
	if (!runDir) {
		return { ok: false, reason: "No run dir — cannot validate artifact path." };
	}
	if (artifactPath.includes("\0")) {
		return { ok: false, reason: "Artifact path contains a NUL byte." };
	}
	const resolved = resolve(artifactPath);
	const allowedRoot = resolve(runDir);
	// path.relative + isAbsolute detects escape via `..`.
	const rel = relative(allowedRoot, resolved);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		return {
			ok: false,
			reason:
				`Artifact path escapes the run dir.\n` +
				`  got:      ${artifactPath}\n` +
				`  resolved: ${resolved}\n` +
				`  allowed:  ${allowedRoot}`,
		};
	}
	return { ok: true };
}

/** ──────────────────────────────────────────────────────────────────────
 *  4. Dispatch count guard
 *  ────────────────────────────────────────────────────────────────────── */

/** Refuse subagent dispatch when the count would exceed the per-brainstorm
 *  cap. The cap protects the parent context from ballooning and keeps the
 *  audit log focused on the most consequential decisions. */
export function guardDispatchCount(count: number): GuardResult {
	if (count < 0) {
		return { ok: false, reason: "Dispatch count must be non-negative." };
	}
	if (count >= VELPARI_BRAINSTORM_DISPATCH_CAP) {
		return {
			ok: false,
			reason:
				`Brainstorm dispatch cap reached (${VELPARI_BRAINSTORM_DISPATCH_CAP}).\n` +
				`Continue research inline, or end the brainstorm and start a new one.`,
		};
	}
	return { ok: true };
}

/** ──────────────────────────────────────────────────────────────────────
 *  5. Approve readiness guard (hard lock)
 *  ────────────────────────────────────────────────────────────────────── */

/** Hard-block /velpari-approve-brainstorm while the brainstorm lifecycle is
 *  unfinished: the user must have confirmed the parent's understanding
 *  (UNDERSTAND → CONFIRM loop) and every question must be in a terminal
 *  state (agreed / not-wanted / replaced). "draft" and "discussing" block.
 *
 *  No explore check — velpari is requirements-only (decision 2). */
export function guardApproveReadiness(state: RunState): GuardResult {
	if (state.understandingConfirmed !== true) {
		return {
			ok: false,
			reason:
				`Understanding is not confirmed yet.\n` +
				`Finish the UNDERSTAND → CONFIRM loop first: the parent shows a short ` +
				`summary of what it understood, you confirm or correct it, and only ` +
				`then can the notes be approved.`,
		};
	}
	const open = (state.brainstormQuestions ?? []).filter((q) => q.state === "draft" || q.state === "discussing");
	if (open.length > 0) {
		return {
			ok: false,
			reason:
				`${open.length} question(s) still open: ${open.map((q) => q.id).join(", ")}.\n` +
				`Confirm, cancel (with reason), or supersede each one, then re-run ` +
				`/velpari-approve-brainstorm.`,
			details: open.map((q) => `${q.id}: ${q.state} — ${q.text}`),
		};
	}
	return { ok: true };
}

/** ──────────────────────────────────────────────────────────────────────
 *  5b. Stage guard at /velpari-brainstorm entry (v2.2)
 *  ────────────────────────────────────────────────────────────────────── */

/** Hard-block `/velpari-brainstorm` only when a brainstorm session is
 *  already open (nested open). Brainstorm-anytime: from any other stage the
 *  command pauses the current stage (`openBrainstormSession`) and opens a
 *  brainstorm session; from `none` it starts a fresh run. An open session is
 *  closed by approve (`/velpari-approve-brainstorm`) or discard
 *  (`velpari_brainstorm_session({ action: "discard" })`) — never by starting
 *  another brainstorm on top of it. */
export function guardStageForBrainstorm(state: RunState): GuardResult {
	if (state.currentStage !== "brainstorming") {
		return { ok: true };
	}
	return {
		ok: false,
		reason:
			"A brainstorm is already open — approve or discard it before starting a new one.\n" +
			'Run /velpari-approve-brainstorm to publish it, or discard it via velpari_brainstorm_session({ action: "discard" }).',
		details: [state.currentStage],
	};
}

/** ──────────────────────────────────────────────────────────────────────
 *  6. Brainstorm mutation gate (hard enforcement, tool_call hook)
 *  ────────────────────────────────────────────────────────────────────── */

/** Block edit/write tool calls outside the active run's brainstorm folder
 *  while a brainstorm is open (currentStage === "brainstorming"). The
 *  brainstorm stage is read-only for the project — the only allowed writes
 *  live under `.IDE_Plans/velpari/runs/<runId>/brainstorm/`.
 *
 *  Brainstorm-anytime (D4): "open" includes a session opened from a paused
 *  stage (pausedStage set) — this lock then owns ALL edit/write gating,
 *  including writes to the paused stage's folder, and the stage-folder
 *  lock (hooks/tool-call.ts:guardStageMutation) is suppressed.
 *
 *  Lifts automatically when no brainstorm is active (no runId, or the stage
 *  advanced past "brainstorming" — approve/discard releases the lock). Bash
 *  is intentionally NOT gated (no reliable target path).
 *
 *  Returns the pi tool_call block shape ({ block, reason }) or undefined to
 *  allow. Pure — the caller (hook) loads state and passes it in. */
export function guardBrainstormMutation(
	toolName: string,
	input: Record<string, unknown> | undefined,
	state: RunState,
	cwd: string,
): { block: true; reason: string } | undefined {
	if (toolName !== "edit" && toolName !== "write") return undefined;
	if (!state.runId || state.currentStage !== "brainstorming") return undefined;

	const target = typeof input?.path === "string" ? resolve(cwd, input.path) : "";
	const allowedRoot = resolve(buildRunDir(state.runId, cwd), "brainstorm");
	if (target && target.startsWith(allowedRoot + sep)) return undefined;

	return {
		block: true,
		reason:
			`Brainstorm "${state.runId}" is still open — the project is read-only outside the brainstorm folder until approve.\n` +
			`Finish DISCUSS and run /velpari-approve-brainstorm first.\n` +
			`(Writes inside ${relative(cwd, allowedRoot)}/ are allowed.)`,
	};
}
