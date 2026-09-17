/**
 * Brainstorm session tool (Phase 1 of the lifecycle v2 upgrade; v2.1 added
 * request-scan-gate).
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
 *   - set-scans: persists the scan kinds (used after request-scan-gate, or
 *     when a programmatic caller wants to skip the picker).
 *   - upsert-question: records one DISCUSS-loop question state change.
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
import {
	withFileMutationQueue,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { loadFilesConfig } from "../core/config.js";
import {
	confirmUnderstanding,
	loadState,
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
import { runScanGatePicker } from "./brainstorm/scan-gate.js";
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
			"set-scans (persist the scan selection from the scan-plan gate), " +
			"upsert-question (record one question state change during DISCUSS; reason is required for not-wanted/replaced). " +
			"Returns the updated session snapshot.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("confirm-understanding"),
				Type.Literal("request-scan-gate"),
				Type.Literal("set-scans"),
				Type.Literal("upsert-question"),
			]),
			scans: Type.Optional(
				Type.Array(Type.Union(SCAN_TYPES.map((s) => Type.Literal(s))), {
					description: "Required for set-scans. Empty array = user skipped scans.",
				}),
			),
			question: Type.Optional(
				Type.Object(
					{
						id: Type.String({ description: "Question id, e.g. Q1." }),
						text: Type.String(),
						suggestedAnswer: Type.Optional(Type.String()),
						state: Type.Union(BRAINSTORM_QUESTION_STATES.map((s) => Type.Literal(s))),
						reason: Type.Optional(
							Type.String({ description: "Required when state is not-wanted or replaced." }),
						),
					},
					{ description: "Required for upsert-question." },
				),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return withFileMutationQueue(join(ctx.cwd, PATHS.STATE_FILE), async () => {
				const state = loadState(ctx.cwd);
				if (!state.runId || state.currentStage !== "brainstorming") {
					return errorResult(
						"No active brainstorm. Run /velpari-brainstorm <topic> first.",
					);
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
					const invalid = scans.filter(
						(s) => !(SCAN_TYPES as readonly string[]).includes(s),
					);
					if (invalid.length > 0) {
						return errorResult(
							`Unknown scan type(s): ${invalid.join(", ")}. Allowed: ${SCAN_TYPES.join(", ")}.`,
						);
					}
					const next = setScansSelected(state, scans, ctx.cwd);
					persistEntry(next);
					return okResult(snapshot(next));
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
					return errorResult(
						`State "${question.state}" requires a reason (deferred, not forgotten).`,
					);
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
		cancelled: false,
		freeform: false,
	};
}

type Snapshot = ReturnType<typeof snapshot>;

function okResult(state: Snapshot) {
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
