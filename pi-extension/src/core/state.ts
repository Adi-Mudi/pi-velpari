import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { atomicWriteJson } from "../io/atomic-write.js";
import { withRunLock } from "../io/run-lock.js";
import type { Stage } from "./constants.js";
import { PATHS, STAGE_TRANSITIONS } from "./constants.js";
import type { SpikeResult } from "./spike.js";

/**
 * Locking contract: every public mutation entry point (createRun,
 * advanceStage, clearRun, confirmUnderstanding, setScansSelected,
 * upsertBrainstormQuestion, incrementBrainstormDispatchCount,
 * clearBrainstormSession) wraps its read-modify-write in `withRunLock` so
 * concurrent sessions cannot corrupt state.json. `loadState`/`saveState`
 * stay lock-free leaves. The lock is NOT recursive — a locked function
 * must never call another locked function.
 */

/**
 * Run state shape. Persisted to PATHS.STATE_FILE after every operation.
 */
export interface RunState {
	version: 1;
	runId: string;
	mission: string;
	currentStage: Stage;
	history: HistoryEntry[];
	updatedAt: string;
	/** Hard lock for the brainstorm lifecycle: true only after the user has
	 *  confirmed the parent's one-paragraph understanding. */
	understandingConfirmed?: boolean;
	/** Scan kinds the user selected at the scan-plan gate. */
	scansSelected?: ScanType[];
	/** Per-question states for the DISCUSS loop of the active brainstorm.
	 *  Open states ("draft", "discussing") hard-block approve. */
	brainstormQuestions?: BrainstormQuestion[];
	/** Number of subagent dispatches the parent LLM has made during the
	 *  active brainstorm (dispatch cap bookkeeping). */
	brainstormDispatchCount?: number;
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
export interface ArchSubCycleState {
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
export type BrainstormQuestionState = (typeof BRAINSTORM_QUESTION_STATES)[number];

export interface BrainstormQuestion {
	id: string;
	text: string;
	suggestedAnswer?: string;
	state: BrainstormQuestionState;
	/** Required for "not-wanted" (why the user rejected it) and "replaced"
	 *  (what superseded it). */
	reason?: string;
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
 */
export function loadState(cwd: string = process.cwd()): RunState {
	const filePath = join(cwd, PATHS.STATE_FILE);
	if (!existsSync(filePath)) return { ...EMPTY_STATE };
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
 * Save run state to disk. Creates parent directories if missing.
 * Writes are atomic (temp + rename) via the io layer.
 */
export function saveState(state: RunState, cwd: string = process.cwd()): void {
	const filePath = join(cwd, PATHS.STATE_FILE);
	const updated: RunState = { ...state, updatedAt: new Date().toISOString() };
	atomicWriteJson(filePath, updated);
}

/**
 * Create a new run. Phase A stub — returns a state with a generated runId.
 */
export function createRun(mission: string, cwd: string = process.cwd()): RunState {
	return withRunLock(cwd, "createRun", () => {
		const now = new Date();
		const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 16);
		const slug = mission.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32);
		const state: RunState = {
			version: 1,
			runId: `${stamp}-${slug}`,
			mission,
			currentStage: "brainstorming",
			history: [
				{
					stage: "brainstorming",
					command: "/velpari-brainstorm",
					timestamp: now.toISOString(),
				},
			],
			updatedAt: now.toISOString(),
		};
		saveState(state, cwd);
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
		const next: RunState = {
			...state,
			currentStage: targetStage,
			history: [...state.history, { stage: targetStage, command, timestamp: now }],
			updatedAt: now,
		};
		saveState(next, cwd);
		return next;
	});
}

/**
 * Clear the current run. Deletes state.json.
 */
export function clearRun(cwd: string = process.cwd()): void {
	withRunLock(cwd, "clearRun", () => {
		const filePath = join(cwd, PATHS.STATE_FILE);
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
	});
}

/**
 * Publish a working copy to Doc/. Phase A stub.
 */
export function publishToDoc(_source: string, _target: string, cwd: string = process.cwd()): void {
	void _source;
	void _target;
	void cwd;
	// Phase A: no-op.
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
export function appendStageEntry(pi: ExtensionAPI, state: RunState): void {
	pi.appendEntry("velpari-state", {
		runId: state.runId,
		mission: state.mission,
		stage: state.currentStage,
		updatedAt: state.updatedAt,
		history: state.history,
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
 * Clear the brainstorm session fields after approve finalizes the stage.
 * Removes the four lifecycle-v2 fields (understandingConfirmed,
 * scansSelected, brainstormQuestions, brainstormDispatchCount) so the
 * mutation lock fully lifts and a later re-run starts with a clean ledger.
 * Never touches `currentStage` — call this on the already-advanced state.
 */
export function clearBrainstormSession(
	state: RunState,
	cwd: string = process.cwd(),
): RunState {
	return withRunLock(cwd, "clearBrainstormSession", () => {
		const next: RunState = {
			...state,
			understandingConfirmed: undefined,
			scansSelected: undefined,
			brainstormQuestions: undefined,
			brainstormDispatchCount: undefined,
			updatedAt: new Date().toISOString(),
		};
		saveState(next, cwd);
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
