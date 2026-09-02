/**
 * PRD CHECKER scout (mandatory).
 *
 * Role: read existing PRD; identify which existing FR-Ns the new input might update.
 * Reads skills/discuss-subagents/prd-checker.md as its prompt template.
 */

import type { ScoutFn, ScoutInput, ScoutOutput } from "../contracts.js";
import { readScoutSkill } from "../scout.js";

export interface PrdCheckerProposal {
	frId: string;
	delta: string;
}

export const runPrdChecker: ScoutFn<PrdCheckerProposal> = async (input: ScoutInput): Promise<ScoutOutput<PrdCheckerProposal>> => {
	const skill = readScoutSkill("prd-checker");
	void skill;
	void input;
	return {
		proposals: [],
		source: "prd-checker",
		timestamp: new Date().toISOString(),
	};
};
