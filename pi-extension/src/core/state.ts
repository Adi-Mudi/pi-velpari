import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Stage } from "./constants.js";
import { PATHS, STAGE_TRANSITIONS } from "./constants.js";

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
}

export interface HistoryEntry {
	stage: Stage;
	command: string;
	timestamp: string;
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
 */
export function saveState(state: RunState, cwd: string = process.cwd()): void {
	const filePath = join(cwd, PATHS.STATE_FILE);
	mkdirSync(dirname(filePath), { recursive: true });
	const updated: RunState = { ...state, updatedAt: new Date().toISOString() };
	writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf8");
}

/**
 * Create a new run. Phase A stub — returns a state with a generated runId.
 */
export function createRun(mission: string, cwd: string = process.cwd()): RunState {
	const now = new Date();
	const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 16);
	const slug = mission.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32);
	const state: RunState = {
		version: 1,
		runId: `${stamp}-${slug}`,
		mission,
		currentStage: "discussing",
		history: [
			{
				stage: "discussing",
				command: "/velpari-discuss",
				timestamp: now.toISOString(),
			},
		],
		updatedAt: now.toISOString(),
	};
	saveState(state, cwd);
	return state;
}

/**
 * Advance the state to the next stage. Looks up the transition in
 * STAGE_TRANSITIONS, updates currentStage, appends to history, persists.
 * Throws if the transition is not allowed from the current state.
 */
export function advanceStage(state: RunState, command: string, cwd: string = process.cwd()): RunState {
	void cwd;
	const transition = STAGE_TRANSITIONS.find(
		(t) => t.from === state.currentStage && t.command === command,
	);
	if (!transition) {
		throw new Error(
			`Cannot transition from "${state.currentStage}" via "${command}". ` +
				`No matching transition in STAGE_TRANSITIONS.`,
		);
	}
	const now = new Date().toISOString();
	const next: RunState = {
		...state,
		currentStage: transition.to,
		history: [...state.history, { stage: transition.to, command, timestamp: now }],
		updatedAt: now,
	};
	saveState(next, cwd);
	return next;
}

/**
 * Clear the current run. Deletes state.json.
 */
export function clearRun(cwd: string = process.cwd()): void {
	const filePath = join(cwd, PATHS.STATE_FILE);
	if (existsSync(filePath)) {
		unlinkSync(filePath);
	}
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
 * Callers: discipline/approve.ts and stages/discuss-approve.ts immediately
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
