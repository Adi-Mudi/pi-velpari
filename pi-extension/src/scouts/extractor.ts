/**
 * NEW EXTRACTOR scout (mandatory).
 *
 * Role: capture user input verbatim; classify as new requirement or refinement.
 * Reads skills/discuss-subagents/extractor.md as its prompt template.
 */

import type { ScoutFn, ScoutInput, ScoutOutput } from "../contracts.js";
import { readScoutSkill } from "../scout.js";

export interface ExtractorProposal {
	rawText: string;
	classification: "new-requirement" | "refinement" | "helper-function";
	suggestedFrId?: string;
}

export const runExtractor: ScoutFn<ExtractorProposal> = async (input: ScoutInput): Promise<ScoutOutput<ExtractorProposal>> => {
	const skill = readScoutSkill("extractor");
	void skill; // Phase B: prompt template loaded but not sent to LLM; stub output.
	void input;
	return {
		proposals: [],
		source: "extractor",
		timestamp: new Date().toISOString(),
	};
};
