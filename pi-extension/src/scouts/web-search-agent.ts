/**
 * WEB SEARCH AGENT scout (optional, user-prompted per FR-52).
 *
 * Role: fetch community resources, official docs, similar projects (per FR-53).
 * Reads skills/discuss-subagents/web-search-agent.md as its prompt template.
 */

import type { ScoutFn, ScoutInput, ScoutOutput } from "../contracts.js";
import { readScoutSkill } from "../scout.js";

export interface WebSearchProposal {
	community: string[];
	official: string[];
	similar: string[];
}

export const runWebSearch: ScoutFn<WebSearchProposal> = async (input: ScoutInput): Promise<ScoutOutput<WebSearchProposal>> => {
	const skill = readScoutSkill("web-search-agent");
	void skill;
	// Phase B: only runs if webSearchAllowed is true.
	if (!input.webSearchAllowed) {
		return {
			proposals: [],
			source: "web-search-agent",
			timestamp: new Date().toISOString(),
		};
	}
	return {
		proposals: [],
		source: "web-search-agent",
		timestamp: new Date().toISOString(),
	};
};
