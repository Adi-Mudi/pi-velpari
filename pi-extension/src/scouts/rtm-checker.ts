/**
 * RTM CHECKER scout (mandatory).
 *
 * Role: read existing RTM; identify test-case implications.
 * Reads skills/discuss-subagents/rtm-checker.md as its prompt template.
 */

import type { ScoutFn, ScoutInput, ScoutOutput } from "../contracts.js";
import { readScoutSkill } from "../scout.js";

export interface RtmCheckerProposal {
	frId: string;
	testCase: string;
}

export const runRtmChecker: ScoutFn<RtmCheckerProposal> = async (input: ScoutInput): Promise<ScoutOutput<RtmCheckerProposal>> => {
	const skill = readScoutSkill("rtm-checker");
	void skill;
	void input;
	return {
		proposals: [],
		source: "rtm-checker",
		timestamp: new Date().toISOString(),
	};
};
