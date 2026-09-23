/**
 * Brainstorm session tool (Phase 1 of the lifecycle v2 upgrade; v2.1 added
 * request-scan-gate; v1.x added request-extra-scan + confirm-web-dispatch;
 * v3 added spawn-sessions + close-sessions).
 *
 * The parent LLM drives the brainstorm lifecycle (UNDERSTAND → CONFIRM →
 * scan gate → DISCUSS) through conversation, but the hard-lock state must
 * live in state.json — not in chat memory. This tool is the LLM-callable
 * bridge to the brainstorm helpers in core/state.ts:
 *
 *   - confirm-understanding: releases the hard lock after the user confirms
 *     the parent's one-paragraph understanding (velpari is requirements-only,
 *     so unlike senai no mission type is recorded).
 *   - request-scan-gate (v2.1): invokes the mandatory SCAN-gate picker via
 *     ctx.ui.select/confirm and persists the result. Replaces the
 *     conversational "what scans?" prompt — there is NO default; the
 *     developer always chooses.
 *   - request-extra-scan (v1.x): re-opens the SCAN picker during DISCUSS for
 *     scans the developer did not pick at the upfront gate (offers only the
 *     missing ones; community consent preserved).
 *   - confirm-web-dispatch (v1.x): per-dispatch consent prompt before each
 *     web-search-agent call; appends an audit-trail entry to
 *     state.json:webDispatchConfirmations.
 *   - set-scans: persists the scan kinds (used after request-scan-gate, or
 *     when a programmatic caller wants to skip the picker).
 *   - upsert-question: records one DISCUSS-loop question state change.
 *   - spawn-sessions (v3): persists the 2 persistent sub-agent session
 *     handles returned from subagent() calls. Called by the handler (or
 *     by the parent LLM after it executes the prepared spawn payload).
 *     Validates both handles are non-empty strings before writing.
 *   - close-sessions (v3): clears state.activeSubagents. Called by the
 *     approve-brainstorm command after subagent_interrupt fires on both
 *     panes (graceful close — Phase 8).
 *   - discard (brainstorm-anytime, D7): closes the session WITHOUT
 *     publishing. Clears the session fields and resumes the paused stage
 *     (or "none" on a first run); a history entry records the discard.
 *
 * The tool is gated on an active brainstorm: velpari's brainstorm is a real
 * stage in the chained stage machine, so "active" means a run exists and
 * currentStage === "brainstorming" (senai checks brainstormRunId instead —
 * velpari has no orthogonal brainstorm run id).
 *
 * Writes run inside withFileMutationQueue (tools execute in parallel in pi).
 * Velpari has no io/lock (withRunLock) equivalent — cross-session exclusion
 * is a senai-only concern here; saveState is atomic (temp + rename), which
 * covers process crashes.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { Type } from "typebox";
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../core/config.js";
import {
	appendWebDispatchConsent,
	confirmUnderstanding,
	discardBrainstormSession,
	loadState,
	saveState,
	setActiveSubagents,
	setScansSelected,
	upsertBrainstormQuestion,
	BRAINSTORM_QUESTION_STATES,
	SCAN_TYPES,
	type BrainstormQuestion,
	type RunState,
	type ScanType,
} from "../core/state.js";
import { PATHS } from "../core/constants.js";
import { buildRunDir } from "../core/paths.js";
import { runExtraScanPicker, runScanGatePicker, runWebDispatchConsent } from "./brainstorm/scan-gate.js";
import { syncDecisionsToNotes } from "./brainstorm/notes.js";

export function registerBrainstormSessionTool(pi: ExtensionAPI): void {
	// Mirror every mutation into the session file (pi.appendEntry) so /fork
	// and /resume carry the brainstorm progress with the session, not just
	// the project-level state.json. Best-effort: the state.json write above
	// is the truth; the entry is for session portability + observability.
	const persistEntry = (state: RunState) => {
		try {
			pi.appendEntry("velpari-brainstorm", snapshot(state));
		} catch {
			// Headless or read-only session — state.json already has the truth.
		}
	};

	pi.registerTool({
		name: "velpari_brainstorm_session",
		label: "Update brainstorm session state",
		description:
			"Update the active brainstorm session during /velpari-brainstorm. Actions: " +
			"confirm-understanding (after the user confirms your understanding paragraph — releases the hard lock), " +
			"request-scan-gate (open the mandatory SCAN-gate picker — v2.1: developer always chooses, no default), " +
			"request-extra-scan (v1.x: re-open the SCAN picker during DISCUSS for scans not yet opted-in), " +
			"confirm-web-dispatch (v1.x: per-dispatch consent prompt before each web-search-agent call; needs topic), " +
			"set-scans (persist the scan selection from the scan-plan gate), " +
			"upsert-question (record one question state change during DISCUSS; reason is required for not-wanted/replaced), " +
			"spawn-sessions (v3: persist the 2 persistent sub-agent session handles returned from the AUTOMATIC SPAWN subagent() calls; needs web + docCode strings), " +
			"close-sessions (v3: clear state.activeSubagents after subagent_interrupt fires on both panes — called by /velpari-approve-brainstorm on graceful close), " +
			'discard (close the session WITHOUT publishing — clears the session fields and resumes the paused stage, or "none" on a first run; no artifact is written). ' +
			"Returns the updated session snapshot.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("confirm-understanding"),
				Type.Literal("request-scan-gate"),
				Type.Literal("request-extra-scan"),
				Type.Literal("confirm-web-dispatch"),
				Type.Literal("set-scans"),
				Type.Literal("upsert-question"),
				Type.Literal("spawn-sessions"),
				Type.Literal("close-sessions"),
				Type.Literal("discard"),
			]),
			scans: Type.Optional(
				Type.Array(Type.Union(SCAN_TYPES.map((s) => Type.Literal(s))), {
					description: "Required for set-scans. Empty array = user skipped scans.",
				}),
			),
			topic: Type.Optional(
				Type.String({
					description:
						"Required for confirm-web-dispatch — short topic label for the audit ledger (e.g. 'community patterns for BSE').",
				}),
			),
			question: Type.Optional(
				Type.Object(
					{
						id: Type.String({ description: "Question id, e.g. Q1." }),
						text: Type.String(),
						suggestedAnswer: Type.Optional(Type.String()),
						state: Type.Union(BRAINSTORM_QUESTION_STATES.map((s) => Type.Literal(s))),
						reason: Type.Optional(Type.String({ description: "Required when state is not-wanted or replaced." })),
					},
					{ description: "Required for upsert-question." },
				),
			),
			web: Type.Optional(
				Type.String({
					description: "v3 spawn-sessions: session handle for the web-research persistent session (typically 'web').",
				}),
			),
			docCode: Type.Optional(
				Type.String({
					description:
						"v3 spawn-sessions: session handle for the doc-code-analyst persistent session (typically 'doc-code').",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return withFileMutationQueue(join(ctx.cwd, PATHS.STATE_FILE), async () => {
				const state = loadState(ctx.cwd);
				if (!state.runId || state.currentStage !== "brainstorming") {
					return errorResult("No active brainstorm. Run /velpari-brainstorm <topic> first.");
				}

				if (params.action === "confirm-understanding") {
					const next = confirmUnderstanding(state, ctx.cwd);
					persistEntry(next);
					return okResult(snapshot(next));
				}

				if (params.action === "request-scan-gate") {
					// Open the mandatory picker. Reads files.json v4 to know
					// which scans are available; persists the result via
					// setScansSelected. The picker NEVER auto-selects — the
					// developer must choose (or skip).
					const config = loadFilesConfig(ctx.cwd);
					const result = await runScanGatePicker(
						// The real ExtensionContext has ui; tests pass a
						// narrower mock. The picker tolerates missing ui by
						// returning the cancelled sentinel so test paths
						// stay clean.
						ctx as unknown as Parameters<typeof runScanGatePicker>[0],
						{ config, cwd: ctx.cwd },
					);
					const next = setScansSelected(state, result.scans, ctx.cwd);
					persistEntry(next);
					return okResult({
						...snapshot(next),
						cancelled: result.cancelled,
						freeform: result.freeform,
					});
				}

				if (params.action === "set-scans") {
					const scans = params.scans as ScanType[] | undefined;
					if (!scans) {
						return errorResult("set-scans needs a scans array (may be empty).");
					}
					const invalid = scans.filter((s) => !(SCAN_TYPES as readonly string[]).includes(s));
					if (invalid.length > 0) {
						return errorResult(`Unknown scan type(s): ${invalid.join(", ")}. Allowed: ${SCAN_TYPES.join(", ")}.`);
					}
					const next = setScansSelected(state, scans, ctx.cwd);
					persistEntry(next);
					return okResult(snapshot(next));
				}

				if (params.action === "request-extra-scan") {
					// v1.x: re-open the SCAN picker for scans the developer did
					// NOT pick at the upfront gate. Used during the DISCUSS loop
					// when the developer mentions community / web / official /
					// industrial and the active brainstorm has not opted in yet.
					const config = loadFilesConfig(ctx.cwd);
					const result = await runExtraScanPicker(ctx as unknown as Parameters<typeof runScanGatePicker>[0], {
						config,
						cwd: ctx.cwd,
						alreadySelected: state.scansSelected ?? [],
					});
					if (result.cancelled) {
						return okResult({ ...snapshot(state), addedScans: [], cancelled: true });
					}
					const merged = Array.from(new Set([...(state.scansSelected ?? []), ...result.scans])) as ScanType[];
					const next = setScansSelected(state, merged, ctx.cwd);
					persistEntry(next);
					return okResult({
						...snapshot(next),
						addedScans: result.scans,
						cancelled: false,
						freeform: result.freeform,
					});
				}

				if (params.action === "confirm-web-dispatch") {
					// v1.x: per-dispatch consent for a single web search. Fires
					// ctx.ui.confirm "This scout will search the public web for:
					// <topic>. Confirm?" before the parent LLM invokes subagent().
					// The dispatcher keeps the FR-52 role anchor; the parent LLM
					// honors the consent result before calling subagent().
					const topic = (params.topic as string | undefined)?.trim();
					if (!topic) {
						return errorResult("confirm-web-dispatch needs a non-empty topic.");
					}
					const ok = await runWebDispatchConsent(ctx as unknown as Parameters<typeof runScanGatePicker>[0], topic);
					if (!ok) {
						return okResult({ ...snapshot(state), cancelled: true });
					}
					const next = appendWebDispatchConsent(state, topic, ctx.cwd);
					persistEntry(next);
					return okResult({ ...snapshot(next), cancelled: false });
				}

				if (params.action === "spawn-sessions") {
					// v3 — AUTOMATIC SPAWN. Persist the 2 persistent sub-agent
					// session handles returned from the subagent() calls. The
					// spawn helper (stages/brainstorm/spawn-sessions.ts) prepares
					// the subagent() payload; this action lands the result.
					// Validates both handles are non-empty strings.
					const web = (params.web as string | undefined)?.trim();
					const docCode = (params.docCode as string | undefined)?.trim();
					if (!web || !docCode) {
						return errorResult("spawn-sessions needs both `web` and `docCode` non-empty handles.");
					}
					const next = setActiveSubagents(state, { web, docCode }, ctx.cwd);
					persistEntry(next);
					return okResult(snapshot(next));
				}

				if (params.action === "close-sessions") {
					// v3 — graceful close. Clear state.activeSubagents after
					// the caller has fired subagent_interrupt on both panes
					// (typically /velpari-approve-brainstorm). Idempotent —
					// a no-op when activeSubagents is already undefined.
					const next: RunState = {
						...state,
						activeSubagents: undefined,
						updatedAt: new Date().toISOString(),
					};
					saveState(next, ctx.cwd);
					persistEntry(next);
					return okResult(snapshot(next));
				}

				if (params.action === "discard") {
					// D7 — close the session WITHOUT publishing. Clears the
					// brainstorm session fields and resumes the paused stage
					// (or "none" on a first run). No artifact is written; a
					// history entry records the discard.
					const resumedFrom = state.pausedStage ?? "none";
					const next = discardBrainstormSession(ctx.cwd);
					persistEntry(next);
					return okResult({
						...snapshot(next),
						discarded: true,
						resumedStage: next.currentStage,
						message:
							next.currentStage === "none"
								? "Brainstorm session discarded — no artifact published. Back to a fresh project state."
								: `Brainstorm session discarded — no artifact published. Resumed "${resumedFrom}".`,
					});
				}

				// upsert-question
				const question = params.question as BrainstormQuestion | undefined;
				if (!question || !question.id || !question.text || !question.state) {
					return errorResult("upsert-question needs question: { id, text, state }.");
				}
				if (!(BRAINSTORM_QUESTION_STATES as readonly string[]).includes(question.state)) {
					return errorResult(
						`Unknown question state "${question.state}". Allowed: ${BRAINSTORM_QUESTION_STATES.join(", ")}.`,
					);
				}
				if (
					(question.state === "not-wanted" || question.state === "replaced") &&
					(!question.reason || question.reason.trim() === "")
				) {
					return errorResult(`State "${question.state}" requires a reason (deferred, not forgotten).`);
				}
				const next = upsertBrainstormQuestion(state, question, ctx.cwd);
				// The decision ledger lives in the notes file: regenerate the
				// marker-wrapped Agreed / Not wanted / Open block on every
				// upsert. Best-effort — never fail the tool action on it.
				// (The sync sits at this L1 caller because core/state.ts is L0
				// and must not import the L1 notes module.)
				try {
					const notesPath = findNotesPath(next, ctx.cwd);
					if (notesPath) {
						syncDecisionsToNotes(notesPath, next.brainstormQuestions ?? []);
					}
				} catch {
					// Ledger sync is best-effort; the state write already landed.
				}
				persistEntry(next);
				return okResult(snapshot(next));
			});
		},
	});
}

/** Session snapshot returned to the LLM and mirrored via pi.appendEntry. */
function snapshot(state: RunState) {
	return {
		runId: state.runId,
		understandingConfirmed: state.understandingConfirmed === true,
		scansSelected: state.scansSelected ?? [],
		questions: state.brainstormQuestions ?? [],
		brainstormDispatchCount: state.brainstormDispatchCount ?? 0,
		webDispatchConfirmations: state.webDispatchConfirmations ?? [],
		// v3 — include the 2 persistent sub-agent handles so the parent LLM
		// can route messages after spawn-sessions lands.
		activeSubagents: state.activeSubagents
			? {
					web: state.activeSubagents.web,
					docCode: state.activeSubagents.docCode,
					spawnedAt: state.activeSubagents.spawnedAt,
				}
			: null,
		cancelled: false,
		freeform: false,
	};
}

type Snapshot = ReturnType<typeof snapshot>;

/** okResult accepts the base snapshot plus action-specific extras
 *  (`addedScans`, `cancelled`, `freeform`). Kept open so the parent LLM
 *  gets a useful payload for each action without a hardcoded union. */
function okResult(state: Snapshot & Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }],
		details: state,
	};
}

function errorResult(reason: string) {
	return {
		content: [{ type: "text" as const, text: reason }],
		details: null,
		isError: true,
	};
}

/** Locate the working-copy notes for the active run: grouped layout first,
 *  legacy flat layout as fallback (same convention as brainstorm-approve).
 *  Returns undefined when neither exists — sync is skipped then. */
function findNotesPath(state: RunState, cwd: string): string | undefined {
	const runDir = buildRunDir(state.runId, cwd);
	const grouped = join(runDir, "brainstorm", "brainstorm-notes.md");
	if (existsSync(grouped)) return grouped;
	const legacy = join(runDir, "brainstorm-notes.md");
	if (existsSync(legacy)) return legacy;
	return undefined;
}
