import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { atomicWriteFile, atomicWriteJson } from "../io/atomic-write.js";
import { withRunLock } from "../io/run-lock.js";
import type { Stage } from "./constants.js";
import { PATHS, STAGE_TRANSITIONS } from "./constants.js";
import {
	appendHistory,
	historyFilePath,
	loadHistory,
	migrateInlineHistory,
} from "./history.js";
import type { SpikeResult } from "./spike.js";

/**
 * Locking contract: every public mutation entry point (createRun,
 * advanceStage, clearRun, confirmUnderstanding, setScansSelected,
 * setActiveSubagents, upsertBrainstormQuestion,
 * incrementBrainstormDispatchCount, clearBrainstormSession) wraps its
 * read-modify-write in `withRunLock` so concurrent sessions cannot
 * corrupt state.json. `loadState`/`saveState` stay lock-free leaves.
 * The lock is NOT recursive — a locked function must never call another
 * locked function.
 */

/**
 * Run state shape. Persisted to PATHS.STATE_FILE after every operation.
 */
export interface RunState {
	version: 1;
	runId: string;
	mission: string;
	currentStage: Stage;
	/** @deprecated B2 — history lives in the per-run `history.jsonl`
	 *  (see core/history.ts); state.json no longer carries it. The field
	 *  stays in the schema as optional so legacy state.json files and
	 *  existing fixtures still parse; runtime readers use `loadHistory`. */
	history?: HistoryEntry[];
	updatedAt: string;
	/** A2 — stage that was in progress when a brainstorm session opened
	 *  mid-run (brainstorm-anytime). Absent on a first-run brainstorm
	 *  (createRun seeds "brainstorming" with nothing to pause). Set by
	 *  `openBrainstormSession`, consumed by the approve-time door choice
	 *  (continue → resume it; restart-prd → land at "brainstormed"), and
	 *  cleared by `resumeFromBrainstorm`/`discardBrainstormSession`. */
	pausedStage?: Stage;
	/** Hard lock for the brainstorm lifecycle: true only after the user has
	 *  confirmed the parent's one-paragraph understanding. */
	understandingConfirmed?: boolean;
	/** Scan kinds the user selected at the scan-plan gate.
	 *  @deprecated v3 — replaced by `activeSubagents`. The v1.x brainstorm
	 *  scan-gate picker is gone; the v3 brainstorm opens 2 persistent
	 *  sessions automatically at step 2 and routes per user message.
	 *  Kept in the schema for back-compat so older state.json files still
	 *  parse; the v3 handler no longer reads it. Will be removed in v4. */
	scansSelected?: ScanType[];
	/** Per-question states for the DISCUSS loop of the active brainstorm.
	 *  Open states ("draft", "discussing") hard-block approve. */
	brainstormQuestions?: BrainstormQuestion[];
	/** Number of subagent dispatches the parent LLM has made during the
	 *  active brainstorm (dispatch cap bookkeeping). */
	brainstormDispatchCount?: number;
	/** v1.x — per-dispatch web consent ledger. Appended by the
	 *  `confirm-web-dispatch` tool action (one entry per developer
	 *  consent). Read at dispatch to audit which web calls were
	 *  approved. Cleared by `clearBrainstormSession` (called from
	 *  /velpari-approve-brainstorm). The dispatcher keeps the FR-52
	 *  role anchor; per-dispatch consent is the runtime gate the
	 *  parent LLM honors between confirm-web-dispatch and subagent(). */
	webDispatchConfirmations?: WebDispatchConfirmation[];
	/** Feasibility v2 session: reuse-scan consent + verdict, language
	 *  candidates, spike results, final language choice. Present only while
	 *  the feasibility stage is open; cleared by `handleApprove` (which
	 * the publish tool and `/velpari-feasibility-approve` fall-back both
	 * call). A pending decision or missing language hard-blocks the
	 * feasibility approve. */
	feasibilitySession?: FeasibilitySession;
	/** Architecture sub-life cycle state. Present only while the design stage
	 *  is open; cleared by `handleApprove` (called via the publish tool
	 * or `/velpari-architecture-generator-approve` fall-back). The
	 * publish gate hard-blocks when `developerConfirmed` is false
	 * (Phase 2, plan §Phase 2). */
	archSubCycle?: ArchSubCycleState;
	/** Standards overlay selection (Phase 3, plan §Phase 3). Set by
	 *  /velpari-configure-standards; read by every stage that injects
	 *  overlay sections. When absent, the "none" overlay is implicit. */
	standardsProfile?: StandardsProfile;
	/** v1.4.0 — absolute path of the published logging plan
	 *  (Doc/observability/logging-plan_<projectName>.md). Set by the
	 *  cross-cutting discipline command /velpari-design-logging when
	 *  the working copy passes `validateLoggingPlan` + the doctor's
	 *  `checkLoggingPlanSection`. Cleared by /velpari-reset. */
	loggingPlanPublishedPath?: string;
	/** v3 — handles for the 2 persistent sub-agent sessions opened at
	 *  brainstorm step 2 (AUTOMATIC SPAWN). Set by the spawn helper at
	 *  `/velpari-brainstorm` entry; read by the dispatcher to resolve
	 *  `session: <handle>` on every routed subagent() call; cleared by
	 *  `/velpari-approve-brainstorm` after `subagent_interrupt` fires
	 *  on both panes. Survives Pi restart (persisted to state.json)
	 *  so rehydrate can resume the same sessions instead of re-spawning. */
	activeSubagents?: {
		/** Logical handle for the web-research session (per @mjakl/pi-subagent
		 *  naming convention). Maps to a subagent process running in row 1
		 *  of the multiplexer right column. */
		web?: string;
		/** Logical handle for the doc-code-analyst session. Maps to a
		 *  subagent process running in row 2 of the multiplexer right column. */
		docCode?: string;
		/** ISO timestamp of the spawn (used for staleness checks + receipts). */
		spawnedAt?: string;
	};
}

/** Standards profile shape (Phase 3). Persisted at .pi/velpari/standards-profile.json. */
export interface StandardsProfile {
	id: string;
	version: string;
	selectedAt: string;
	selectedBy: "user" | "inference";
	researchConsent?: boolean;
	researchSources?: string[];
}

/** Architecture sub-life cycle state. Persists the read → confirm → write
 *  discipline so a session resume knows whether the developer already
 *  approved the working context. */
interface ArchSubCycleState {
	/** True after the developer has picked "Proceed" on the confirm step. */
	developerConfirmed?: boolean;
	/** Outcome of the confirm step ("proceed" | "adjust" | "profile" | "no-ui"). */
	confirmOutcome?: "proceed" | "adjust" | "profile" | "no-ui";
	/** The summary shown to the developer at confirm time. */
	summaryShown?: string;
	/** True after loadArchContext has populated the working context. */
	contextLoaded?: boolean;
	/** True after any overlay-specific scout roles have spawned. */
	overlayLoaded?: boolean;
	/**
	 * v1.3.0+ multi-design: which `projectName` in the federation the
	 * developer is about to generate. Persisted by the prelude when the
	 * config has multiple projectNames; downstream stages + the doctor
	 * read it to scope the work to a single design.
	 */
	projectName?: string;
	/** Paths of scout reports already collected (for resume). */
	scoutReports?: string[];
	/** Number of ADRs captured so far in this sub-life cycle. */
	adrsCaptured?: number;
	/** Path of the working copy, once write has happened. */
	workingCopyPath?: string;
	/** ISO timestamp of the last state transition. */
	updatedAt?: string;
}

/** Feasibility v2 mid-stage session (mirrors the brainstorm v2 pattern). */
export interface FeasibilitySession {
	/** User consent for the web-research reuse scan (per-run, FR-52-style). */
	reuseConsent?: boolean;
	/** Build-vs-reuse verdict from the reuse scan. */
	decision?: "reuse" | "partial" | "build";
	/** Chat-summary rows of the reuse scan (detail lives in the checklist JSONs). */
	reuseSummary?: string[];
	/** Candidate languages offered for spikes (build path only). */
	languageCandidates?: string[];
	/** Validated spike results, one per candidate language. */
	spikeResults?: SpikeResult[];
	/** Final language choice — from clone (reuse path), config, or selection. */
	selectedLanguage?: string;
	/** Who/what picked selectedLanguage. */
	selectedBy?: "clone" | "config" | "auto" | "user";
}

export interface HistoryEntry {
	stage: Stage;
	command: string;
	timestamp: string;
}

/** Scan kinds offered at the brainstorm scan-plan gate. */
export const SCAN_TYPES = ["code", "doc", "community"] as const;
export type ScanType = (typeof SCAN_TYPES)[number];

/** Per-question lifecycle in the DISCUSS loop. "draft" and "discussing" are
 *  open (block approve); the other three are terminal. */
export const BRAINSTORM_QUESTION_STATES = [
	"draft",
	"discussing",
	"agreed",
	"not-wanted",
	"replaced",
] as const;
type BrainstormQuestionState = (typeof BRAINSTORM_QUESTION_STATES)[number];

export interface BrainstormQuestion {
	id: string;
	text: string;
	suggestedAnswer?: string;
	state: BrainstormQuestionState;
	/** Required for "not-wanted" (why the user rejected it) and "replaced"
	 *  (what superseded it). */
	reason?: string;
}

/** v1.x — one entry per developer consent for a single web search
 *  dispatch. The topic is a short label the parent LLM chose (e.g.
 *  "community patterns for BSE"). `confirmedAt` is the ISO timestamp of
 *  the user's yes on the consent prompt. */
interface WebDispatchConfirmation {
	topic: string;
	confirmedAt: string;
}

const EMPTY_STATE: RunState = {
	version: 1,
	runId: "",
	mission: "",
	currentStage: "none",
	history: [],
	updatedAt: "",
};

/**
 * Load the current run state from disk. Returns an empty state if no run exists.
 *
 * B1 one-time migration: when `.pi/velpari/state.json` is missing but the
 * legacy `.IDE_Plans/velpari/state.json` exists, the legacy file is moved
 * (history split out to the per-run history.jsonl) before the normal load.
 */
export function loadState(cwd: string = process.cwd()): RunState {
	const filePath = join(cwd, PATHS.STATE_FILE);
	if (!existsSync(filePath)) {
		const legacyPath = join(cwd, PATHS.LEGACY_STATE_FILE);
		if (!existsSync(legacyPath)) return { ...EMPTY_STATE };
		migrateLegacyState(cwd, legacyPath, filePath);
	}
	const raw = readFileSync(filePath, "utf8");
	const parsed = JSON.parse(raw) as Partial<RunState>;
	return {
		...EMPTY_STATE,
		...parsed,
		version: 1,
		history: parsed.history ?? [],
	};
}

/**
 * B1/B2 migration: read legacy state → write the new state.json without
 * inline history → split inline history into the per-run history.jsonl →
 * verify read-back → keep a one-time `.premigration.bak` (removed by the
 * next successful saveState) → delete the legacy file. Any failure before
 * the unlink leaves the legacy file in place so the next load retries.
 */
function migrateLegacyState(cwd: string, legacyPath: string, filePath: string): void {
	const raw = readFileSync(legacyPath, "utf8");
	const parsed = JSON.parse(raw) as Partial<RunState>;
	const { history, ...rest } = parsed;
	const migrated: RunState = { ...EMPTY_STATE, ...rest, version: 1 };
	atomicWriteJson(filePath, migrated);
	if (migrated.runId && history && history.length > 0) {
		migrateInlineHistory(cwd, migrated.runId, history);
	}
	const verified = JSON.parse(readFileSync(filePath, "utf8")) as Partial<RunState>;
	if (verified.runId !== migrated.runId) {
		throw new Error(
			`State migration verification failed: read-back runId "${verified.runId}" ` +
				`does not match "${migrated.runId}". Legacy state left in place.`,
		);
	}
	atomicWriteFile(`${filePath}.premigration.bak`, raw, "utf8");
	unlinkSync(legacyPath);
}

/**
 * Save run state to disk. Creates parent directories if missing.
 * Writes are atomic (temp + rename) via the io layer.
 *
 * B2: the deprecated `history` field is stripped before write — history
 * persists only in the per-run history.jsonl. A leftover migration
 * `.premigration.bak` is removed here: by the time the next save succeeds,
 * the new state.json is proven live.
 */
export function saveState(state: RunState, cwd: string = process.cwd()): void {
	const filePath = join(cwd, PATHS.STATE_FILE);
	const { history: _history, ...rest } = { ...state, updatedAt: new Date().toISOString() };
	atomicWriteJson(filePath, rest);
	const bakPath = `${filePath}.premigration.bak`;
	if (existsSync(bakPath)) unlinkSync(bakPath);
}

/**
 * Create a new run. Phase A stub — returns a state with a generated runId.
 */
export function createRun(mission: string, cwd: string = process.cwd()): RunState {
	return withRunLock(cwd, "createRun", () => {
		const now = new Date();
		const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 16);
		const slug = mission.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32);
		const seed: HistoryEntry = {
			stage: "brainstorming",
			command: "/velpari-brainstorm",
			timestamp: now.toISOString(),
		};
		const state: RunState = {
			version: 1,
			runId: `${stamp}-${slug}`,
			mission,
			currentStage: "brainstorming",
			history: [seed],
			updatedAt: now.toISOString(),
		};
		saveState(state, cwd);
		appendHistory(cwd, state.runId, seed);
		return state;
	});
}

/**
 * Advance the state to the next stage. Looks up the transition in
 * STAGE_TRANSITIONS, updates currentStage, appends to history, persists.
 * Throws if the transition is not allowed from the current state.
 *
 * v0.5.1 Phase J.1: the optional `pi` parameter honors the
 * `--velpari-stage` flag (registered in index.ts). When the flag is set
 * to a non-empty string, the override replaces the computed transition
 * target. The command itself is still recorded in history so the audit
 * trail is preserved. This is a test affordance for CI / scripted
 * scenarios that need to skip ahead to a specific stage.
 */
export function advanceStage(
	state: RunState,
	command: string,
	cwd: string = process.cwd(),
	pi?: ExtensionAPI,
): RunState {
	return withRunLock(cwd, `advanceStage:${command}`, () => {
		const stageOverride = pi?.getFlag?.("velpari-stage");
		const transition = STAGE_TRANSITIONS.find(
			(t) => t.from === state.currentStage && t.command === command,
		);
		if (!stageOverride && !transition) {
			throw new Error(
				`Cannot transition from "${state.currentStage}" via "${command}". ` +
					`No matching transition in STAGE_TRANSITIONS.`,
			);
		}
		const targetStage: Stage =
			(stageOverride as Stage | undefined) ?? transition!.to;
		const now = new Date().toISOString();
		const entry: HistoryEntry = { stage: targetStage, command, timestamp: now };
		const next: RunState = {
			...state,
			currentStage: targetStage,
			history: [...(state.history ?? []), entry],
			updatedAt: now,
		};
		saveState(next, cwd);
		appendHistory(cwd, next.runId, entry);
		return next;
	});
}

/**
 * Clear the current run. Deletes state.json (both the live and the legacy
 * location), the migration `.premigration.bak` if one is still around, and
 * the run's history.jsonl.
 */
export function clearRun(cwd: string = process.cwd()): void {
	withRunLock(cwd, "clearRun", () => {
		const filePath = join(cwd, PATHS.STATE_FILE);
		const legacyPath = join(cwd, PATHS.LEGACY_STATE_FILE);
		const runId = readRunId(filePath) ?? readRunId(legacyPath);
		if (runId) {
			const historyPath = historyFilePath(cwd, runId);
			if (existsSync(historyPath)) {
				unlinkSync(historyPath);
			}
		}
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
		if (existsSync(legacyPath)) {
			unlinkSync(legacyPath);
		}
		const bakPath = `${filePath}.premigration.bak`;
		if (existsSync(bakPath)) {
			unlinkSync(bakPath);
		}
	});
}

/** Best-effort runId probe — never triggers migration, never throws. */
function readRunId(filePath: string): string | undefined {
	try {
		if (!existsSync(filePath)) return undefined;
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<RunState>;
		return parsed.runId;
	} catch {
		return undefined;
	}
}

/**
 * Append the current run state to the session as a `velpari-state` entry.
 *
 * Phase E: implements the per-state persistence mechanism recommended in
 * the Pi extensions doc §State Management — "store it in tool result
 * `details` for proper branching support." With `pi.appendEntry`,
 * session_fork / session_resume naturally inherit prior state.
 *
 * Callers: ops/approve.ts and stages/brainstorm-approve.ts immediately
 * after a successful `advanceStage`.
 */
export function appendStageEntry(
	pi: ExtensionAPI,
	state: RunState,
	cwd: string = process.cwd(),
): void {
	pi.appendEntry("velpari-state", {
		runId: state.runId,
		mission: state.mission,
		stage: state.currentStage,
		updatedAt: state.updatedAt,
		history: loadHistory(cwd, state.runId),
	});
}

// ---------------------------------------------------------------------------
// Brainstorm session helpers (Phase 1 of the lifecycle v2 upgrade).
//
// All four helpers spread `...state`, persist via saveState, and NEVER touch
// `currentStage` — velpari's stage machine stays chained (brainstorm is a
// real stage: none → brainstorming → brainstormed); the brainstorm lifecycle
// lives entirely inside the "brainstorming" stage.
// ---------------------------------------------------------------------------

/**
 * Mark the understanding as user-confirmed (the hard lock release).
 * Velpari is requirements-only — unlike senai, no mission type is recorded.
 */
export function confirmUnderstanding(state: RunState, cwd: string = process.cwd()): RunState {
	return withRunLock(cwd, "confirmUnderstanding", () => {
		const next: RunState = {
			...state,
			understandingConfirmed: true,
			updatedAt: new Date().toISOString(),
		};
		saveState(next, cwd);
		return next;
	});
}

/** Persist the scan kinds selected at the scan-plan gate. */
export function setScansSelected(
	state: RunState,
	scans: ScanType[],
	cwd: string = process.cwd(),
): RunState {
	return withRunLock(cwd, "setScansSelected", () => {
		const invalid = scans.filter((s) => !(SCAN_TYPES as readonly string[]).includes(s));
		if (invalid.length > 0) {
			throw new Error(
				`Unknown scan type(s): ${invalid.join(", ")}. Allowed: ${SCAN_TYPES.join(", ")}.`,
			);
		}
		const next: RunState = {
			...state,
			scansSelected: [...new Set(scans)],
			updatedAt: new Date().toISOString(),
		};
		saveState(next, cwd);
		return next;
	});
}

/**
 * v3 — persist the 2 persistent sub-agent session handles opened at
 * brainstorm step 2 (AUTOMATIC SPAWN). Idempotent — calling with the
 * same handles is a no-op so the spawn helper can be re-entered safely.
 *
 * Validates the handles against the well-known names
 * (`web`, `docCode`) so a typo can't write a junk handle. The
 * `spawnedAt` timestamp is auto-stamped when omitted.
 *
 * Called by the spawn helper (Phase 2) and the close helper
 * (Phase 8) — which also clears the field via `clearBrainstormSession`.
 */
export function setActiveSubagents(
	state: RunState,
	handles: { web?: string; docCode?: string; spawnedAt?: string },
	cwd: string = process.cwd(),
): RunState {
	return withRunLock(cwd, "setActiveSubagents", () => {
		const KNOWN = ["web", "docCode", "spawnedAt"] as const;
		for (const key of Object.keys(handles)) {
			if (!(KNOWN as readonly string[]).includes(key)) {
				throw new Error(
					`Unknown activeSubagents key "${key}". Allowed: ${KNOWN.join(", ")}.`,
				);
			}
		}
		const next: RunState = {
			...state,
			activeSubagents: {
				web: handles.web,
				docCode: handles.docCode,
				spawnedAt: handles.spawnedAt ?? new Date().toISOString(),
			},
			updatedAt: new Date().toISOString(),
		};
		saveState(next, cwd);
		return next;
	});
}

/**
 * Add or update one brainstorm question (matched by id) and persist.
 * The DISCUSS loop calls this after every state change so the per-question
 * ledger survives restarts. "not-wanted" and "replaced" require a reason —
 * rejected ideas must never come back undocumented.
 */
export function upsertBrainstormQuestion(
	state: RunState,
	question: BrainstormQuestion,
	cwd: string = process.cwd(),
): RunState {
	if (!question || !question.id || !question.text || !question.state) {
		throw new Error("upsertBrainstormQuestion needs question: { id, text, state }.");
	}
	if (!(BRAINSTORM_QUESTION_STATES as readonly string[]).includes(question.state)) {
		throw new Error(
			`Unknown question state "${question.state}". Allowed: ${BRAINSTORM_QUESTION_STATES.join(", ")}.`,
		);
	}
	if (
		(question.state === "not-wanted" || question.state === "replaced") &&
		(!question.reason || question.reason.trim() === "")
	) {
		throw new Error(`State "${question.state}" requires a reason (deferred, not forgotten).`);
	}
	const questions = state.brainstormQuestions ?? [];
	const index = questions.findIndex((q) => q.id === question.id);
	const nextQuestions =
		index >= 0
			? questions.map((q, i) => (i === index ? question : q))
			: [...questions, question];
	return withRunLock(cwd, "upsertBrainstormQuestion", () => {
		const next: RunState = {
			...state,
			brainstormQuestions: nextQuestions,
			updatedAt: new Date().toISOString(),
		};
		saveState(next, cwd);
		return next;
	});
}

/**
 * Increment the dispatch counter for the active brainstorm and persist.
 * Callers should validate against the dispatch cap BEFORE invoking this —
 * this helper assumes the caller has already checked.
 */
export function incrementBrainstormDispatchCount(
	state: RunState,
	cwd: string = process.cwd(),
): RunState {
	return withRunLock(cwd, "incrementBrainstormDispatchCount", () => {
		const next: RunState = {
			...state,
			brainstormDispatchCount: (state.brainstormDispatchCount ?? 0) + 1,
			updatedAt: new Date().toISOString(),
		};
		saveState(next, cwd);
		return next;
	});
}

/**
 * Append a per-dispatch web consent entry to the ledger and persist.
 * Idempotent for the same topic within the same ISO minute (re-confirming
 * the same topic in the same minute does not duplicate). Caps are NOT
 * enforced — the developer decides when to stop (v1.x brainstorm upgrade).
 */
export function appendWebDispatchConsent(
	state: RunState,
	topic: string,
	cwd: string = process.cwd(),
): RunState {
	return withRunLock(cwd, "appendWebDispatchConsent", () => {
		const now = new Date().toISOString();
		const trimmed = (topic ?? "").trim();
		if (!trimmed) return state;
		const existing = state.webDispatchConfirmations ?? [];
		const dup = existing.find(
			(e) => e.topic === trimmed && now.slice(0, 16) === e.confirmedAt.slice(0, 16),
		);
		if (dup) return state;
		const next: RunState = {
			...state,
			webDispatchConfirmations: [...existing, { topic: trimmed, confirmedAt: now }],
			updatedAt: now,
		};
		saveState(next, cwd);
		return next;
	});
}

/**
 * Clear the brainstorm session fields after approve finalizes the stage.
 * Removes the six lifecycle fields (understandingConfirmed,
 * scansSelected, brainstormQuestions, brainstormDispatchCount,
 * webDispatchConfirmations, activeSubagents) so the mutation lock fully
 * lifts and a later re-run starts with a clean ledger.
 * Never touches `currentStage` — call this on the already-advanced state.
 */
export function clearBrainstormSession(
	state: RunState,
	cwd: string = process.cwd(),
): RunState {
	return withRunLock(cwd, "clearBrainstormSession", () => {
		const next: RunState = {
			...state,
			...clearedBrainstormSessionFields(),
			updatedAt: new Date().toISOString(),
		};
		saveState(next, cwd);
		return next;
	});
}

/** The six lifecycle fields `clearBrainstormSession` wipes, as a patch. */
function clearedBrainstormSessionFields(): Partial<RunState> {
	return {
		understandingConfirmed: undefined,
		scansSelected: undefined,
		brainstormQuestions: undefined,
		brainstormDispatchCount: undefined,
		webDispatchConfirmations: undefined,
		activeSubagents: undefined,
	};
}

// ---------------------------------------------------------------------------
// Brainstorm-anytime (A2) — pause/resume session primitives (D1/D2/D5/D7)
// ---------------------------------------------------------------------------

/**
 * Open a brainstorm session mid-run: pause the current stage and move to
 * `brainstorming`. First-run (`none`) keeps `pausedStage` absent — the
 * caller uses `createRun` there instead, so this primitive is for existing
 * runs. Throws when a session is already open (no nesting). Resets the
 * dispatch counter (D5 — caps are per-session). Run-locked, history-
 * appending; NOT a STAGE_TRANSITIONS row (D2).
 */
export function openBrainstormSession(cwd: string = process.cwd()): RunState {
	return withRunLock(cwd, "openBrainstormSession", () => {
		const state = loadState(cwd);
		if (state.currentStage === "brainstorming") {
			throw new Error(
				"A brainstorm session is already open — approve or discard it first.",
			);
		}
		const now = new Date().toISOString();
		const paused = state.currentStage === "none" ? undefined : state.currentStage;
		const entry: HistoryEntry = {
			stage: "brainstorming",
			command: "/velpari-brainstorm (open-session)",
			timestamp: now,
		};
		const next: RunState = {
			...state,
			currentStage: "brainstorming",
			pausedStage: paused,
			brainstormDispatchCount: 0,
			history: [...(state.history ?? []), entry],
			updatedAt: now,
		};
		saveState(next, cwd);
		if (next.runId) appendHistory(cwd, next.runId, entry);
		return next;
	});
}

/**
 * Close an open brainstorm after a successful approve, through one of the
 * two doors (D3): `continue` resumes the paused stage (requires one);
 * `restart-prd` lands at `brainstormed` — the same state a first-run
 * approve reaches, so `/velpari-prd` is next. Clears the session fields
 * (inline — the run lock is not recursive).
 */
export function resumeFromBrainstorm(
	cwd: string = process.cwd(),
	door: "continue" | "restart-prd" = "continue",
): RunState {
	return withRunLock(cwd, `resumeFromBrainstorm:${door}`, () => {
		const state = loadState(cwd);
		if (state.currentStage !== "brainstorming") {
			throw new Error("No brainstorm session is open.");
		}
		if (door === "continue" && !state.pausedStage) {
			throw new Error(
				'Door "continue" requires a paused stage — first-run brainstorms land at "brainstormed" (restart-prd).',
			);
		}
		const target: Stage = door === "restart-prd" ? "brainstormed" : state.pausedStage!;
		const now = new Date().toISOString();
		const entry: HistoryEntry = {
			stage: target,
			command: `/velpari-approve-brainstorm (${door})`,
			timestamp: now,
		};
		const next: RunState = {
			...state,
			currentStage: target,
			pausedStage: undefined,
			...clearedBrainstormSessionFields(),
			history: [...(state.history ?? []), entry],
			updatedAt: now,
		};
		saveState(next, cwd);
		if (next.runId) appendHistory(cwd, next.runId, entry);
		return next;
	});
}

/**
 * Discard an open brainstorm without publishing (D7): clear the session
 * fields and resume the paused stage (first-run sessions return to `none`
 * — equivalent to a reset for a never-published brainstorm). No artifact
 * is written; a history entry records the discard.
 */
export function discardBrainstormSession(cwd: string = process.cwd()): RunState {
	return withRunLock(cwd, "discardBrainstormSession", () => {
		const state = loadState(cwd);
		if (state.currentStage !== "brainstorming") {
			throw new Error("No brainstorm session is open.");
		}
		const target: Stage = state.pausedStage ?? "none";
		const now = new Date().toISOString();
		const entry: HistoryEntry = {
			stage: target,
			command: "/velpari-brainstorm-session (discard)",
			timestamp: now,
		};
		const next: RunState = {
			...state,
			currentStage: target,
			pausedStage: undefined,
			...clearedBrainstormSessionFields(),
			history: [...(state.history ?? []), entry],
			updatedAt: now,
		};
		saveState(next, cwd);
		if (next.runId) appendHistory(cwd, next.runId, entry);
		return next;
	});
}

/**
 * Merge a patch into the feasibility v2 session and persist. Shallow merge:
 * only the provided keys change. The parent LLM (via the skill flow) and
 * `handleApprove` (called by the publish tool or the
 * `/velpari-feasibility-approve` fall-back) use this to track consent,
 * decision, spikes, and the final language choice across turns.
 */
export function setFeasibilitySession(
	state: RunState,
	patch: Partial<FeasibilitySession>,
	cwd: string = process.cwd(),
): RunState {
	return withRunLock(cwd, "setFeasibilitySession", () => {
		const next: RunState = {
			...state,
			feasibilitySession: { ...state.feasibilitySession, ...patch },
			updatedAt: new Date().toISOString(),
		};
		saveState(next, cwd);
		return next;
	});
}

/**
 * Clear the feasibility v2 session after approve finalizes the stage.
 * Never touches `currentStage` — call this on the already-advanced state.
 */
export function clearFeasibilitySession(
	state: RunState,
	cwd: string = process.cwd(),
): RunState {
	return withRunLock(cwd, "clearFeasibilitySession", () => {
		const next: RunState = {
			...state,
			feasibilitySession: undefined,
			updatedAt: new Date().toISOString(),
		};
		saveState(next, cwd);
		return next;
	});
}
