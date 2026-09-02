import type { RunState } from "./state.js";

/**
 * Package approved Doc/ artifacts into Senai's input format.
 * Phase A stub — full implementation ships in Phase D.
 */
export function runHandoff(_state: RunState, cwd: string = process.cwd()): string {
	void _state;
	void cwd;
	return "Handoff not implemented yet. Ships in Phase D.\n";
}

/**
 * Validate Senai's schema for the handoff JSON. Phase A stub.
 */
export function validateSenaiSchema(_json: unknown): boolean {
	void _json;
	return true;
}

/**
 * Read all approved Doc/ artifacts. Phase A stub.
 */
export function readApprovedArtifacts(cwd: string = process.cwd()): Record<string, string> {
	void cwd;
	return {};
}
