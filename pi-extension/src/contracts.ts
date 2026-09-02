/**
 * Scout contract — uniform interface for the 4 discussion scouts
 * (NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, WEB SEARCH AGENT) and the
 * 8 scout agents in Phases F + G. Per FR-54, NFR-13.
 */

export type ScoutId =
	| "extractor"
	| "prd-checker"
	| "rtm-checker"
	| "web-search-agent";

/**
 * A single proposal from a scout.
 */
export interface ScoutProposal<T = unknown> {
	id: string;
	source: ScoutId;
	payload: T;
}

/**
 * Output envelope — every scout returns this shape (FR-54, NFR-13).
 */
export interface ScoutOutput<T = unknown> {
	proposals: ScoutProposal<T>[];
	source: ScoutId;
	timestamp: string;
}

/**
 * Input passed to every scout.
 */
export interface ScoutInput {
	mission: string;
	interviewAnswers: string[];
	framework: string | undefined;
	existingPrd: string | undefined;
	existingRtm: string | undefined;
	webSearchAllowed: boolean;
}

/**
 * Scout function signature. Each scout reads its skill markdown,
 * composes a prompt section, and returns ScoutOutput.
 */
export type ScoutFn<T = unknown> = (input: ScoutInput) => Promise<ScoutOutput<T>>;

/**
 * Empty output — useful for stub scouts and tests.
 */
export function emptyScoutOutput<T = unknown>(source: ScoutId): ScoutOutput<T> {
	return {
		proposals: [],
		source,
		timestamp: new Date().toISOString(),
	};
}
